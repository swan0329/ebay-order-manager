import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getShopifyProductViewUrl, publishExistingShopifyProduct } from "@/lib/services/shopifyService";
import { shopifyAdminProductUrl } from "@/lib/channel-product-links";

function publicationPage(id: string, productId: string, message: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const adminUrl = shopifyAdminProductUrl(process.env.SHOPIFY_STORE_DOMAIN, productId);
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shopify 게시 상태</title><body style="font-family:system-ui;max-width:640px;margin:64px auto;padding:24px;line-height:1.7"><h1>상품 등록됨 · 판매페이지 게시 필요</h1><p>${escape(message)}</p><p>상품 등록과 온라인 스토어 게시는 별도 단계입니다. 아래 버튼은 등록된 전체 이미지가 승인 이미지와 일치하는지 확인한 뒤 기존 상품을 게시합니다. 이미지 검증에 실패하면 판매채널의 이미지 교체 작업을 먼저 실행해 주세요.</p>${adminUrl ? `<p><a href="${escape(adminUrl)}" target="_blank" rel="noopener noreferrer">Shopify 상품 관리 열기 ↗</a></p>` : ''}<form method="post" action="/api/products/${encodeURIComponent(id)}/shopify-link"><label><input type="checkbox" name="confirmed" value="true" required> 이 상품을 온라인 스토어에 판매 게시합니다.</label><p><button style="padding:12px 20px" type="submit">기존 상품 게시 · 판매페이지 열기</button></p></form><a href="/products">상품목록으로 돌아가기</a></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const maxDuration = 300;

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireApiUser();
    const { id } = await context.params;
    const product = await prisma.product.findUnique({
      where: { id },
      select: { shopifyProductId: true },
    });

    if (!product) return jsonError("상품을 찾을 수 없습니다.", 404);
    if (!product.shopifyProductId) {
      return jsonError("Shopify에 연결된 상품이 아닙니다.", 404);
    }

    const storefront = new URL(_request.url).searchParams.get("view") === "storefront";
    const destination = await getShopifyProductViewUrl(product.shopifyProductId, !storefront);
    if (!destination) {
      if (storefront) return publicationPage(id, product.shopifyProductId, "이 상품은 Shopify에 저장됐지만 현재 공개된 판매페이지를 확인할 수 없습니다.");
      return jsonError("Shopify 상품 주소를 확인하지 못했습니다.", 502);
    }

    return Response.redirect(destination, 307);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    return jsonError("Shopify 상품 주소를 확인하지 못했습니다.", 502);
  }
}

export async function POST(request: Request, context: RouteContext) {
  let productId = "";
  const { id } = await context.params;
  try {
    const user = await requireApiUser();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return jsonError("잘못된 요청입니다.", 403);
    const input = request.headers.get("content-type")?.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
    if (input.confirmed !== true && input.confirmed !== "true") return jsonError("판매 게시 확인이 필요합니다.", 422);
    const product = await prisma.product.findUnique({ where: { id }, select: { shopifyProductId: true } });
    if (!product?.shopifyProductId) return jsonError("Shopify 연결 상품이 없습니다.", 404);
    productId = product.shopifyProductId;
    await publishExistingShopifyProduct(productId, user.id);
    await prisma.product.updateMany({ where: { shopifyProductId: productId }, data: { shopifyStatus: "active", shopifyUploadError: null } });
    const destination = await getShopifyProductViewUrl(productId, false);
    if (!destination) return publicationPage(id, productId, "게시 요청은 완료됐습니다. 잠시 후 판매페이지를 다시 확인해 주세요.");
    return Response.redirect(destination, 303);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return productId ? publicationPage(id, productId, error instanceof Error ? error.message : "Shopify 게시에 실패했습니다.") : jsonError("Shopify 게시에 실패했습니다.", 502);
  }
}

