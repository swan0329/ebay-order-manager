"use client";

import { useCallback, useEffect, useState } from "react";

type PurchaseJob = { id: string; productNumber: string; requestedQuantity: number; purchasedQuantity: number; status: string; warningMessage: string | null };

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
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
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

  return <div className="mt-2 space-y-1"><button type="button" onClick={requestPurchase} disabled={loading} className="rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{loading ? "처리 중..." : "재고없는 포카 구매"}</button>{jobs.map((job) => <div key={job.id} className="text-xs text-zinc-600"><span>{job.productNumber} · {job.purchasedQuantity}/{job.requestedQuantity}개 · {statusLabel[job.status] ?? job.status}</span>{job.status === "awaiting_confirmation" ? <button type="button" disabled={loading} onClick={() => confirmUnit(job)} className="ml-1 rounded bg-emerald-700 px-1.5 py-0.5 font-semibold text-white">휴대폰 결제 1장 완료</button> : null}{job.warningMessage ? <p className="text-rose-600">{job.warningMessage}</p> : null}</div>)}{message ? <p className="text-xs text-zinc-600" title={message}>{message}</p> : null}</div>;
}
