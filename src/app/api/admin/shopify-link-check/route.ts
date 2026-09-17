import { z } from "zod";
import { getShopifyConfig } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { shopifyApiRequest } from "@/lib/services/shopifyService";

export const maxDuration = 60;

const schema = z.object({
  skus: z.array(z.string().trim().min(1)).min(1).max(50),
});

type VariantNode = {
  id: string;
  sku: string | null;
  inventoryPolicy: string;
  product: { id: string; status: string | null } | null;
  inventoryItem: { id: string; tracked: boolean } | null;
};

// 가격·수량 반영이 "연결을 확인하지 못했습니다"로 실패할 때, 우리가 저장한 연결과
// Shopify가 실제로 돌려주는 값을 나란히 보여 준다. 읽기만 한다.
export async function POST(request: Request) {
  try {
    await requireApiUser();
    const input = schema.parse(await request.json());
    const products = await prisma.product.findMany({
      where: { sku: { in: input.skus } },
      select: {
        sku: true,
        shopifyProductId: true,
        shopifyVariantId: true,
        shopifyInventoryItemId: true,
        shopifyStatus: true,
      },
    });
    const config = getShopifyConfig();
    const checked = [];
    for (const product of products) {
      if (!product.shopifyVariantId) {
        checked.push({ sku: product.sku, stored: product, shopify: null, problem: "저장된 옵션 ID 없음" });
        continue;
      }
      const response = (await shopifyApiRequest(config, {
        method: "POST",
        path: "/graphql.json",
        body: {
          query:
            `query linkCheck($id:ID!){productVariant(id:$id){id sku inventoryPolicy product{id status} inventoryItem{id tracked}}}`,
          variables: { id: `gid://shopify/ProductVariant/${product.shopifyVariantId}` },
        },
      })) as { errors?: unknown[]; data?: { productVariant?: VariantNode | null } };
      const variant = response.data?.productVariant ?? null;
      const problems: string[] = [];
      if (response.errors?.length) problems.push("GraphQL 오류");
      if (!variant) problems.push("Shopify에 해당 옵션이 없음");
      if (variant && variant.sku !== product.sku)
        problems.push(`상품번호 불일치(Shopify: ${variant.sku ?? "없음"})`);
      if (
        variant &&
        variant.product?.id !== `gid://shopify/Product/${product.shopifyProductId}`
      )
        problems.push(`상위 상품 불일치(Shopify: ${variant.product?.id ?? "없음"})`);
      if (
        variant &&
        variant.inventoryItem?.id !==
          `gid://shopify/InventoryItem/${product.shopifyInventoryItemId}`
      )
        problems.push(`재고 항목 불일치(Shopify: ${variant.inventoryItem?.id ?? "없음"})`);
      // 옵션이 없으면 상위 상품이 남아 있는지, 같은 상품번호의 다른 옵션이
      // 생겼는지까지 봐야 다시 연결할지 등록을 지울지 판단할 수 있다.
      let parent: unknown = null;
      if (!variant && product.shopifyProductId) {
        const parentResponse = (await shopifyApiRequest(config, {
          method: "POST",
          path: "/graphql.json",
          body: {
            query:
              `query parentCheck($id:ID!){product(id:$id){id status title variants(first:100){nodes{id sku inventoryItem{id}}}}}`,
            variables: { id: `gid://shopify/Product/${product.shopifyProductId}` },
          },
        })) as {
          data?: {
            product?: {
              id: string;
              status: string;
              title: string;
              variants: { nodes: Array<{ id: string; sku: string | null; inventoryItem: { id: string } | null }> };
            } | null;
          };
        };
        const found = parentResponse.data?.product ?? null;
        parent = found
          ? {
              id: found.id,
              status: found.status,
              title: found.title,
              variantCount: found.variants.nodes.length,
              sameSkuVariant:
                found.variants.nodes.find((node) => node.sku === product.sku) ?? null,
            }
          : null;
      }
      checked.push({
        sku: product.sku,
        stored: product,
        shopify: variant,
        parent,
        graphqlErrors: response.errors ?? null,
        problem: problems.length ? problems.join(", ") : null,
      });
    }
    return Response.json({ ok: true, storeDomain: config.storeDomain, checked });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("상품번호를 확인해 주세요.", 422);
    return jsonError(
      error instanceof Error ? error.message : "Shopify 연결을 확인하지 못했습니다.",
      500,
    );
  }
}
