"use client";

import { useCallback, useEffect, useState } from "react";

type PurchaseJob = { id: string; version: string; productNumber: string; requestedQuantity: number; purchasedQuantity: number; status: string; warningMessage: string | null };

const statusLabel: Record<string, string> = {
  queued: "휴대폰 연결 대기", running: "상품 확인 중", awaiting_confirmation: "결제 확인 대기",
  purchasing: "결제 처리 중", completed: "구매 완료", failed: "구매 실패",
  cancelled: "취소", price_blocked: "가격 초과로 구매 중단",
};

export function PocamarketPurchaseButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [jobs, setJobs] = useState<PurchaseJob[]>([]);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/pocamarket-purchases?orderId=${encodeURIComponent(orderId)}`);
    if (!response.ok) return;
    const body = await response.json() as { jobs?: PurchaseJob[] };
    setJobs(body.jobs ?? []);
  }, [orderId]);

  useEffect(() => {
    const check = () => void refresh().catch(() => setMessage("구매 상태 조회가 지연됐습니다. 연결 후 상태 확인을 눌러 주세요."));
    const initial = window.setTimeout(check, 0);
    const timer = window.setInterval(check, 5000);
    window.addEventListener("focus", check);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [refresh]);

  async function requestPurchase() {
    if (!window.confirm("재고 부족 수량만 포카마켓 구매 대기열에 추가할까요? 기준가격의 120%를 넘으면 구매하지 않으며, 결제 직전에 휴대폰 확인이 필요합니다.")) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/pocamarket-purchases", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId }),
      });
      const body = await response.json() as { error?: string; created?: Array<{ productNumber: string; quantity: number; maxUnitPrice: number }>; skipped?: string[] };
      if (!response.ok) throw new Error(body.error ?? "구매 요청에 실패했습니다.");
      const created = body.created ?? [];
      setMessage(created.length
        ? `${created.map((item) => `${item.productNumber} ${item.quantity}개(최대 ${item.maxUnitPrice.toLocaleString()}원)`).join(", ")} 요청 완료`
        : (body.skipped ?? []).join(", "));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "구매 요청에 실패했습니다.");
    } finally { setLoading(false); }
  }

  async function confirmUnit(job: PurchaseJob) {
    if (!window.confirm(`${job.productNumber} 한 장의 휴대폰 결제를 실제로 완료했습니까?`)) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/pocamarket-purchases/${job.id}/confirm-unit`, { method: "POST" });
      const body = await response.json() as { error?: string; job?: { purchasedQuantity: number; requestedQuantity: number; status: string } };
      if (!response.ok) throw new Error(body.error ?? "결제 완료 처리에 실패했습니다.");
      setMessage(body.job?.status === "completed" ? "요청 수량 구매 완료" : `1장 완료 처리했습니다. 다음 판매자의 결제 화면을 준비합니다.`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "결제 완료 처리에 실패했습니다."); }
    finally { setLoading(false); }
  }

  async function retryJob(job: PurchaseJob) {
    if (!window.confirm(`${job.productNumber} 남은 ${job.requestedQuantity-job.purchasedQuantity}장을 구매하지 않았나요? 포카마켓 구매내역을 확인하고, 열려 있는 결제창은 닫은 뒤 확인하세요. 이미 완료한 수량과 기존 최대 허용가격은 유지됩니다.`)) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/pocamarket-purchases/${job.id}/retry`, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({confirmedNotPurchased:true,version:job.version}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "재시도 요청에 실패했습니다.");
      setMessage(`${job.productNumber} 미구매 수량을 다시 요청했습니다. 기존 허용가격을 초과하면 다시 중단됩니다.`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "재시도 요청에 실패했습니다."); }
    finally { setLoading(false); }
  }

  const activeStatuses = new Set(["queued", "running", "purchasing", "awaiting_confirmation"]);
  const activeProducts = new Set(jobs.filter(job => activeStatuses.has(job.status)).map(job => job.productNumber));
  const seenProducts = new Set<string>();
  const currentJobs: PurchaseJob[] = [];
  const historyJobs: PurchaseJob[] = [];
  // API order is newest first. Keep every active job visible, plus the latest unresolved result per card.
  for (const job of jobs) {
    const latest = !seenProducts.has(job.productNumber);
    seenProducts.add(job.productNumber);
    if (activeStatuses.has(job.status) || (latest && !activeProducts.has(job.productNumber) && !["completed", "cancelled"].includes(job.status))) currentJobs.push(job);
    else historyJobs.push(job);
  }

  function jobRow(job: PurchaseJob) {
    return <div key={job.id} className="space-y-1 rounded border border-zinc-200 bg-white p-2 text-xs text-zinc-600">
      <div><span className="font-semibold">{job.productNumber}</span> · {job.purchasedQuantity}/{job.requestedQuantity}개 · {statusLabel[job.status] ?? job.status}</div>
      {job.status === "awaiting_confirmation" ? <button type="button" disabled={loading} onClick={() => confirmUnit(job)} className="rounded bg-emerald-700 px-1.5 py-0.5 font-semibold text-white">휴대폰 결제 1장 완료</button> : null}
      {["failed", "price_blocked", "cancelled", "awaiting_confirmation"].includes(job.status) && job.purchasedQuantity < job.requestedQuantity ? <button type="button" disabled={loading} onClick={() => retryJob(job)} className="rounded border border-blue-300 bg-white px-1.5 py-0.5 font-semibold text-blue-800 disabled:opacity-50">미구매 확인 후 다시 요청</button> : null}
      {job.warningMessage ? <details><summary className="cursor-pointer text-rose-700">사유 보기</summary><p className="mt-1 break-words text-rose-600">{job.warningMessage}</p></details> : null}
    </div>;
  }

  return <div className="mt-2 space-y-2">
    <button type="button" onClick={requestPurchase} disabled={loading} className="rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{loading ? "처리 중..." : "재고없는 포카 구매"}</button>
    <div className="flex flex-wrap gap-1 text-xs">
      <a href="http://127.0.0.1:43127/?reconnect=1" target="_blank" rel="noreferrer" className="rounded border border-blue-300 bg-white px-2 py-1 font-semibold text-blue-800">휴대폰 연결·다시 연결</a>
      <button type="button" disabled={loading} onClick={() => void refresh().catch(() => setMessage("구매 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요."))} className="rounded border border-zinc-300 bg-white px-2 py-1">연결 후 상태 확인</button>
    </div>
    <details className="text-xs text-zinc-500"><summary className="cursor-pointer">휴대폰 연결 도움말</summary><p className="mt-1">무선 디버깅을 켜고 다시 연결하세요. 대기 요청은 그대로 이어지므로 구매 버튼을 다시 누를 필요가 없습니다. 연결 창이 열리지 않으면 이 PC의 ‘포카마켓-휴대폰-연결.cmd’를 실행하세요. PC와 휴대폰은 같은 Wi-Fi여야 합니다. 실패·결제 확인 대기 작업은 자동 재구매하지 않습니다.</p></details>
    {currentJobs.length ? <div className="space-y-1">{currentJobs.map(jobRow)}</div> : null}
    {historyJobs.length ? <details className="rounded border border-zinc-200 p-2 text-xs text-zinc-500"><summary className="cursor-pointer font-semibold">이전·완료 내역 {historyJobs.length}건</summary><p className="my-2">구매 수량 확인을 위해 기록은 보관됩니다.</p><div className="max-h-64 space-y-1 overflow-y-auto">{historyJobs.map(jobRow)}</div></details> : null}
    {message ? <div className="flex items-start gap-1 rounded bg-zinc-50 p-1 text-xs text-zinc-600"><p className="min-w-0 flex-1 break-words">{message}</p><button type="button" onClick={() => setMessage("")} aria-label="구매 안내 닫기" className="shrink-0 px-1">×</button></div> : null}
  </div>;
}
