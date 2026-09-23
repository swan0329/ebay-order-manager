"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type CatalogState = {
  group_id: number; brand: string; enabled: boolean; status: string;
  scanned_count: number; total_count: number; created_count: number;
};

export function useCatalogNavProgress() {
  const [states, setStates] = useState<CatalogState[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        if (document.visibilityState === "hidden") return;
        const response = await fetch("/api/pocamarket-catalog", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        const body = await response.json() as { states: CatalogState[] };
        if (active) { setStates(body.states); setUnavailable(false); }
      } catch { if (active) setUnavailable(true); }
      finally { if (active) timer = setTimeout(() => void poll(), 15000); }
    }
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, []);
  return { states, unavailable };
}

export function CatalogNavProgress({ states, unavailable }: ReturnType<typeof useCatalogNavProgress>) {
  if (!states.length && !unavailable) return null;
  const running = !unavailable && states.some((state) => state.enabled && state.status === "RUNNING");
  return <Link href="/pocamarket-sync#catalog-discovery" prefetch={false}
    className="mx-3 mt-3 block rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
    <span className="flex items-center gap-1.5 font-semibold"><RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />신상품 수집</span>
    {unavailable ? <span className="mt-2 block text-amber-800">상태 확인 지연 · 다시 확인 중</span> : states.map((state) => {
      const percent = state.total_count > 0 ? Math.min(100, Math.floor(state.scanned_count / state.total_count * 100)) : 0;
      const label = !state.enabled ? "일시정지" : ({ RUNNING: "수집 중", QUEUED: "대기", RETRY: "재시도 대기", COMPLETED: "완료" }[state.status] ?? state.status);
      return <span key={state.group_id} className="mt-2 block">
        <span className="flex justify-between gap-1"><span>{state.brand === "Stray Kids" ? "스트레이키즈" : state.brand}</span><span className={state.status === "RETRY" ? "text-amber-800" : ""}>{label} · {state.total_count ? `${percent}%` : "준비 중"}</span></span>
        <span role="progressbar" aria-label={`${state.brand} 신상품 수집`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-1 block h-1.5 overflow-hidden rounded-full bg-sky-100"><span className="block h-full bg-sky-600" style={{ width: `${percent}%` }} /></span>
        <span className="mt-1 block text-[10px] text-sky-800">{state.scanned_count.toLocaleString()} / {state.total_count.toLocaleString()}개 · 신규 {state.created_count.toLocaleString()}개</span>
      </span>;
    })}
  </Link>;
}
