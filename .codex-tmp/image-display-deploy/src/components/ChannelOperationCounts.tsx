"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  productDataChangedEvent,
  notifyProductDataChanged,
} from "@/lib/client-product-refresh";
import type { RegistrationBreakdown } from "@/lib/channel-registration-candidates";

type Counts = {
  procurement?: { due: number; held: number; failures: number; samples: Array<{ sku: string; reason: string }> };
  imageJobs?: Array<null | { id: string; channel: string; status: string; totalCount: number; processedCount: number; successCount: number; failureCount: number; createdAt: string; completedAt: string | null; error: string | null; items: Array<{ id: string; sku: string; status: string; error: string | null }> }>;
  images?: { ebay: number; shopify: number };
  ebay: { register: number; registrationBreakdown?: RegistrationBreakdown; revise: number; end: number; revisePrice: number; reviseQuantity: number; reviseUnverified: number };
  shopify: { register: number; registrationBreakdown?: RegistrationBreakdown; revise: number; end: number };
};

const cells = [
  { key: "register" as const, label: "자동등록 후보 SKU", tone: "text-emerald-700" },
  { key: "revise" as const, label: "가격·수량 변경", tone: "text-blue-700" },
  { key: "images" as const, label: "이미지 변경 필요", tone: "text-violet-700" },
  { key: "end" as const, label: "판매중단 필요", tone: "text-rose-700" },
];

