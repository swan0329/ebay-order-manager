import { lookup } from "node:dns/promises";
import net from "node:net";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { uploadBufferToR2 } from "@/lib/r2";
import { asErrorMessage, jsonError } from "@/lib/http";
import { getCurrentUser, UnauthorizedError } from "@/lib/session";
import { workerCanAccessProduct } from "@/lib/image-work-assignments";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
const saveSchema = z.object({
  image: z.string().startsWith("data:image/").max(20_000_000),
  sourceUrl: z.string().url().optional(),
});

function privateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:");
}

async function safeRemoteUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("http/https URL만 사용할 수 있습니다.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address))) throw new Error("내부 네트워크 주소는 사용할 수 없습니다.");
  return url;
}

async function authorize(productId: string) {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  if (user.role === "WORKER" && !(await workerCanAccessProduct(user.id, productId))) {
    throw new UnauthorizedError();
  }
  return user;
}

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await authorize(id);
    const raw = new URL(request.url).searchParams.get("url");
    if (!raw) return jsonError("이미지 URL이 필요합니다.", 400);
    const url = await safeRemoteUrl(raw);
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0" } });
    if (!response.ok) return jsonError(`후보 이미지 요청 실패: HTTP ${response.status}`, 502);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return jsonError("이미지 응답이 아닙니다.", 422);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 15_000_000) return jsonError("이미지가 15MB를 초과합니다.", 413);
    return new Response(buffer, { headers: { "content-type": contentType, "cache-control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const user = await authorize(id);
    const input = saveSchema.parse(await request.json());
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true, sku: true, ebayImageUrls: true } });
    if (!product) return jsonError("상품을 찾을 수 없습니다.", 404);
    const base64 = input.image.slice(input.image.indexOf(",") + 1);
    const output = Buffer.from(base64, "base64");
    // The browser produces a correctly sized JPEG. Validate it, then upload it
    // directly instead of doing a second expensive mozjpeg encode.
    const metadata = await sharp(output).metadata();
    if (metadata.format !== "jpeg" || !metadata.width || !metadata.height || metadata.width > 2000 || metadata.height > 2400) {
      return jsonError("저장할 이미지 크기 또는 형식이 올바르지 않습니다.", 422);
    }
    const safeProductNumber = product.sku.replace(/[^a-zA-Z0-9_-]/g, "_");
    const assignmentRows = user.role === "WORKER"
      ? await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "image_work_assignments"
          WHERE "product_id"=${id} AND "worker_id"=${user.id}
            AND "status" IN ('assigned','in_progress','rejected')
          LIMIT 1`
      : [];
    if (user.role === "WORKER" && !assignmentRows[0]) {
      return jsonError("제출할 이미지 작업을 찾을 수 없습니다.", 409);
    }
    const key = user.role === "WORKER"
      ? `image-work-reviews/${safeProductNumber}/${assignmentRows[0].id}-${Date.now()}.jpg`
      : `products/${safeProductNumber}/${safeProductNumber}.jpg`;
    const uploaded = await uploadBufferToR2({ buffer: output, key, contentType: "image/jpeg", cacheControl: "no-cache" });
    const urls = [uploaded.url, ...product.ebayImageUrls.filter((url) => url !== uploaded.url)];
    if (user.role === "WORKER") {
      await prisma.$transaction([
        prisma.$executeRaw`INSERT INTO "product_image_history" ("id", "product_id", "actor_id", "action", "image_url", "previous_urls", "metadata") VALUES (${randomUUID()}, ${id}, ${user.id}, 'worker_submitted', ${uploaded.url}, ${JSON.stringify(product.ebayImageUrls)}::jsonb, ${JSON.stringify({ sourceUrl: input.sourceUrl ?? null, previewKey: uploaded.key })}::jsonb)`,
        prisma.$executeRaw`UPDATE "image_work_assignments"
          SET "status"='submitted',"submitted_at"=NOW(),"reviewed_at"=NULL,
              "reviewed_by"=NULL,"rejection_reason"=NULL,"rejection_code"=NULL,
              "result_url"=${uploaded.url},"result_key"=${uploaded.key}
          WHERE "id"=${assignmentRows[0].id}`,
      ]);
      return Response.json({
        ok: true,
        url: uploaded.url,
        previewOnly: true,
        sourceUrl: input.sourceUrl ?? null,
      });
    } else {
      await prisma.$transaction([
        prisma.$executeRaw`INSERT INTO "product_image_history" ("id", "product_id", "actor_id", "action", "image_url", "previous_urls", "metadata") VALUES (${randomUUID()}, ${id}, ${user.id}, 'lens_saved', ${uploaded.url}, ${JSON.stringify(product.ebayImageUrls)}::jsonb, ${JSON.stringify({ sourceUrl: input.sourceUrl ?? null })}::jsonb)`,
        prisma.product.update({
          where: { id },
          data: { imageUrl: uploaded.url, ebayImageUrls: urls },
        }),
        prisma.$executeRaw`UPDATE "products" SET "image_source" = 'lens_workbench' WHERE "id" = ${id}`,
      ]);
    }
    return Response.json({ ok: true, url: uploaded.url, ebayImageUrls: urls, sourceUrl: input.sourceUrl ?? null });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("이미지 입력이 올바르지 않습니다.", 422, error.flatten());
    return jsonError(asErrorMessage(error), 500);
  }
}
