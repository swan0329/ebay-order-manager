import { InventoryOnlySyncClient } from "@/components/InventoryOnlySyncClient";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";
import { getMarketIntegrityAudit } from "@/lib/services/marketIntegrityAudit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function InventoryOnlySyncPage() {
  const user = await requireUser();
  const audit = await getMarketIntegrityAudit(user.id);
  const shopifyIds = [...new Set(audit.shopify.quantityIssues.map((row) => row.internalProductId))];
  const ebayIds = [...new Set([
    ...audit.ebay.quantityIssues.map((row) => row.internalProductId),
    ...audit.ebay.variationAudit.quantityIssues.flatMap((row) => row.issues.map((issue) => issue.internalProductId)),
  ])];
  return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId} /><main className="mx-auto max-w-3xl px-4 py-7"><h1 className="text-2xl font-bold">재고 전용 동기화</h1><p className="mt-2 text-sm text-zinc-600">실제 채널 수량과 내부 판매 가능 수량이 다른 상품만 골라 가격은 건드리지 않고 수량만 맞춥니다.</p><InventoryOnlySyncClient shopifyIds={shopifyIds} ebayIds={ebayIds} /></main></div>;
}
