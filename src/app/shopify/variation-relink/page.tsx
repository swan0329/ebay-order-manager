import { ShopifyVariationRelinkClient } from "@/components/ShopifyVariationRelinkClient";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";
import { issueShopifyRelinkPreviewToken } from "@/lib/services/shopifyRelinkPreview";
import { previewShopifyVariationRelink } from "@/lib/services/shopifyVariationRelink";

export const dynamic = "force-dynamic";

export default async function ShopifyVariationRelinkPage({
  searchParams,
}: {
  searchParams: Promise<{
    seedProductId?: string | string[];
    targetShopifyProductId?: string | string[];
  }>;
}) {
  const user = await requireUser();
  const query = await searchParams;
  const seedProductId = typeof query.seedProductId === "string" ? query.seedProductId : "";
  const targetShopifyProductId =
    typeof query.targetShopifyProductId === "string" ? query.targetShopifyProductId : "";
  if (!seedProductId || !/^\d+$/.test(targetShopifyProductId)) {
    throw new Error("복구할 내부 상품과 Shopify 대상 상품 번호가 필요합니다.");
  }
  const plan = await previewShopifyVariationRelink(seedProductId, targetShopifyProductId);
  const previewToken = issueShopifyRelinkPreviewToken(seedProductId, targetShopifyProductId);

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1200px] px-4 py-7 sm:px-6">
        <h1 className="text-2xl font-bold">Shopify 중복 묶음 복구 미리보기</h1>
        <p className="mt-1 text-sm text-zinc-600">대상 상품에 모든 SKU가 하나씩 정확히 있는 경우에만 실행할 수 있습니다.</p>
        <ShopifyVariationRelinkClient
          seedProductId={seedProductId}
          targetShopifyProductId={targetShopifyProductId}
          currentShopifyProductId={plan.currentShopifyProductId}
          previewToken={previewToken}
          products={plan.products}
        />
      </main>
    </div>
  );
}
