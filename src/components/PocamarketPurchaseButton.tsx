"use client";

import { useCallback, useEffect, useState } from "react";

type PurchaseJob = { id: string; productNumber: string; requestedQuantity: number; purchasedQuantity: number; status: string; warningMessage: string | null };
type BridgeStatus = { online: boolean; deviceSerial: string | null; lastSeenAt: string | null; secondsAgo: number | null };

function bridgeAgeText(secondsAgo: number | null) {
  if (secondsAgo === null) return "한 번도 연결된 적 없음";
  if (secondsAgo < 60) return `${secondsAgo}초 전 응답`;
  const minutes = Math.floor(secondsAgo / 60);
  if (minutes < 60) return `${minutes}분 전 응답`;
  return `${Math.floor(minutes / 60)}시간 전 응답`;
}

const statusLabel: Record<string, string> = {
  queued: "휴대폰 연결 대기", running: "상품 확인 중", awaiting_confirmation: "결제 확인 대기",
  purchasing: "결제 처리 중", completed: "구매 완료", failed: "구매 실패",
  cancelled: "취소", price_blocked: "가격 초과로 구매 중단",
};

export function PocamarketPurchaseButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [jobs, setJobs] = useState<PurchaseJob[]>([]);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/pocamarket-purchases?orderId=${encodeURIComponent(orderId)}`);
    if (!response.ok) return;
    const body = await response.json() as { jobs?: PurchaseJob[]; bridge?: BridgeStatus };
    setJobs(body.jobs ?? []);
    setBridge(body.bridge ?? null);
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
      const skipped = body.skipped ?? [];
      // 아무것도 만들지 않았을 때 빈 문자열을 넣으면 화면에 아무 반응이 없어, 버튼이
      // 고장난 것처럼 보인다. 왜 요청하지 않았는지 항상 한 줄로 알려 준다.
      setMessage(created.length
        ? `${created.map((item) => `${item.productNumber} ${item.quantity}개(최대 ${item.maxUnitPrice.toLocaleString()}원)`).join(", ")} 요청 완료`
        : skipped.length
          ? `새로 요청하지 않았습니다 · ${skipped.join(", ")}`
          : "새로 요청할 재고 부족 상품이 없습니다.");
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

  // 브리지가 꺼져 있으면 대기 중인 작업을 아무도 가져가지 않는다. "휴대폰 연결 대기"만
  // 계속 보여 주면 정상 대기인지 브리지가 죽은 것인지 구분할 수 없으므로 상태를 함께 알린다.
  // 브리지가 있어야 넘어가는 상태들. 대기 중(queued)뿐 아니라 브리지가 이미 가져간
  // 작업(running, purchasing)도 브리지가 꺼지면 그대로 멈춘다. queued만 따지면 화면에
  // "상품 확인 중"만 남아 아무 설명이 없다. 결제 확인 대기는 사람이 할 차례이므로 뺀다.
  const stalledStatuses = ["queued", "running", "purchasing"];
  const waiting = jobs.some((job) => stalledStatuses.includes(job.status));
  const bridgeOffline = bridge !== null && !bridge.online;

  return <div className="mt-2 space-y-1">
    <button type="button" onClick={requestPurchase} disabled={loading} className="rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{loading ? "처리 중..." : "재고없는 포카 구매"}</button>
    {bridge ? <p className={`text-xs font-semibold ${bridge.online ? "text-emerald-700" : "text-rose-600"}`}>
      {bridge.online
        ? `● PC 브리지 연결됨${bridge.deviceSerial ? ` · ${bridge.deviceSerial}` : ""} · ${bridgeAgeText(bridge.secondsAgo)}`
        : `● PC 브리지 꺼짐 · ${bridgeAgeText(bridge.secondsAgo)}`}
    </p> : null}
    {bridgeOffline && waiting ? <p className="rounded bg-rose-50 p-2 text-xs text-rose-800">
      구매 요청은 접수됐지만 <b>PC에서 브리지가 돌고 있지 않아 진행되지 않습니다.</b> 휴대폰 무선 디버깅을 켜고 PC에서 <code className="font-mono">npm run pocamarket:bridge</code>를 실행해 주세요. 브리지가 붙으면 대기 중인 작업이 자동으로 이어집니다.
    </p> : null}
    {jobs.map((job) => <div key={job.id} className="text-xs text-zinc-600">
      <span>{job.productNumber} · {job.purchasedQuantity}/{job.requestedQuantity}개 · {bridgeOffline && stalledStatuses.includes(job.status) ? "브리지 꺼짐 · 멈춤" : statusLabel[job.status] ?? job.status}</span>
      {job.status === "awaiting_confirmation" ? <button type="button" disabled={loading} onClick={() => confirmUnit(job)} className="ml-1 rounded bg-emerald-700 px-1.5 py-0.5 font-semibold text-white">휴대폰 결제 1장 완료</button> : null}
      {job.warningMessage ? <p className="text-rose-600">{job.warningMessage}</p> : null}
    </div>)}
    {message ? <p className="text-xs text-zinc-600" title={message}>{message}</p> : null}
  </div>;
}
