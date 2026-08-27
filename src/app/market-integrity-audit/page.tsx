import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";
import { getMarketIntegrityAudit } from "@/lib/services/marketIntegrityAudit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function MarketIntegrityAuditPage() {
  const user = await requireUser();
  const audit = await getMarketIntegrityAudit(user.id);
  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6">
        <h1 className="text-2xl font-bold">마켓 전체 무결성 점검</h1>
        <p className="mt-1 text-sm text-zinc-600">읽기 전용으로 내부 연결과 Shopify·eBay 실제 상태를 대조한 결과입니다.</p>
        <pre className="mt-6 overflow-auto whitespace-pre-wrap rounded-xl border bg-white p-5 text-xs leading-5">{JSON.stringify(audit, null, 2)}</pre>
      </main>
    </div>
  );
}
