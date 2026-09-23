import { aiJobAllowedSql, assertAiJobAllowed, excludeManualAiJobs } from "@/lib/ai-image-policy";
import { z } from "zod";
import { after } from "next/server";
import {
  approveAiJob,
  claimNextAiJob,
  completeAiJob,
  completeAiJobWithDewatermark,
  completeAiJobWithSafeFallback,
  claimEnhancementJob,
  completeEnhancementJob,
  retryEnhancementJob,
  createAiImageApiBatch,
  excludeAiImageWork,
  listExcludedAiImageWork,
  listUpcomingAiImageWork,
  nextQueuedJobSql,
  repairAiPreviewCorners,
  restoreExcludedAiImageWork,
  prioritizeAiImageWork,
  runningAiImageApiBatch,
  restoreAiPreviewForJob,
  saveLensCandidateForAiJob,
} from "@/lib/ai-image-work";
import { jsonError } from "@/lib/http";
import { getDewatermarkCreditBalance } from "@/lib/dewatermark-api";
import { getImageWorkbenchSettings } from "@/lib/image-workbench-settings";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// 통과 요청은 상품 이미지 업로드까지 함께 처리한다. 기본 실행 시간으로는
// 자동 처리로 R2·DB가 붐빌 때 중간에 끊긴다.
export const maxDuration = 60;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("excludeBts") }),
  z.object({ action: z.literal("claim") }),
  z.object({
    action: z.literal("upcoming"),
    offset: z.number().int().min(0).max(100_000).default(0),
    limit: z.number().int().min(1).max(120).default(48),
  }),
  z.object({
    action: z.literal("excludedList"),
    offset: z.number().int().min(0).max(100_000).default(0),
    limit: z.number().int().min(1).max(120).default(48),
  }),
  z.object({
    action: z.literal("lensCandidate"),
    id: z.string().min(1),
    // 화면에서 네 모서리를 찍어 잘라낸 결과를 보낸다. 주소만 보내는 옛 방식도 받는다.
    image: z.string().startsWith("data:image/").max(20_000_000).optional(),
    imageUrl: z.string().url().max(2_000).optional(),
    /** 자르기 전 원본. 나중에 영역을 다시 잡을 때 쓴다. */
    sourceImage: z.string().startsWith("data:image/").max(20_000_000).optional(),
    /** 찍었던 네 점(원본 대비 0~1 비율) */
    corners: z.array(z.object({ x: z.number(), y: z.number() })).length(4).optional(),
  }).refine((value) => Boolean(value.image) || Boolean(value.imageUrl), {
    message: "잘라낸 이미지 또는 이미지 주소가 필요합니다.",
  }),
  z.object({ action: z.literal("restoreAiPreview"), id: z.string().min(1) }),
  z.object({
    action: z.literal("prioritize"),
    productIds: z.array(z.string().min(1)).min(1).max(200),
      /** 순서만 바꾸지 않고 바로 처리까지 시작할지 */
    start: z.boolean().default(false),
}),
  z.object({
    action: z.literal("repairPreviewCorners"),
    offset: z.number().int().min(0).max(100_000).default(0),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  z.object({
    action: z.literal("exclude"),
    productIds: z.array(z.string().min(1)).min(1).max(200),
  }),
  z.object({
    action: z.literal("restoreExcluded"),
    productIds: z.array(z.string().min(1)).min(1).max(200),
  }),
  z.object({ action: z.literal("workerClaim") }),
  z.object({ action: z.literal("workerHeartbeat") }),
  z.object({ action: z.literal("enhancementClaim") }),
  z.object({ action: z.literal("enhancementRetry"), id: z.string().min(1) }),
  z.object({ action: z.literal("enhancementComplete"), id: z.string().min(1), image: z.string().startsWith("data:image/").max(20_000_000) }),
  z.object({ action: z.literal("workerStatus") }),
  z.object({
    action: z.literal("startWorkerBatch"),
    limit: z.number().int().min(1).max(200),
  }),
  z.object({
    action: z.literal("startApiBatch"),
    limit: z.number().int().min(1).max(10_000),
    mode: z.enum(["STANDARD", "PRO"]).default("STANDARD"),
  }),
  z.object({ action: z.literal("apiBatchStatus") }),
  z.object({ action: z.literal("dewatermarkCreditBalance") }),
  z.object({ action: z.literal("claimRework"), id: z.string().min(1) }),
  z.object({
    action: z.literal("dewatermark"),
    id: z.string().min(1),
    mode: z.enum(["STANDARD", "PRO"]).default("STANDARD"),
  }),
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
    const input = schema.parse(await request.json());
    const authorization = request.headers.get("authorization") ?? "";
    const workerToken = process.env.LOCAL_AI_WORKER_TOKEN ?? "";
    const isWorker =
      Boolean(workerToken) && authorization === `Bearer ${workerToken}`;
    if (
      ["workerClaim", "workerHeartbeat", "fallback", "enhancementClaim", "enhancementComplete"].includes(input.action) &&
      !isWorker
    )
      return jsonError("Forbidden", 403);
    const user = isWorker ? null : await requireApiUser();
    if (input.action === "excludeBts") {
      if (!user) return jsonError("Forbidden", 403);
      return Response.json(await excludeManualAiJobs());
    }
    if ("id" in input) await assertAiJobAllowed(input.id);
    if (input.action === "workerHeartbeat") {
      await prisma.$executeRaw`UPDATE "local_ai_worker_state"
        SET "last_heartbeat"=NOW(),"updated_at"=NOW() WHERE "id"=1`;
      return Response.json({ ok: true });
    }
    if (input.action === "enhancementClaim")
      return Response.json({ ok: true, job: await claimEnhancementJob() });
    if (input.action === "enhancementComplete")
      return Response.json({ ok: true, url: await completeEnhancementJob(input.id, input.image) });
    if (input.action === "enhancementRetry") {
      await retryEnhancementJob(input.id);
      return Response.json({ ok: true });
    }
    const runBatch = (batchId: string) => {
      const workerUrl = new URL("/api/cron/ai-image-work", request.url);
      workerUrl.searchParams.set("batchId", batchId);
      const secret = process.env.CRON_SECRET;
      after(() =>
        fetch(workerUrl, {
          headers: secret ? { authorization: `Bearer ${secret}` } : {},
        }).catch(console.error),
      );
    };
    if (input.action === "startApiBatch") {
      const batch = await createAiImageApiBatch(user!.id, input.limit, input.mode);
      runBatch(batch.id);
      return Response.json({ ok: true, batch }, { status: 201 });
    }
    if (input.action === "apiBatchStatus") {
      const batches = await prisma.$queryRaw<
        Array<{
          id: string;
          status: string;
          mode: "STANDARD" | "PRO";
          requestedCount: number;
          claimedCount: number;
          completedCount: number;
          failedCount: number;
          errorMessage: string | null;
          createdAt: Date;
          updatedAt: Date;
          completedAt: Date | null;
        }>
      >`
        SELECT "id","status","mode",
          "requested_count" AS "requestedCount",
          "claimed_count" AS "claimedCount",
          "completed_count" AS "completedCount",
          "failed_count" AS "failedCount",
          "error_message" AS "errorMessage",
          "created_at" AS "createdAt",
          "updated_at" AS "updatedAt",
          "completed_at" AS "completedAt"
        FROM "ai_image_api_batches"
        WHERE "user_id"=${user!.id}
          AND ("status" IN ('queued','running') OR "created_at">NOW()-INTERVAL '24 hours')
        ORDER BY CASE WHEN "status" IN ('queued','running') THEN 0 ELSE 1 END,
          "created_at" DESC
        LIMIT 1`;
      const batch = batches[0] ?? null;
      if (batch && ["queued", "running"].includes(batch.status)) {
        const recoveryLease = await prisma.$queryRaw<Array<{ id: string }>>`
          UPDATE "ai_image_api_batches"
          SET "updated_at"=NOW()
          WHERE "id"=${batch.id}
            AND "status" IN ('queued','running')
            AND "updated_at"<NOW()-INTERVAL '75 seconds'
          RETURNING "id"`;
        if (recoveryLease[0]) {
          const workerUrl = new URL("/api/cron/ai-image-work", request.url);
          workerUrl.searchParams.set("batchId", batch.id);
          const secret = process.env.CRON_SECRET;
          after(() =>
            fetch(workerUrl, {
              headers: secret ? { authorization: `Bearer ${secret}` } : {},
            }).catch((error) =>
              console.error("AI image batch automatic recovery failed.", error),
            ),
          );
        }
      }
      return Response.json({ ok: true, batch });
    }
    if (input.action === "dewatermarkCreditBalance") {
      return Response.json({
        ok: true,
        availableCredits: await getDewatermarkCreditBalance(),
      });
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
        SELECT COUNT(*) AS "count" FROM "ai_image_jobs" WHERE ${aiJobAllowedSql} AND "status"='queued'`;
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
          ${nextQueuedJobSql}
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
    if (input.action === "upcoming" || input.action === "excludedList") {
      const page = { limit: input.limit, offset: input.offset };
      const result =
        input.action === "upcoming"
          ? await listUpcomingAiImageWork(page)
          : await listExcludedAiImageWork(page);
      return Response.json({ ok: true, ...result });
    }
    if (input.action === "lensCandidate")
      return Response.json({
        ok: true,
        ...(await saveLensCandidateForAiJob(input.id, {
          image: input.image,
          imageUrl: input.imageUrl,
          sourceImage: input.sourceImage,
          corners: input.corners,
        })),
      });
    if (input.action === "restoreAiPreview")
      return Response.json({
        ok: true,
        ...(await restoreAiPreviewForJob(input.id)),
      });
    if (input.action === "prioritize") {
      const result = await prioritizeAiImageWork(input.productIds);
      // 순서만 바꾸면 사람이 보기에는 아무 일도 일어나지 않는다. 고른 만큼 바로
      // 처리까지 시작한다. 이미 돌고 있는 작업이 있으면 그 작업이 앞으로 올린
      // 상품부터 가져가므로 새 작업을 만들지 않는다.
      if (!input.start || !result.prioritized)
        return Response.json({ ok: true, ...result, started: false });
      const running = await runningAiImageApiBatch();
      if (running)
        return Response.json({ ok: true, ...result, started: false, alreadyRunning: true });
      const batch = await createAiImageApiBatch(user!.id, result.prioritized, "STANDARD");
      runBatch(batch.id);
      return Response.json({ ok: true, ...result, started: true, batch });
    }
    if (input.action === "repairPreviewCorners")
      return Response.json({
        ok: true,
        ...(await repairAiPreviewCorners({
          limit: input.limit,
          offset: input.offset,
        })),
      });
    if (input.action === "exclude")
      return Response.json({
        ok: true,
        ...(await excludeAiImageWork(input.productIds, user!.id)),
      });
    if (input.action === "restoreExcluded")
      return Response.json({
        ok: true,
        ...(await restoreExcludedAiImageWork(input.productIds)),
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
    if (input.action === "dewatermark") {
      return Response.json({
        ok: true,
        url: `${await completeAiJobWithDewatermark(input.id, input.mode)}?v=${Date.now()}`,
      });
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
      await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"=CASE WHEN "status"='enhancing' THEN 'enhancement_failed' ELSE 'failed' END,"error"=${input.error},"processed_at"=NOW() WHERE "id"=${input.id}`;
      if (isWorker)
        await prisma.$executeRaw`UPDATE "local_ai_worker_state" SET
          "failed_total"="failed_total"+1,"current_job_id"=NULL,
          "last_heartbeat"=NOW(),"updated_at"=NOW() WHERE "id"=1`;
      return Response.json({ ok: true });
    }
    if (input.action === "reprocess") {
      const count =
        // preview_url은 지우지 않는다. 다시 처리하면 어차피 새 주소로 덮어쓰고,
        // 남겨두면 실수로 눌렀을 때 직전 결과를 되돌릴 수 있다.
        await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='queued',"error"=NULL,"reviewed_at"=NULL,"reviewed_by"=NULL WHERE ${aiJobAllowedSql} AND "status" IN ('review','held','pass_ready','processing')`;
      return Response.json({ ok: true, count });
    }
    if (input.action === "resumeHeld") {
      const count =
        await prisma.$executeRaw`UPDATE "ai_image_jobs" SET "status"='review' WHERE ${aiJobAllowedSql} AND "status"='held'`;
      return Response.json({ ok: true, count });
    }
    if (input.action === "pass") {
      const passed = await prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE "ai_image_jobs" SET "status"='pass_ready',"reviewed_at"=NOW(),"reviewed_by"=${user!.id}
        WHERE "id"=${input.id} AND "status"='review' RETURNING "id"`;
      if (!passed[0]) return Response.json({ ok: true, uploaded: false });
      try {
        // 통과시킨 결과는 곧바로 상품 이미지로 확정한다. 사람이 두 번 확인하지
        // 않아도 되지만, 확정 자체는 여전히 통과를 누른 사람의 결정이다.
        return Response.json({
          ok: true,
          uploaded: true,
          url: await approveAiJob(input.id, user!.id),
        });
      } catch (error) {
        // 업로드만 실패하면 통과 판정은 남겨 둔다. 통과 목록의 일괄 업로드로
        // 다시 시도할 수 있어야 하고, 실패를 미통과로 바꾸면 안 된다.
        return Response.json({
          ok: true,
          uploaded: false,
          uploadError: (error instanceof Error
            ? error.message
            : "최종 업로드 실패"
          ).slice(0, 300),
        });
      }
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
