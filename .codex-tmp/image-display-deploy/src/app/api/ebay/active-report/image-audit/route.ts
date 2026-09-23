import { z } from "zod";
import { getEbayListingSummary } from "@/lib/ebay";
import { jsonError } from "@/lib/http";
import { productImageExtrasById } from "@/lib/product-export-image-extras";
import { prisma } from "@/lib/prisma";
import {
  compareImageFingerprints,
  computeImageFingerprintFromBuffer,
  maxProductMatchImageBytes,
} from "@/lib/services/productImageMatchService";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(10).default(5) });

async function fingerprintFromUrl(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxProductMatchImageBytes) return null;
    return await computeImageFingerprintFromBuffer(buffer);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json().catch(() => ({})));
    const report = await prisma.ebayReportImport.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!report) return jsonError("활성상품 보고서가 없습니다.", 404);

    // 보고서 행의 productId만 보면, Product.ebayItemId에는 연결돼 있지만
    // 최신 보고서 행이 다른 상품을 가리키는 바로 그 오연결을 감사 대상에서
    // 놓칠 수 있다. 연결의 원장인 Product를 기준으로 전부 읽는다.
    const linkedProducts = await prisma.product.findMany({
      where: { ebayItemId: { not: null } },
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, imageUrl: true, ebayItemId: true },
    });
    const itemCounts = new Map<string, number>();
    for (const product of linkedProducts) {
      if (product.ebayItemId) itemCounts.set(product.ebayItemId, (itemCounts.get(product.ebayItemId) ?? 0) + 1);
    }
    // 같은 Item ID를 공유하는 옵션상품은 개별 카드와 묶음 대표이미지를 직접
    // 비교할 수 없으므로 여기서는 제외하고, 단일 Item ID 연결만 감사한다.
    const auditableProducts = linkedProducts.filter(
      (product) => product.ebayItemId && itemCounts.get(product.ebayItemId) === 1,
    );
    const products = auditableProducts.slice(input.offset, input.offset + input.limit);
    const extras = await productImageExtrasById(products.map((product) => product.id));
    const results = [];

    for (const product of products) {
      const itemId = product.ebayItemId!;
      // eBay 업로드 결과(ebayImageUrls)를 기준 사진으로 쓰면 잘못 올라간
      // 사진을 그 사진 자체와 비교하게 되어 오연결을 놓친다. 검증 기준은
      // 사람이 연결한 촬영본, 없으면 포카마켓 원본으로만 한정한다.
      const productImageUrl = extras.get(product.id)?.userFrontImageUrl || product.imageUrl;
      let listingImageUrl: string | null = null;
      try {
        const summary = await getEbayListingSummary({ legacyItemId: itemId });
        listingImageUrl = summary.imageUrl;
      } catch {
        // 종료·삭제·일시적인 eBay API 오류 한 건 때문에 전수점검 전체를
        // 중단하지 않는다. 해당 건만 확인 불가로 남기고 다음 상품을 검사한다.
      }
      if (!productImageUrl || !listingImageUrl) {
        await prisma.product.update({ where: { id: product.id }, data: { listingStatus: "REVIEW_REQUIRED" } });
        results.push({ productId: product.id, sku: product.sku, itemId, status: "REVIEW_REQUIRED", score: null, reason: "IMAGE_UNAVAILABLE" });
        continue;
      }
      const [productFingerprint, listingFingerprint] = await Promise.all([
        fingerprintFromUrl(productImageUrl),
        fingerprintFromUrl(listingImageUrl),
      ]);
      if (!productFingerprint || !listingFingerprint) {
        await prisma.product.update({ where: { id: product.id }, data: { listingStatus: "REVIEW_REQUIRED" } });
        results.push({ productId: product.id, sku: product.sku, itemId, status: "REVIEW_REQUIRED", score: null, reason: "IMAGE_UNAVAILABLE" });
        continue;
      }
      const comparison = compareImageFingerprints(productFingerprint, listingFingerprint);
      const suspicious = comparison.score < 0.4;
      if (suspicious) {
        await prisma.product.update({ where: { id: product.id }, data: { listingStatus: "REVIEW_REQUIRED" } });
      }
      results.push({ productId: product.id, sku: product.sku, itemId, status: suspicious ? "REVIEW_REQUIRED" : "OK", score: Number(comparison.score.toFixed(3)) });
    }

    return Response.json({ total: auditableProducts.length, nextOffset: input.offset + products.length, done: input.offset + products.length >= auditableProducts.length, results });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("점검 범위를 확인해 주세요.", 422);
    return jsonError(error instanceof Error ? error.message : "이미지 연결 점검에 실패했습니다.", 500);
  }
}
