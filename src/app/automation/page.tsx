import { AutomationRulesClient } from "@/components/AutomationRulesClient";
import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { ensureDefaultAutomationRule, ZERO_STOCK_END_LISTING } from "@/lib/services/automationRules";

export default async function AutomationPage() {
  const user = await requireUser();
  const [rule, events] = await Promise.all([
    ensureDefaultAutomationRule(),
    prisma.automationEvent.findMany({ where: { rule: { key: ZERO_STOCK_END_LISTING } }, orderBy: { createdAt: "desc" }, take: 30, include: { product: { select: { sku: true, productName: true } } } }),
  ]);
  return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId}/><main className="mx-auto max-w-5xl px-4 py-7 sm:px-6"><h1 className="text-2xl font-bold">자동화 규칙</h1><p className="mb-6 mt-1 text-sm text-zinc-600">돈·재고·리스팅에 영향을 주는 규칙을 검토하고 실행 수준을 정합니다.</p><AutomationRulesClient initialEnabled={rule.enabled} initialMode={rule.mode}/><section className="mt-6 rounded-2xl border bg-white p-6"><h2 className="text-lg font-bold">최근 실행·알림</h2><div className="mt-4 space-y-2">{events.length?events.map(event=><div key={event.id} className="rounded-xl border px-4 py-3 text-sm"><div className="flex justify-between gap-3"><span className="font-semibold">{event.product?.sku ?? "삭제된 상품"} · {event.status}</span><time className="text-xs text-zinc-500">{event.createdAt.toLocaleString("ko-KR")}</time></div><p className="mt-1 text-zinc-600">{event.message}</p></div>):<p className="text-sm text-zinc-500">아직 기록이 없습니다.</p>}</div></section></main></div>;
}
