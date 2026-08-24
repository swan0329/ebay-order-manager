import { TopNav } from "@/components/TopNav";
import { EbayOperationsClient, type OperationsClientData } from "@/components/EbayOperationsClient";
import { requireUser } from "@/lib/session";
import { getEbayOperations, getShopifyOperations } from "@/lib/services/ebayOperations";
import { getEbayVariationImageRepairJobs } from "@/lib/services/ebayVariationImageRepair";
import { getEbayInventoryJobSummary } from "@/lib/services/ebayInventoryJobs";
import { EbayConnectionTest } from "@/components/EbayConnectionTest";
import { EbayApiUsageCard } from "@/components/EbayApiUsageCard";

export const dynamic = "force-dynamic";

export default async function EbayOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string | string[] }>;
}) {
  const user = await requireUser();
  const query = await searchParams;
  const initialChannel = query.channel === "SHOPIFY" ? "SHOPIFY" : "EBAY";
  let initial: OperationsClientData;
  if (initialChannel === "SHOPIFY") initial = await getShopifyOperations() as unknown as OperationsClientData;
  else {
    const operations = await getEbayOperations(user.id);
    // 운영 DB 연결이 하나이므로 상태 조회를 동시에 몰지 않는다.
    const imageRepairJob = await getEbayVariationImageRepairJobs(user.id);
    const inventoryJob = await getEbayInventoryJobSummary(user.id);
    initial = { ...operations, imageRepairJob, inventoryJob } as OperationsClientData;
  }
  return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId}/><main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6"><h1 className="text-2xl font-bold">변동·품단종 관리</h1><p className="mt-1 text-sm text-zinc-600">마켓별 신규등록·가격·재고·품절 대상을 검증하고, 실제 전송 내용을 확인한 뒤 일괄 처리합니다.</p>{initialChannel === "EBAY" && <details className="mt-4 rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">eBay 계정·API 상태 점검</summary><div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="rounded-lg border p-4"><p className="text-sm text-zinc-600">주문 조회와 가격·재고 관리 Trading API 권한을 읽기 전용으로 확인합니다.</p><EbayConnectionTest /></div><EbayApiUsageCard /></div></details>}<EbayOperationsClient initial={initial} initialChannel={initialChannel}/></main></div>;
}
