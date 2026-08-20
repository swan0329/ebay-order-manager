import { TopNav } from "@/components/TopNav";
import { EbayOperationsClient } from "@/components/EbayOperationsClient";
import { requireUser } from "@/lib/session";
import { getEbayOperations } from "@/lib/services/ebayOperations";

export const dynamic = "force-dynamic";

export default async function EbayOperationsPage() {
  const user = await requireUser();
  const initial = await getEbayOperations(user.id);
  return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId}/><main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6"><h1 className="text-2xl font-bold">변동·품단종 관리</h1><p className="mt-1 text-sm text-zinc-600">마켓별 신규등록·가격·재고·품절 대상을 검증하고, 실제 전송 내용을 확인한 뒤 일괄 처리합니다.</p><EbayOperationsClient initial={initial}/></main></div>;
}
