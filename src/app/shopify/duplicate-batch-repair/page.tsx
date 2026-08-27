import { ShopifyDuplicateBatchRepairClient } from "@/components/ShopifyDuplicateBatchRepairClient";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";
import { issueShopifyDuplicateBatchToken, type ShopifyDuplicateBatchMapping } from "@/lib/services/shopifyRelinkPreview";
import { previewShopifyDuplicateBatch } from "@/lib/services/shopifyVariationRelink";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const mappings: ShopifyDuplicateBatchMapping[] = [
  { currentShopifyProductId: "15244952764784", targetShopifyProductId: "15244952797552" },
  { currentShopifyProductId: "15244953682288", targetShopifyProductId: "15244953616752" },
  { currentShopifyProductId: "15244964430192", targetShopifyProductId: "15244964462960" },
];

export default async function ShopifyDuplicateBatchRepairPage() {
  const user = await requireUser();
  const plans = await previewShopifyDuplicateBatch(mappings);
  return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId}/><main className="mx-auto max-w-[1100px] px-4 py-7 sm:px-6"><h1 className="text-2xl font-bold">Shopify 중복 3개 일괄 복구</h1><p className="mt-1 text-sm text-zinc-600">모든 SKU가 공개상품에 정확히 하나씩 존재하는지 확인했습니다.</p><ShopifyDuplicateBatchRepairClient mappings={mappings} previewToken={issueShopifyDuplicateBatchToken(mappings)} optionCounts={plans.map((plan) => plan.productCount)} /></main></div>;
}