export function ChannelOperationCounts() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const response = await fetch("/api/products/channel-operation-counts", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as Counts & { error?: string };
      if (!response.ok) throw new Error(body?.error ?? "채널별 대상 수를 확인하지 못했습니다.");
      setCounts(body);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "채널별 대상 수를 확인하지 못했습니다.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    window.addEventListener(productDataChangedEvent, load);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(productDataChangedEvent, load);
    };
  }, [load]);


  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
        <div><p className="text-sm font-bold text-zinc-900">채널별 작업 대상</p><p className="mt-1 text-xs text-zinc-500">전체 상품 기준 · 아래에서 상품번호로 범위를 좁힐 수 있습니다.</p></div>
        <button
          type="button"
          onClick={notifyProductDataChanged}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-600 hover:text-zinc-950 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          현황 함께 갱신
        </button>
      </div>
      {error ? (
        <p className="px-3 py-3 text-sm text-rose-700">{error}</p>
      ) : (
        <div className="overflow-x-auto"><div className="grid min-w-[480px] grid-cols-[72px_repeat(4,minmax(0,1fr))] text-center text-xs">
          <div className="border-b border-r border-zinc-100 bg-zinc-50 px-2 py-2 font-semibold text-zinc-500">채널</div>
          {cells.map((cell) => (
            <div key={cell.key} className="border-b border-r border-zinc-100 bg-zinc-50 px-2 py-2 font-semibold text-zinc-600 last:border-r-0">{cell.label}</div>
          ))}
          {(["ebay", "shopify"] as const).map((channel) => (
            <div key={channel} className="contents">
              <div className="border-r border-t border-zinc-100 px-2 py-3 font-bold text-zinc-800 first:border-t-0">{channel === "ebay" ? "eBay" : "Shopify"}</div>
              {cells.map((cell) => (
                <div key={`${channel}:${cell.key}`} className={`border-r border-t border-zinc-100 px-2 py-3 text-lg font-bold last:border-r-0 ${cell.tone}`}>
                  {counts ? (cell.key === "images" ? counts.images?.[channel]?.toLocaleString() ?? "-" : counts[channel][cell.key].toLocaleString()) : "-"}
                  <span className="ml-0.5 text-xs font-medium">개</span>
                </div>
              ))}
            </div>
          ))}
        </div></div>
      )}
      {counts?.procurement ? <details className="border-t bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <summary className="cursor-pointer font-semibold">조달 정보 재확인 {counts.procurement.due}개 · 판매 보류 대상 {counts.procurement.held}개 · 최근 확인 실패 {counts.procurement.failures}개</summary>
        <p className="mt-2">판매 중 조달 상품은 6시간마다 재확인을 목표로 순환합니다. 24시간 경과 또는 확인 실패 시 조달 수량을 0으로 반영하며, 보유 재고는 유지합니다. 이 수는 내부 보류 대상이며 채널 반영 완료 수가 아닙니다. 가격·수량 변동 결과를 함께 확인해 주세요. 보류 처리는 가격을 올린다는 뜻이 아니라 판매 수량을 0으로 반영하는 작업입니다. 자동 최신화 설정을 끄면 정기 재확인·조달 변동 예약도 멈춥니다.</p>
        <p className="mt-1">{counts.procurement.samples.map(p => `${p.sku}: ${p.reason}`).join(" · ")}</p>
      </details> : null}
      {counts ? <details className="space-y-1.5 border-t border-zinc-100 bg-zinc-50/60 px-3 py-3 text-xs leading-relaxed text-zinc-600">
        <summary className="cursor-pointer font-semibold text-zinc-800">자동등록 후보 기준·제외 내역</summary>
        {(["ebay", "shopify"] as const).map(channel => {
          const breakdown = counts[channel].registrationBreakdown;
          if (!breakdown) return null;
          return <p key={channel}><b>{channel === "ebay" ? "eBay" : "Shopify"}</b> · 준비 후보 {breakdown.readyCount.toLocaleString()} = <span className="font-semibold text-emerald-700">자동등록 후보 {counts[channel].register.toLocaleString()}</span> + 기존 연결 제외 {breakdown.linkedExcludedCount.toLocaleString()} + 가격 없음 제외 {breakdown.priceMissingCount.toLocaleString()}</p>;
        })}
        <p>준비 후보는 이미지·공급 기준입니다. 기존 판매 연결이 남은 상품을 먼저 제외하고, 남은 상품 중 포카마켓 가격과 직접 지정 USD 가격이 모두 없는 상품을 제외합니다. Shopify 게시 대기는 기존 상품 재확인 대상으로 포함합니다. 모두 카드 SKU 수이며, 옵션으로 묶인 실제 판매페이지 수와 다릅니다.</p>
      </details> : null}
      <p className="border-t border-zinc-100 px-3 py-2 text-xs text-violet-700">이미지는 가격·수량 변경 수에 합산하지 않습니다. 이미지 1개는 판매상품 1개이며 묶음 대표·전체 옵션을 포함합니다. 두 변경이 겹칠 수 있습니다. 성공 반영 후 대상에서 제외되며 실패한 변경은 남습니다.</p>
      <details className="space-y-2 border-t p-3 text-xs">
        <summary className="cursor-pointer font-semibold">최근 이미지 변동 결과 이력</summary>
        {(["EBAY", "SHOPIFY"] as const).map(channel => {
          const job = counts?.imageJobs?.find(job => job?.channel === channel);
          const label = channel === "EBAY" ? "eBay" : "Shopify";
          if (!job) return <p key={channel}>{label}: {counts ? "이미지 작업 이력 없음" : "조회 중"}</p>;
          const skipped = Math.max(0, job.processedCount - job.successCount - job.failureCount);
          const remaining = Math.max(0, job.totalCount - job.processedCount);
          const status = ({ COMPLETED: "완료", COMPLETED_WITH_ERROR: "일부 실패", FAILED: "실패", CANCELLED: "중단", QUEUED: "대기", RUNNING: "진행 중" } as Record<string, string>)[job.status] ?? job.status;
          return <div key={job.id} className="rounded border bg-zinc-50 p-2">
            <p className="font-semibold">{label} 이미지 · {status} · {new Date(job.createdAt).toLocaleString("ko-KR")}</p>
            <p>대상 {job.totalCount} · 처리 {job.processedCount} · 성공 {job.successCount} · 실패 {job.failureCount} · 변경 없음 {skipped} · 미처리 {remaining}</p>
            {job.error ? <p className="text-rose-700">{job.error}</p> : null}
            {job.items.length ? <details className="mt-1"><summary className="cursor-pointer">실패·진행·변경 없음 상세 (최대 50개)</summary><ul className="max-h-48 overflow-auto">{job.items.map(item => <li key={item.id}>{item.sku} · {item.status === "FAILED" ? "실패" : item.status === "SKIPPED" ? "변경 없음" : "진행 중"} · {item.error}</li>)}</ul></details> : null}
          </div>;
        })}
        <p className="text-zinc-500">최근 작업 결과는 새로고침 후에도 유지됩니다. 대상에 기록된 수와 실제 처리 성공 수는 다릅니다.</p>
      </details>
      {counts?.ebay.revise ? (
        <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-600">
          eBay 변경 {counts.ebay.revise.toLocaleString()}건: 가격 {counts.ebay.revisePrice.toLocaleString()}건 · 수량 {counts.ebay.reviseQuantity.toLocaleString()}건 · 보고서 확인불가 {counts.ebay.reviseUnverified.toLocaleString()}건
        </p>
      ) : null}
    </div>
  );
}
