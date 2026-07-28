import { z } from "zod";
import {
  approveAiJob,
  claimNextAiJob,
  completeAiJob,
  completeAiJobWithSafeFallback,
  createAiJobs,
  ensureAiImageJobs,
} from "@/lib/ai-image-work";
import { jsonError } from "@/lib/http";
import { getImageWorkbenchSettings } from "@/lib/image-workbench-settings";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("enqueue"),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  z.object({ action: z.literal("claim") }),
  z.object({ action: z.literal("workerClaim") }),
  z.object({ action: z.literal("workerHeartbeat") }),
  z.object({ action: z.literal("workerStatus") }),
  z.object({
    action: z.literal("startWorkerBatch"),
    limit: z.number().int().min(1).max(200),
  }),
  z.object({ action: z.literal("claimRework"), id: z.string().min(1) }),
  z.object({
    action: z.literal("complete"),
    id: z.string().min(1),
    image: z.string().startsWith("data:image/").max(20_000_000),
    engineVersion: z.string().optional(),
  }),
  z.object({ action: z.literal("fallback"), id: z.string().min(1) }),
  z.object({
    action: z.literal("fail"),
    id: z.string().min(1),
    error: z.string().max(500),
  }),
  z.object({ action: z.literal("reprocess") }),
  z.object({ action: z.literal("resumeHeld") }),
  z.object({
    action: z.literal("finalUpload"),
    id: z.string().min(1),
    confirmed: z.literal(true),
  }),
  z.object({
    action: z.enum(["pass", "hold", "rework", "retry"]),
    id: z.string().min(1),
  }),
]);
export async function POST(request: Request) {
  try {
    await ensureAiImageJobs();
    const input = schema.parse(await request.json());
    const authorization = request.headers.get("authorization") ?? "";
    const workerToken = process.env.LOCAL_AI_WORKER_TOKEN ?? "";
    const isWorker =
      Boolean(workerToken) && authorization === `Bearer ${workerToken}`;
    if (
      ["workerClaim", "workerHeartbeat", "fallback"].includes(input.action) &&
      !isWorker
    )
      return jsonError("Forbidden", 403);
    const user = isWorker ? null : await requireApiUser();
    if (input.action === "workerHeartbeat") {
      await prisma.$executeRaw`UPDATE "local_ai_worker_state"
        SET "last_heartbeat"=NOW(),"updated_at"=NOW() WHERE "id"=1`;
      return Response.json({ ok: true });
    }
    if (input.action === "workerStatus") {
      const rows = await prisma.$queryRaw<
        Array<{
          connected: boolean;
          requestedRemaining: number;
          completedTotal: number;
          failedTotal: number;
          currentJobId: string | null;
        }>
      >`SELECT ("last_heartbeat" > NOW() - INTERVAL '15 seconds') AS "connected",
        "requested_remaining" AS "requestedRemaining",
        "completed_total" AS "completedTotal",
        "failed_total" AS "failedTotal",
        "current_job_id" AS "currentJobId"
        FROM "local_ai_worker_state" WHERE "id"=1`;
      return Response.json({ ok: true, ...(rows[0] ?? { connected: false }) });
    }
    if (input.action === "startWorkerBatch") {
      const settings = await getImageWorkbenchSettings(user!.id);
      const counts = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS "count" FROM "ai_image_jobs" WHERE "status"='queued'`;
      const accepted = Math.min(input.limit, Number(counts[0]?.count ?? 0));
      await prisma.$executeRaw`UPDATE "local_ai_worker_state"
        SET "requested_remaining"="requested_remaining"+${accepted},
            "use_local_ai"=${settings.localAiEnabled},"updated_at"=NOW()
        WHERE "id"=1`;
      return Response.json({ ok: true, accepted });
    }
    if (input.action === "workerClaim") {
      const jobs = await prisma.$queryRaw<
        Array<{
          id: string;
          productId: string;
          sourceUrl: string;
          useLocalAi: boolean;
        }>
      >`WITH next_job AS (
          SELECT "id" FROM "ai_image_jobs" WHERE "status"='queued'
          ORDER BY "created_at" FOR UPDATE SKIP LOCKED LIMIT 1
        ), permit AS (
          UPDATE "local_ai_worker_state"
          SET "requested_remaining"="requested_remaining"-1,
              "last_heartbeat"=NOW(),"current_job_id"=(SELECT "id" FROM next_job),
              "updated_at"=NOW()
          WHERE "id"=1 AND "requested_remaining">0
            AND EXISTS (SELECT 1 FROM next_job)
          RETURNING 1
        )
        UPDATE "ai_image_jobs" SET "status"='processing',"error"=NULL
        WHERE "id"=(SELECT "id" FROM next_job) AND EXISTS (SELECT 1 FROM permit)
        RETURNING "id","product_id" AS "productId","source_url" AS "sourceUrl",
          (SELECT "use_local_ai" FROM "local_ai_worker_state" WHERE "id"=1) AS "useLocalAi"`;
      return Response.json({ ok: true, job: jobs[0] ?? null });
    }
    if (input.action === "enqueue")
      return Response.json({
        ok: true,
        created: await createAiJobs(input.limit),
      });
    if (input.action === "claim")
      return Response.json({ ok: true, job: await claimNextAiJob() });
    if (input.action === "claimRework") {
      const jobs = await prisma.$queryRaw<
        Array<{ id: string; productId: string; sourceUrl: string }>
      >`UPDATE "ai_image_jobs" SET "status"='processing',"error"=NULL
        WHERE "id"=${input.id} AND "status"='rework'
        RETURNING "id","product_id" AS "productId","source_url" AS "sourceUrl"`;
      return Response.json({ ok: true, job: jobs[0] ?? null });
    }
    if (
      input.action === "complete" &&
      ![
        "alpha-v4-20260722-14",
        "local-ai-v1",
        "local-ai-v4",
        "local-ai-v5",
      ].includes(input.engineVersion ?? "")
    )
      return jsonError(
        "이전 이미지 처리 엔진입니다. 페이지를 새로고침한 뒤 다시 재처리해 주세요.",
        409,
      );
    if (input.action === "complete") {
      const result = {
        ok: true,
        url: `${await completeAiJob(input.id, input.image)}?v=${Date.now()}`,
      };
      if (isWorker)
        await prisma.$executeRaw`UPDATE "local_ai_worker_state" SET
          "completed_total"="completed_total"+1,"current_job_id"=NULL,
          "last_heartbeat"=NOW(),"updated_at"=NOW() WHERE "id"=1`;
      return Response.json(result);
    }
    if (input.action === "fallback") {
      const result = {
        ok: true,
        url: `${await completeAiJobWithSafeFallback(input.id)}?v=${Date.now()}`,
      };
      await prisma.$executeRaw`UPDATE "local_ai_worker_state" SET
        "completed_total"="completed_total"+1,"current_job_id"=NULL,
        "last_heartbeat"=NOW(),"updated_at"=NOW() WHERE "id"=1`;
      return Response.json(result);
    }
    if (input.action === "fail") {
      await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='failed',"error"=${input.error},"processed_at"=NOW() WHERE "id"=${input.id}`;
      if (isWorker)
        await prisma.$executeRaw`UPDATE "local_ai_worker_state" SET
          "failed_total"="failed_total"+1,"current_job_id"=NULL,
          "last_heartbeat"=NOW(),"updated_at"=NOW() WHERE "id"=1`;
      return Response.json({ ok: true });
    }
    if (input.action === "reprocess") {
      const count =
        await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='queued',"preview_url"=NULL,"error"=NULL,"reviewed_at"=NULL,"reviewed_by"=NULL WHERE "status" IN ('review','held','pass_ready','processing')`;
      return Response.json({ ok: true, count });
    }
    if (input.action === "resumeHeld") {
      const count =
        await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='review' WHERE "status"='held'`;
      return Response.json({ ok: true, count });
    }
    if (input.action === "pass") {
      await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='pass_ready',"reviewed_at"=NOW(),"reviewed_by"=${user!.id} WHERE "id"=${input.id} AND "status"='review'`;
      return Response.json({ ok: true });
    }
    if (input.action === "hold") {
      await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='held',"reviewed_at"=NOW(),"reviewed_by"=${user!.id} WHERE "id"=${input.id} AND "status"='review'`;
      return Response.json({ ok: true });
    }
    if (input.action === "finalUpload")
      return Response.json({
        ok: true,
        url: await approveAiJob(input.id, user!.id),
      });
    if (input.action === "rework") {
      await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='rework',"reviewed_at"=NOW(),"reviewed_by"=${user!.id} WHERE "id"=${input.id} AND "status"='review'`;
      return Response.json({ ok: true });
    }
    await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='queued',"error"=NULL,"reviewed_at"=NULL,"reviewed_by"=NULL WHERE "id"=${input.id} AND "status" IN ('failed','rework')`;
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError)
      return jsonError("입력값을 확인해 주세요.", 422);
    return jsonError(
      error instanceof Error ? error.message : "AI 이미지 처리 실패",
      500,
    );
  }
}
