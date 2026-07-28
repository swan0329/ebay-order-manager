import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureImageWorkAssignments } from "@/lib/image-work-assignments";
import { jsonError } from "@/lib/http";
import { getObjectFromR2, uploadBufferToR2 } from "@/lib/r2";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const rejectionCodes = [
  "watermark_residual",
  "pattern_damage",
  "border_damage",
  "wrong_card",
  "crop_error",
  "other",
] as const;

const schema = z.discriminatedUnion("action", [
  z.object({
    assignmentId: z.string().min(1),
    action: z.literal("approve"),
  }),
  z.object({
    assignmentId: z.string().min(1),
    action: z.literal("reject"),
    rejectionCode: z.enum(rejectionCodes),
    reason: z.string().trim().min(1).max(500),
  }),
]);

type AssignmentRow = {
  id: string;
  productId: string;
  status: string;
  resultUrl: string | null;
  resultKey: string | null;
  sku: string;
  imageUrl: string | null;
  urls: string[];
};

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    await ensureImageWorkAssignments();
    const input = schema.parse(await request.json());
    const assignments = await prisma.$queryRaw<AssignmentRow[]>`
      SELECT a."id",a."product_id" AS "productId",a."status",
        a."result_url" AS "resultUrl",a."result_key" AS "resultKey",
        p."sku",p."image_url" AS "imageUrl",p."ebay_image_urls" AS "urls"
      FROM "image_work_assignments" a
      JOIN "products" p ON p."id"=a."product_id"
      WHERE a."id"=${input.assignmentId}
      LIMIT 1
    `;
    const assignment = assignments[0];
    if (!assignment) return jsonError("검수 작업을 찾을 수 없습니다.", 404);

    if (input.action === "reject") {
      if (assignment.status !== "submitted") {
        return jsonError("이미 처리됐거나 검수 대기 상태가 아닙니다.", 409);
      }
      const changed = await prisma.$executeRaw`
        UPDATE "image_work_assignments"
        SET "status"='rejected',"reviewed_at"=NOW(),"reviewed_by"=${user.id},
            "rejection_code"=${input.rejectionCode},"rejection_reason"=${input.reason}
        WHERE "id"=${assignment.id} AND "status"='submitted'
      `;
      if (changed !== 1) return jsonError("다른 검수자가 먼저 처리했습니다.", 409);
      return Response.json({ ok: true, applied: false });
    }

    if (assignment.status === "approved") {
      return Response.json({ ok: true, applied: true, url: assignment.imageUrl });
    }
    if (
      assignment.status !== "submitted" ||
      !assignment.resultKey ||
      !assignment.resultUrl
    ) {
      return jsonError("승인할 검수 결과가 없습니다.", 409);
    }

    const preview = await getObjectFromR2(assignment.resultKey);
    if (!preview) return jsonError("승인할 검수 이미지를 읽지 못했습니다.", 502);
    const safeSku = assignment.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
    const uploaded = await uploadBufferToR2({
      buffer: preview.buffer,
      key: `products/${safeSku}/${safeSku}-${Date.now()}-${assignment.id}.jpg`,
      contentType: preview.contentType || "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
    });

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "image_work_assignments"
        WHERE "id"=${assignment.id} FOR UPDATE
      `;
      if (locked[0]?.status === "approved") {
        return { alreadyApplied: true };
      }
      if (locked[0]?.status !== "submitted") {
        return { conflict: true };
      }
      const urls = [
        uploaded.url,
        ...(assignment.urls ?? []).filter((url) => url !== uploaded.url),
      ];
      await tx.product.update({
        where: { id: assignment.productId },
        data: { imageUrl: uploaded.url, ebayImageUrls: urls },
      });
      await tx.$executeRaw`
        UPDATE "products" SET "image_source"='lens_workbench'
        WHERE "id"=${assignment.productId}
      `;
      await tx.$executeRaw`
        UPDATE "image_work_assignments"
        SET "status"='approved',"reviewed_at"=NOW(),"reviewed_by"=${user.id},
            "rejection_code"=NULL,"rejection_reason"=NULL
        WHERE "id"=${assignment.id}
      `;
      await tx.$executeRaw`
        INSERT INTO "product_image_history"
          ("id","product_id","actor_id","action","image_url","previous_urls","metadata")
        VALUES (
          ${randomUUID()},${assignment.productId},${user.id},'worker_approved',
          ${uploaded.url},${JSON.stringify(assignment.urls ?? [])}::jsonb,
          ${JSON.stringify({
            assignmentId: assignment.id,
            previewUrl: assignment.resultUrl,
            previewKey: assignment.resultKey,
          })}::jsonb
        )
      `;
      return { alreadyApplied: false };
    });
    if ("conflict" in result) {
      return jsonError("다른 검수자가 먼저 처리했습니다.", 409);
    }
    return Response.json({
      ok: true,
      applied: true,
      alreadyApplied: result.alreadyApplied,
      url: uploaded.url,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError)
      return jsonError("검수 입력값을 확인해 주세요.", 422);
    return jsonError(
      error instanceof Error ? error.message : "검수 처리 실패",
      500,
    );
  }
}
