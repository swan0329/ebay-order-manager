"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Channel = "EBAY" | "SHOPIFY";
type Tab = "create" | "change" | "unavailable" | "review";
type OptionChange = { sku: string; name?: string; previousQuantity?: number | null; quantity: number; previousPrice?: number | null; price: number | null };
type CreateRow = { id: string; productId: string | null; productIds?: string[]; sku: string; name: string; price: number | null; priceMax?: number | null; quantity: number | null; optionCount?: number; listingType?: "SINGLE" | "VARIATION"; options?: OptionChange[]; status: string; error: string | null };
type ReviseRow = { productId: string; productIds?: string[]; sku: string; productName: string; itemId: string; quantity: number; price: number | null; previousQuantity: number | null; previousPrice: number | null; listingType?: "SINGLE" | "VARIATION_OPTION" | "VARIATION"; parentTitle?: string | null; optionCount?: number; affectedOptions?: OptionChange[]; stock?: number; reserved?: number; safetyStock?: number; ownSellableQuantity?: number; pocamarketAvailableCount?: number | null; pocamarketListingQuantity?: number; pocamarketFresh?: boolean; availabilityStatus?: string; actionable?: boolean };
type UnavailableRow = ReviseRow & { reason: string };
type Summary = { createReady?: number; createNeedsReview?: number; createCountMeaning?: string; unavailableOptions?: number; unavailableSingles?: number; sourceReview?: number; heldForOrder?: number; shopifyListings?: number; shopifyVariationListings?: number; shopifySingleListings?: number; shopifyOptions?: number };
export type OperationsClientData = { create: CreateRow[]; change: ReviseRow[]; unavailable: UnavailableRow[]; review: UnavailableRow[]; limits: { createBatch: number; reviseBatch: number }; summary?: Summary };
type PreviewRow = { id?: string; productId?: string | null; sku: string; title?: string; name?: string; productName?: string; itemId?: string; price: number | null; priceMax?: number | null; previousPrice?: number | null; quantity: number | null; previousQuantity?: number | null; imageCount?: number; optionCount?: number; listingType?: "SINGLE" | "VARIATION_OPTION" | "VARIATION"; parentTitle?: string | null; options?: OptionChange[]; affectedOptions?: OptionChange[]; valid?: boolean; issues?: Array<{ field: string; message: string }> };
type Preview = { token?: string; rows: PreviewRow[]; action: Tab; valid: boolean; estimateSeconds?: { minimum: number; maximum: number } };
type Result = { succeeded: number; failed: number; rows: Array<{ sku: string; status: "성공" | "실패"; message: string; productId?: string }> };
type WorkLog = { id: string; startedAt: Date; channel: Channel; action: Tab; requested: number; succeeded: number; failed: number; message: string };

const money = (value: number | null | undefined) => value == null ? "-" : `$${value.toFixed(2)}`;
const actionName = (tab: Tab) => tab === "create" ? "신규등록" : tab === "change" ? "가격·재고 변경" : tab === "unavailable" ? "품절·판매중지" : "판매 보류·확인 필요";

