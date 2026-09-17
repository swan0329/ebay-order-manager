"use client";
import { useCallback, useEffect, useState } from "react";
type State = { group_id: number; brand: string; enabled: boolean; status: string; next_page: number;
  total_count: number; scanned_count: number; created_count: number; total_created: number;
  error_message: string | null; last_completed_at: string | null; next_run_at: string };
const labels: Record<string, string> = { QUEUED: "대기", RUNNING: "수집 중", COMPLETED: "완료", RETRY: "재시도 대기" };
export function PocamarketCatalogPanel() {
  const [states, setStates] = useState<State[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/pocamarket-catalog", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "신상품 수집 조회 실패");
    setStates(body.states);
  }, []);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    async function poll() {
      try { if (document.visibilityState !== "hidden") await refresh(); }
      catch (error) { if (active) setMessage(error instanceof Error ? error.message : "수집 상태 조회 실패"); }
      finally { if (active) timer = window.setTimeout(() => void poll(), 15000); }
    }
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);
  async function update(enabled?: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/pocamarket-catalog", { method: enabled === undefined ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" }, body: enabled === undefined ? undefined : JSON.stringify({ enabled }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "수집 요청 실패");
      setMessage(enabled === false ? "자동 수집을 일시정지했습니다." : "저장된 위치부터 신상품 수집을 진행합니다.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "수집 요청 실패"); }
    finally { setBusy(false); }
  }
  const enabled = states.some((state) => state.enabled);
  return <section id="catalog-discovery" className="scroll-mt-20 mb-6 rounded-xl border border-violet-200 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold">BTS · 스트레이키즈 신상품 수집</h2>
        <p className="mt-1 text-sm text-zinc-600">매일 밤 11시부터 그룹별 상품 목록을 확인합니다. 처음에는 전체 목록을 훑어 상품대장에 없는 카드도 추가합니다.</p>
        <p className="mt-1 text-sm text-zinc-600">신규 카드는 보유 재고 0 · 이미지 작업 대기로 등록되며, 가격은 기존 포카마켓 최신화에서 확인합니다.</p></div>
      <div className="flex gap-2"><button disabled={busy || !states.length} onClick={() => void update(!enabled)} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{enabled ? "자동 수집 일시정지" : "자동 수집 켜기"}</button>
        <button disabled={busy} onClick={() => void update()} className="rounded bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-50">지금 수집 / 이어하기</button></div>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{states.map((state) => <div key={state.group_id} className="rounded-lg bg-zinc-50 p-3 text-sm">
      <p className="font-semibold">{state.brand} · {state.enabled ? labels[state.status] ?? state.status : "일시정지"}</p>
      <p className="mt-1">이번 확인 {state.scanned_count.toLocaleString()} / {state.total_count.toLocaleString()}개 · 신규 {state.created_count.toLocaleString()}개</p>
      <p className="text-zinc-500">누적 추가 {state.total_created.toLocaleString()}개 · 다음 확인 {state.next_page}페이지</p>
      {state.last_completed_at ? <p className="text-zinc-500">최근 완료 {new Date(state.last_completed_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p> : null}
      {state.error_message ? <p className="mt-2 text-rose-700">{state.error_message}</p> : null}
    </div>)}</div>
    {message ? <p className="mt-3 text-sm text-zinc-700">{message}</p> : null}
  </section>;
}
