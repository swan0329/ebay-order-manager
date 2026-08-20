import { SettlementReconciliationClient } from "@/components/SettlementReconciliationClient";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";

export default async function SettlementsPage(){const user=await requireUser();return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId}/><main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6"><h1 className="text-2xl font-bold">정산 대조</h1><p className="mb-6 mt-1 text-sm text-zinc-600">eBay·Shopify 실제 지급액과 저장된 상품 원가를 주문별로 비교합니다.</p><SettlementReconciliationClient/></main></div>}