export function EbayOperationsClient({ initial, initialChannel = "EBAY" }: { initial: OperationsClientData; initialChannel?: Channel }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<Tab>("create");
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preview" | "sending">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<WorkLog[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const rows = tab === "create" ? data.create : tab === "change" ? data.change : tab === "unavailable" ? data.unavailable : data.review;
  const ids = useMemo(() => rows.flatMap((row) => {
    if (tab === "create") return (row as CreateRow).productId ? [(row as CreateRow).productId!] : [];
    const revise = row as ReviseRow;
    return revise.actionable === false ? [] : [revise.productId];
  }), [rows, tab]);
  const max = tab === "create" ? data.limits.createBatch : data.limits.reviseBatch;
  const selectableIds = ids.slice(0, max);
  const all = selectableIds.length > 0 && selectableIds.every((id) => selected.includes(id));

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  function resetReview() { setPreview(null); setResult(null); setMessage(""); }
  function choose(next: Tab) { setTab(next); setSelected([]); resetReview(); }
  function toggleAll() { setSelected(all ? [] : selectableIds); setPreview(null); }
  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length >= max ? current : [...current, id]);
    setPreview(null);
  }

  async function load(nextChannel: Channel) {
    setElapsed(0); setBusy(true); setPhase("preview"); resetReview();
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch(`/api/ebay/operations?channel=${nextChannel}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "목록을 불러오지 못했습니다.");
      setData(body); setChannel(nextChannel); setTab("create"); setSelected([]);
    } catch (error) { setMessage(error instanceof DOMException && error.name === "AbortError" ? "조회 작업을 중지했습니다." : error instanceof Error ? error.message : "조회 실패"); }
    finally { if (abortRef.current === controller) abortRef.current = null; setBusy(false); setPhase("idle"); }
  }

  async function refresh() {
    const response = await fetch(`/api/ebay/operations?channel=${channel}`, { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }

  async function send(previewData: Preview, targetIds: string[]) {
    if (!previewData.token || !previewData.valid) return;
    try {
      const ebayCreate = channel === "EBAY" && tab === "create";
      const url = ebayCreate ? "/api/listing-upload/drafts/upload" : "/api/ebay/operations";
      const body = ebayCreate ? { ids: previewData.rows.flatMap((row) => row.id ? [row.id] : []), dryRun: false, confirmed: true, previewToken: previewData.token } : { action: tab === "create" ? "CREATE" : tab === "change" ? "CHANGE" : tab === "unavailable" ? "UNAVAILABLE" : "REVIEW", productIds: targetIds, dryRun: false, confirmed: true, previewToken: previewData.token, channel };
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const output = await response.json();
      if (!response.ok) throw new Error(output.error ?? "전송 실패");
      const failedRows = Array.isArray(output.failed) ? output.failed : Array.isArray(output.results) ? output.results.filter((item: { error?: string }) => item.error) : [];
      const failedCount = failedRows.length || Number(output.failed ?? 0);
      const succeeded = output.uploaded ?? output.succeeded ?? Math.max(0, targetIds.length - failedCount);
      const resultRows = previewData.rows.map((row, index) => {
        const failure = failedRows.find((item: { itemId?: string; productId?: string; reason?: string; error?: string }) => item.itemId === row.itemId || item.productId === row.productId) ?? (index >= succeeded ? failedRows[index - succeeded] : null);
        return { sku: row.sku, productId: row.productId ?? undefined, status: failure ? "실패" as const : "성공" as const, message: failure?.reason ?? failure?.error ?? (failure ? "전송 실패" : "전송 완료") };
      });
      setResult({ succeeded, failed: failedCount, rows: resultRows });
      setMessage(`작업 완료: 성공 ${succeeded}건 · 실패 ${failedCount}건`);
      setHistory((current) => [{ id: crypto.randomUUID(), startedAt: new Date(), channel, action: tab, requested: previewData.rows.length, succeeded, failed: failedCount, message: failedCount ? "일부 실패 — 실패 건만 재검증 후 재시작 가능" : "완료" }, ...current].slice(0, 10));
      setPreview(null); setSelected([]); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "전송 실패"); }
  }

  // 사용자가 "작업 시작"을 누르는 것이 실제 적용 승인이다. 화면에 긴 검토표를
  // 띄우지는 않지만, 서버에서는 항상 같은 최신 대상과 토큰을 먼저 검증한 뒤에만
  // 외부 마켓 쓰기를 시작한다. 검증에서 빠진 항목은 전송하지 않고 결과로 남긴다.
  async function startAutomatically(targetIds = selected) {
    if (!targetIds.length) return;
    setElapsed(0); setBusy(true); setPhase("preview"); setMessage(""); setResult(null); setPreview(null);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/ebay/operations", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: tab === "create" ? "CREATE" : tab === "change" ? "CHANGE" : tab === "unavailable" ? "UNAVAILABLE" : "REVIEW", productIds: targetIds, dryRun: true, channel }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "자동 검증 실패");
      const candidate: Preview = { token: body.previewToken, rows: body.rows ?? body.drafts ?? [], action: tab, valid: body.valid !== false && Boolean(body.previewToken), estimateSeconds: body.estimateSeconds };
      if (!candidate.valid) {
        setPreview(candidate);
        setMessage("자동 검증에서 제외된 항목이 있습니다. 이 항목들은 마켓에 전송하지 않았습니다.");
        return;
      }
      setPhase("sending");
      await send(candidate, targetIds);
    } catch (error) { setMessage(error instanceof DOMException && error.name === "AbortError" ? "작업 시작 전 자동 검증을 중지했습니다." : error instanceof Error ? error.message : "자동 적용 실패"); }
    finally { if (abortRef.current === controller) abortRef.current = null; setBusy(false); setPhase("idle"); }
  }

  function downloadResult() {
    if (!result) return;
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = ["SKU,상태,메시지", ...result.rows.map((row) => [row.sku, row.status, row.message].map(escape).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${channel.toLowerCase()}-${tab}-result.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  function downloadFailures() {
    if (!result) return;
    const failed = result.rows.filter((row) => row.status === "실패");
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = ["SKU,상태,오류 메시지", ...failed.map((row) => [row.sku, row.status, row.message].map(escape).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${channel.toLowerCase()}-${tab}-failures.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  async function retryFailures() {
    const failedIds = [...new Set(result?.rows.filter((row) => row.status === "실패").flatMap((row) => row.productId ? [row.productId] : []) ?? [])];
    if (!failedIds.length) { setMessage("재시작할 실패 항목이 없습니다."); return; }
    setSelected(failedIds); setPreview(null); setMessage(`실패 ${failedIds.length}건을 다시 검증하고 적용합니다.`);
    await startAutomatically(failedIds);
  }

  function stopCurrentWork() {
    if (phase === "sending") {
      setMessage("외부 마켓 전송은 중간 취소 시 결과가 불명확해질 수 있어 서버 응답을 기다립니다. 완료 후 실패 항목만 안전하게 재시작할 수 있습니다.");
      return;
    }
    abortRef.current?.abort();
  }

  return <div className="mt-6 space-y-4">
    <div className="flex gap-2 rounded-2xl border bg-white p-2">{(["EBAY", "SHOPIFY"] as const).map((item) => <button key={item} disabled={busy} onClick={() => void load(item)} className={`flex-1 rounded-xl px-4 py-3 font-bold ${channel === item ? (item === "EBAY" ? "bg-violet-600 text-white" : "bg-emerald-600 text-white") : "text-zinc-600"}`}>{item === "EBAY" ? "eBay" : "Shopify"}</button>)}</div>
    {channel === "EBAY" && data.summary && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"><b>신규등록 숫자의 의미:</b> {data.summary.createCountMeaning}. 검증 전·실패 초안 {(data.summary.createNeedsReview ?? 0).toLocaleString()}건은 신규등록 수에 포함하지 않습니다.<span className="ml-3">실제 품절·중지: 묶음 옵션 {data.summary.unavailableOptions ?? 0}건 / 단품 {data.summary.unavailableSingles ?? 0}건</span>{(data.summary.heldForOrder ?? 0) > 0 && <span className="ml-3">판매 보류 {data.summary.heldForOrder}건</span>}{(data.summary.sourceReview ?? 0) > 0 && <span className="ml-3 font-bold text-amber-800">포카 재고 확인 필요 {data.summary.sourceReview}건 — 자동 전송 제외</span>}</div>}
    {channel === "SHOPIFY" && data.summary && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"><b>Shopify 등록 단위:</b> 카드 {data.summary.shopifyOptions ?? 0}장을 묶음상품 {data.summary.shopifyVariationListings ?? 0}개와 단품 {data.summary.shopifySingleListings ?? 0}개, 총 {data.summary.shopifyListings ?? 0}개 리스팅으로 계산합니다.</div>}
    <div className="grid gap-3 sm:grid-cols-4">{([['create', '신규등록', data.create.length], ['change', '가격·재고 변동', data.change.length], ['unavailable', '품절·판매중지', data.unavailable.length], ['review', '판매 보류·확인', data.review.length]] as const).map(([key, label, count]) => <button key={key} disabled={busy} onClick={() => choose(key)} className={`rounded-2xl border p-4 text-left disabled:opacity-50 ${tab === key ? "border-violet-600 bg-violet-50" : "bg-white"}`}><span className="text-sm text-zinc-500">{label}</span><strong className="mt-1 block text-2xl">{count.toLocaleString()}건</strong></button>)}</div>
    <section className="overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b bg-zinc-50 p-3">
        <button onClick={() => void startAutomatically()} disabled={busy || !selected.length} className="rounded-lg border border-violet-700 bg-white px-4 py-2 text-sm font-bold text-violet-800 disabled:opacity-40">작업 시작 · 자동 검증 후 적용</button>
        <button onClick={() => void retryFailures()} disabled={busy || !result?.failed} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40">실패건 재시작</button>
        <button onClick={() => { setResult(null); setPreview(null); setMessage(""); }} disabled={busy || (!result && !preview)} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40">완료작업 지우기</button>
        <button onClick={() => { setSelected([]); resetReview(); }} disabled={busy || !selected.length} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40">선택 해제</button>
        <button onClick={stopCurrentWork} disabled={!busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">작업 중지</button>
        <div className="ml-auto flex gap-2"><button onClick={downloadResult} disabled={!result} className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-40">결과 CSV</button><button onClick={downloadFailures} disabled={!result?.failed} className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-40">오류 CSV</button></div>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-xl border bg-zinc-50 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-zinc-500">작업 상태</p><p className="mt-1 font-bold">{busy ? phase === "sending" ? `${channel === "EBAY" ? "eBay" : "Shopify"} 전송 진행 중` : "대상 검증·미리보기 중" : preview ? "사람의 최종 확인 대기" : result ? result.failed ? "일부 실패 — 재시작 가능" : "작업 완료" : "대기"}</p></div><span className={`rounded-full px-3 py-1 text-sm font-bold ${busy ? "bg-blue-100 text-blue-800" : result?.failed ? "bg-amber-100 text-amber-800" : result ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"}`}>{busy ? `${elapsed}초` : result ? `성공 ${result.succeeded} · 실패 ${result.failed}` : `선택 ${selected.length}건`}</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200"><div className={`h-full rounded-full ${busy ? "w-1/2 animate-pulse bg-violet-600" : preview ? "w-3/4 bg-violet-600" : result ? "w-full bg-emerald-600" : selected.length ? "w-1/4 bg-zinc-500" : "w-0"}`} /></div>
          <p className="mt-3 text-sm text-zinc-600">{busy ? phase === "sending" ? `선택 ${selected.length}건을 서버가 처리하고 있습니다. 결과는 성공·실패별로 표시됩니다.` : "현재 목록과 재고·가격·옵션 조건을 다시 확인하고 있습니다." : preview ? `${preview.rows.length}개 항목은 자동 검증에서 제외되어 마켓에 전송하지 않았습니다.` : result ? message : "목록에서 항목을 선택한 뒤 ‘작업 시작’을 누르면 자동 검증을 통과한 항목만 바로 적용합니다."}</p>
        </div>
        <div className="rounded-xl border p-4"><p className="text-xs font-semibold text-zinc-500">처리 집계</p><div className="mt-2 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-zinc-100 p-2"><b className="block text-lg">{selected.length}</b><span className="text-xs text-zinc-600">선택</span></div><div className="rounded-lg bg-emerald-50 p-2"><b className="block text-lg text-emerald-800">{result?.succeeded ?? 0}</b><span className="text-xs text-zinc-600">성공</span></div><div className="rounded-lg bg-red-50 p-2"><b className="block text-lg text-red-800">{result?.failed ?? 0}</b><span className="text-xs text-zinc-600">실패</span></div></div><p className="mt-3 text-xs text-zinc-500">전송 중에는 안전상 강제 취소하지 않습니다. 응답 후 실패한 항목만 다시 검증해 재시작합니다.</p></div>
      </div>
    </section>
    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div className="flex flex-wrap items-center gap-2"><button onClick={toggleAll} disabled={!ids.length || busy} className="rounded-lg border px-3 py-2 text-sm font-semibold">{all ? "전체 선택 해제" : `대상 일괄 선택 (최대 ${max}건)`}</button><span className="text-sm text-zinc-500">선택 {selected.length} / 실제 대상 {ids.length} · 자동 검증 통과분만 적용</span></div><button onClick={() => void refresh()} disabled={busy} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">목록 새로고침</button></div>
      {busy && <div className="border-b bg-zinc-50 p-4"><div className="mb-2 flex justify-between text-sm"><b>{phase === "sending" ? `${channel === "EBAY" ? "eBay" : "Shopify"} 전송 처리 중` : "데이터 확인 중"}</b><span>{elapsed}초 경과</span></div><div className="h-2 overflow-hidden rounded bg-zinc-200"><div className="h-full w-1/2 animate-pulse rounded bg-violet-600" /></div>{phase === "sending" && <p className="mt-2 text-xs text-zinc-600">전송 요청 후에는 중복·불일치를 막기 위해 강제 중지하지 않습니다. 서버 응답이 오면 성공·실패를 나눠 표시합니다.</p>}</div>}
      {message && <p className="border-b bg-amber-50 p-3 text-sm">{message}</p>}
      <div className="max-h-[620px] overflow-auto"><table className="w-full min-w-[1450px] text-left text-sm"><thead className="sticky top-0 bg-zinc-100"><tr><th className="p-3">선택</th><th>마켓</th><th>작업</th><th>SKU</th><th>상품명</th><th>내 재고/예약/안전</th><th>포카 빠른구매</th><th>마켓 상품 ID</th><th>기존 가격 → 전송 가격</th><th>기존 수량 → 전송 수량</th><th>판정</th></tr></thead><tbody>
        {rows.map((row) => { const create = tab === "create" ? row as CreateRow : null; const revise = tab !== "create" ? row as ReviseRow : null; const id = create?.productId ?? revise!.productId; const selectable = revise?.actionable !== false; return <tr key={id} className={`border-t ${!selectable ? "bg-amber-50 text-zinc-500" : ""}`}><td className="p-3"><input aria-label={`${row.sku} 선택`} type="checkbox" disabled={!selectable} checked={selected.includes(id)} onChange={() => toggle(id)} /></td><td>{channel === "EBAY" ? "eBay" : "Shopify"}</td><td>{actionName(tab)}{(create?.listingType === "VARIATION" || revise?.listingType?.startsWith("VARIATION")) ? <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">옵션</span> : null}</td><td>{row.sku}</td><td className="max-w-sm truncate">{create?.name ?? revise?.parentTitle ?? revise?.productName}</td><td>{revise ? `${revise.stock ?? "-"} / ${revise.reserved ?? "-"} / ${revise.safetyStock ?? "-"} → 판매가능 ${revise.ownSellableQuantity ?? "-"}` : "-"}</td><td>{revise ? revise.pocamarketFresh ? `${revise.pocamarketAvailableCount ?? "미확인"}개 → 반영 ${revise.pocamarketListingQuantity ?? 0}개` : "미확인·24시간 초과" : "-"}</td><td>{revise?.itemId ?? "신규"}</td><td>{revise ? `${money(revise.previousPrice)} → ${money(revise.price)}` : create?.priceMax != null && create.priceMax !== create.price ? `${money(create.price)}~${money(create.priceMax)}` : money(create?.price)}</td><td>{revise ? `${revise.previousQuantity ?? "-"} → ${revise.quantity}` : create?.optionCount && create.optionCount > 1 ? `${create.optionCount}개 옵션 · 총 ${create.quantity}` : create?.quantity ?? "-"}</td><td>{tab === "unavailable" || tab === "review" ? (row as UnavailableRow).reason : create?.error ?? create?.status ?? "변경 필요"}</td></tr>; })}
        {!rows.length && <tr><td colSpan={11} className="p-10 text-center text-zinc-500">현재 이 마켓에서 실제 처리할 항목이 없습니다.</td></tr>}
      </tbody></table></div>
    </section>
    {preview && <section className="rounded-2xl border border-red-300 bg-red-50 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">자동 검증 제외 · {preview.rows.length}개 리스팅</h2><p className="mt-1 text-sm">아래 항목은 최신 재고·가격·옵션·포카마켓 조건을 통과하지 못해 마켓에 전송하지 않았습니다.</p></div><span className="rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-800">전송 제외</span></div><div className="mt-4 max-h-80 overflow-auto rounded-xl border bg-white"><table className="w-full min-w-[950px] text-left text-sm"><thead className="sticky top-0 bg-zinc-100"><tr><th className="p-3">SKU</th><th>상품명</th><th>가격</th><th>수량</th><th>옵션 구성</th><th>이미지</th><th>검증 결과</th></tr></thead><tbody>{preview.rows.map((row) => { const options = row.options ?? row.affectedOptions ?? []; return <tr key={row.id ?? row.productId ?? row.sku} className="border-t"><td className="p-3 font-medium">{row.sku}</td><td>{row.parentTitle ?? row.title ?? row.name ?? row.productName ?? "-"}</td><td>{row.previousPrice !== undefined ? `${money(row.previousPrice)} → ${money(row.price)}` : row.priceMax != null && row.priceMax !== row.price ? `${money(row.price)}~${money(row.priceMax)}` : money(row.price)}</td><td>{row.previousQuantity !== undefined ? `${row.previousQuantity ?? "-"} → ${row.quantity ?? "-"}` : row.quantity ?? "-"}</td><td>{options.length ? options.map((option) => `${option.sku}: ${option.previousQuantity ?? "-"}→${option.quantity}`).join(" / ") : row.listingType === "VARIATION_OPTION" ? `부모상품은 유지 · 옵션 SKU ${row.sku}만 수정` : row.optionCount && row.optionCount > 1 ? `${row.optionCount}개 옵션` : "단품"}</td><td>{row.imageCount == null ? "-" : `${row.imageCount}장`}</td><td className={row.valid === false ? "text-red-700" : "text-emerald-700"}>{row.issues?.length ? row.issues.map((issue) => issue.message).join(" / ") : "검증 토큰이 생성되지 않음"}</td></tr>; })}</tbody></table></div><div className="mt-4 flex justify-end"><button onClick={() => setPreview(null)} disabled={busy} className="rounded-lg border bg-white px-4 py-2">제외 목록 닫기</button></div></section>}
    {result && <section className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">작업 결과</h2><p className="text-sm text-zinc-600">성공 {result.succeeded}건 · 실패 {result.failed}건</p></div><div className="flex gap-2"><button onClick={downloadResult} className="rounded-lg border px-4 py-2 text-sm font-semibold">결과 CSV 다운로드</button><button onClick={() => setResult(null)} className="rounded-lg border px-4 py-2 text-sm">결과 화면 지우기</button></div></div><div className="mt-4 max-h-72 overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="bg-zinc-100"><th className="p-3">SKU</th><th>상태</th><th>메시지</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.sku} className="border-t"><td className="p-3">{row.sku}</td><td className={row.status === "성공" ? "text-emerald-700" : "text-red-700"}>{row.status}</td><td>{row.message}</td></tr>)}</tbody></table></div></section>}
    {history.length > 0 && <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">이번 화면의 작업 이력</h2><p className="mt-1 text-sm text-zinc-600">브라우저를 닫거나 새로고침하기 전까지 최근 10건을 보관합니다. 실제 마켓 반영 결과는 위 결과 CSV로 내려받아 보관할 수 있습니다.</p><div className="mt-4 overflow-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="bg-zinc-100"><th className="p-3">시각</th><th>마켓</th><th>작업</th><th>요청</th><th>성공</th><th>실패</th><th>작업 메시지</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.id} className="border-t"><td className="p-3">{entry.startedAt.toLocaleTimeString("ko-KR")}</td><td>{entry.channel === "EBAY" ? "eBay" : "Shopify"}</td><td>{actionName(entry.action)}</td><td>{entry.requested}</td><td className="text-emerald-700">{entry.succeeded}</td><td className={entry.failed ? "text-red-700" : "text-zinc-500"}>{entry.failed}</td><td>{entry.message}</td></tr>)}</tbody></table></div></section>}
  </div>;
}
