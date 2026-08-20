"use client";

import { useEffect, useMemo, useState } from "react";

type Channel = "EBAY" | "SHOPIFY";
type Tab = "create" | "change" | "unavailable";
type OptionChange = { sku: string; name?: string; previousQuantity?: number | null; quantity: number; previousPrice?: number | null; price: number | null };
type CreateRow = { id: string; productId: string | null; productIds?: string[]; sku: string; name: string; price: number | null; priceMax?: number | null; quantity: number | null; optionCount?: number; listingType?: "SINGLE" | "VARIATION"; options?: OptionChange[]; status: string; error: string | null };
type ReviseRow = { productId: string; productIds?: string[]; sku: string; productName: string; itemId: string; quantity: number; price: number | null; previousQuantity: number | null; previousPrice: number | null; listingType?: "SINGLE" | "VARIATION_OPTION" | "VARIATION"; parentTitle?: string | null; optionCount?: number; affectedOptions?: OptionChange[] };
type UnavailableRow = ReviseRow & { reason: string };
type Summary = { createReady?: number; createNeedsReview?: number; createCountMeaning?: string; unavailableOptions?: number; unavailableSingles?: number; shopifyListings?: number; shopifyVariationListings?: number; shopifySingleListings?: number; shopifyOptions?: number };
type Data = { create: CreateRow[]; change: ReviseRow[]; unavailable: UnavailableRow[]; limits: { createBatch: number; reviseBatch: number }; summary?: Summary };
type PreviewRow = { id?: string; productId?: string | null; sku: string; title?: string; name?: string; productName?: string; itemId?: string; price: number | null; priceMax?: number | null; previousPrice?: number | null; quantity: number | null; previousQuantity?: number | null; imageCount?: number; optionCount?: number; options?: OptionChange[]; affectedOptions?: OptionChange[]; valid?: boolean; issues?: Array<{ field: string; message: string }> };
type Preview = { token?: string; rows: PreviewRow[]; action: Tab; valid: boolean; estimateSeconds?: { minimum: number; maximum: number } };
type Result = { succeeded: number; failed: number; rows: Array<{ sku: string; status: "성공" | "실패"; message: string; productId?: string }> };

const money = (value: number | null | undefined) => value == null ? "-" : `$${value.toFixed(2)}`;
const actionName = (tab: Tab) => tab === "create" ? "신규등록" : tab === "change" ? "가격·재고 변경" : "품절·판매중지";

export function EbayOperationsClient({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<Tab>("create");
  const [channel, setChannel] = useState<Channel>("EBAY");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preview" | "sending">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const rows = tab === "create" ? data.create : tab === "change" ? data.change : data.unavailable;
  const ids = useMemo(() => rows.flatMap((row) => tab === "create" ? ((row as CreateRow).productId ? [(row as CreateRow).productId!] : []) : [(row as ReviseRow).productId]), [rows, tab]);
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
    try {
      const response = await fetch(`/api/ebay/operations?channel=${nextChannel}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "목록을 불러오지 못했습니다.");
      setData(body); setChannel(nextChannel); setTab("create"); setSelected([]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "조회 실패"); }
    finally { setBusy(false); setPhase("idle"); }
  }

  async function refresh() {
    const response = await fetch(`/api/ebay/operations?channel=${channel}`, { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }

  async function see() {
    if (!selected.length) return;
    setElapsed(0); setBusy(true); setPhase("preview"); setMessage(""); setResult(null);
    try {
      const response = await fetch("/api/ebay/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: tab === "create" ? "CREATE" : tab === "change" ? "CHANGE" : "UNAVAILABLE", productIds: selected, dryRun: true, channel }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "미리보기 실패");
      setPreview({ token: body.previewToken, rows: body.rows ?? body.drafts ?? [], action: tab, valid: body.valid !== false && Boolean(body.previewToken), estimateSeconds: body.estimateSeconds });
      if (body.valid === false) setMessage("필수 검증을 통과하지 못한 항목이 있습니다. 아래 사유를 확인해 주세요.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "미리보기 실패"); }
    finally { setBusy(false); setPhase("idle"); }
  }

  async function run() {
    if (!preview?.token || !preview.valid) return;
    setElapsed(0); setBusy(true); setPhase("sending"); setMessage("");
    try {
      const ebayCreate = channel === "EBAY" && tab === "create";
      const url = ebayCreate ? "/api/listing-upload/drafts/upload" : "/api/ebay/operations";
      const body = ebayCreate ? { ids: preview.rows.flatMap((row) => row.id ? [row.id] : []), dryRun: false, confirmed: true, previewToken: preview.token } : { action: tab === "create" ? "CREATE" : tab === "change" ? "CHANGE" : "UNAVAILABLE", productIds: selected, dryRun: false, confirmed: true, previewToken: preview.token, channel };
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const output = await response.json();
      if (!response.ok) throw new Error(output.error ?? "전송 실패");
      const failedRows = Array.isArray(output.failed) ? output.failed : [];
      const failedCount = failedRows.length || Number(output.failed ?? 0);
      const succeeded = output.uploaded ?? output.succeeded ?? Math.max(0, selected.length - failedCount);
      const resultRows = preview.rows.map((row, index) => {
        const failure = failedRows.find((item: { itemId?: string; productId?: string; reason?: string; error?: string }) => item.itemId === row.itemId || item.productId === row.productId) ?? (index >= succeeded ? failedRows[index - succeeded] : null);
        return { sku: row.sku, productId: row.productId ?? undefined, status: failure ? "실패" as const : "성공" as const, message: failure?.reason ?? failure?.error ?? (failure ? "전송 실패" : "전송 완료") };
      });
      setResult({ succeeded, failed: failedCount, rows: resultRows });
      setMessage(`작업 완료: 성공 ${succeeded}건 · 실패 ${failedCount}건`);
      setPreview(null); setSelected([]); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "전송 실패"); }
    finally { setBusy(false); setPhase("idle"); }
  }

  function downloadResult() {
    if (!result) return;
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = ["SKU,상태,메시지", ...result.rows.map((row) => [row.sku, row.status, row.message].map(escape).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${channel.toLowerCase()}-${tab}-result.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  const estimate = preview?.estimateSeconds ?? { minimum: selected.length * 3, maximum: selected.length * 8 };

  return <div className="mt-6 space-y-4">
    <div className="flex gap-2 rounded-2xl border bg-white p-2">{(["EBAY", "SHOPIFY"] as const).map((item) => <button key={item} disabled={busy} onClick={() => void load(item)} className={`flex-1 rounded-xl px-4 py-3 font-bold ${channel === item ? (item === "EBAY" ? "bg-violet-600 text-white" : "bg-emerald-600 text-white") : "text-zinc-600"}`}>{item === "EBAY" ? "eBay" : "Shopify"}</button>)}</div>
    {channel === "EBAY" && data.summary && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"><b>신규등록 숫자의 의미:</b> {data.summary.createCountMeaning}. 검증 전·실패 초안 {(data.summary.createNeedsReview ?? 0).toLocaleString()}건은 신규등록 수에 포함하지 않습니다.<span className="ml-3">품절·중지: 묶음 옵션 {data.summary.unavailableOptions ?? 0}건 / 단품 {data.summary.unavailableSingles ?? 0}건</span></div>}
    {channel === "SHOPIFY" && data.summary && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"><b>Shopify 등록 단위:</b> 카드 {data.summary.shopifyOptions ?? 0}장을 묶음상품 {data.summary.shopifyVariationListings ?? 0}개와 단품 {data.summary.shopifySingleListings ?? 0}개, 총 {data.summary.shopifyListings ?? 0}개 리스팅으로 계산합니다.</div>}
    <div className="grid gap-3 sm:grid-cols-3">{([['create', '신규등록', data.create.length], ['change', '가격·재고 변동', data.change.length], ['unavailable', '품절·판매중지', data.unavailable.length]] as const).map(([key, label, count]) => <button key={key} onClick={() => choose(key)} className={`rounded-2xl border p-4 text-left ${tab === key ? "border-violet-600 bg-violet-50" : "bg-white"}`}><span className="text-sm text-zinc-500">{label}</span><strong className="mt-1 block text-2xl">{count.toLocaleString()}건</strong></button>)}</div>
    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div className="flex flex-wrap items-center gap-2"><button onClick={toggleAll} disabled={!ids.length || busy} className="rounded-lg border px-3 py-2 text-sm font-semibold">{all ? "선택 해제" : `한 번에 선택 (최대 ${max}건)`}</button><button onClick={() => { setSelected([]); resetReview(); }} disabled={!selected.length || busy} className="rounded-lg border px-3 py-2 text-sm">선택 초기화</button><span className="text-sm text-zinc-500">선택 {selected.length} / 실제 대상 {ids.length}</span></div><button onClick={() => void see()} disabled={busy || !selected.length} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy && phase === "preview" ? `검증 중… ${elapsed}초` : "선택 항목 검증·미리보기"}</button></div>
      {busy && <div className="border-b bg-zinc-50 p-4"><div className="mb-2 flex justify-between text-sm"><b>{phase === "sending" ? `${channel === "EBAY" ? "eBay" : "Shopify"} 전송 처리 중` : "데이터 확인 중"}</b><span>{elapsed}초 경과</span></div><div className="h-2 overflow-hidden rounded bg-zinc-200"><div className="h-full w-1/2 animate-pulse rounded bg-violet-600" /></div>{phase === "sending" && <p className="mt-2 text-xs text-zinc-600">전송 요청 후에는 중복·불일치를 막기 위해 강제 중지하지 않습니다. 서버 응답이 오면 성공·실패를 나눠 표시합니다.</p>}</div>}
      {message && <p className="border-b bg-amber-50 p-3 text-sm">{message}</p>}
      <div className="max-h-[620px] overflow-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="sticky top-0 bg-zinc-100"><tr><th className="p-3">선택</th><th>마켓</th><th>작업</th><th>SKU</th><th>상품명</th><th>마켓 상품 ID</th><th>기존 가격 → 전송 가격</th><th>기존 수량 → 전송 수량</th><th>판정</th></tr></thead><tbody>
        {rows.map((row) => { const create = tab === "create" ? row as CreateRow : null; const revise = tab !== "create" ? row as ReviseRow : null; const id = create?.productId ?? revise!.productId; return <tr key={id} className="border-t"><td className="p-3"><input aria-label={`${row.sku} 선택`} type="checkbox" checked={selected.includes(id)} onChange={() => toggle(id)} /></td><td>{channel === "EBAY" ? "eBay" : "Shopify"}</td><td>{actionName(tab)}{(create?.listingType === "VARIATION" || revise?.listingType?.startsWith("VARIATION")) ? <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">옵션</span> : null}</td><td>{row.sku}</td><td className="max-w-sm truncate">{create?.name ?? revise?.parentTitle ?? revise?.productName}</td><td>{revise?.itemId ?? "신규"}</td><td>{revise ? `${money(revise.previousPrice)} → ${money(revise.price)}` : create?.priceMax != null && create.priceMax !== create.price ? `${money(create.price)}~${money(create.priceMax)}` : money(create?.price)}</td><td>{revise ? `${revise.previousQuantity ?? "-"} → ${revise.quantity}` : create?.optionCount && create.optionCount > 1 ? `${create.optionCount}개 옵션 · 총 ${create.quantity}` : create?.quantity ?? "-"}</td><td>{tab === "unavailable" ? (row as UnavailableRow).reason : create?.error ?? create?.status ?? "변경 필요"}</td></tr>; })}
        {!rows.length && <tr><td colSpan={9} className="p-10 text-center text-zinc-500">현재 이 마켓에서 실제 처리할 항목이 없습니다.</td></tr>}
      </tbody></table></div>
    </section>
    {preview && <section className={`rounded-2xl border p-5 ${preview.valid ? "border-violet-300 bg-violet-50" : "border-red-300 bg-red-50"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">전송 전 최종 확인 · {preview.rows.length}개 리스팅</h2><p className="mt-1 text-sm">아래 가격·수량·옵션 구성·검증 결과가 실제 전송 내용입니다. 예상 {Math.ceil(estimate.minimum / 60)}~{Math.max(1, Math.ceil(estimate.maximum / 60))}분(마켓 응답에 따라 변동)</p></div><span className={`rounded-full px-3 py-1 text-sm font-bold ${preview.valid ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{preview.valid ? "전송 가능" : "전송 불가"}</span></div><div className="mt-4 max-h-80 overflow-auto rounded-xl border bg-white"><table className="w-full min-w-[950px] text-left text-sm"><thead className="sticky top-0 bg-zinc-100"><tr><th className="p-3">SKU</th><th>상품명</th><th>가격</th><th>수량</th><th>옵션 구성</th><th>이미지</th><th>검증 결과</th></tr></thead><tbody>{preview.rows.map((row) => { const options = row.options ?? row.affectedOptions ?? []; return <tr key={row.id ?? row.productId ?? row.sku} className="border-t"><td className="p-3 font-medium">{row.sku}</td><td>{row.title ?? row.name ?? row.productName ?? "-"}</td><td>{row.previousPrice !== undefined ? `${money(row.previousPrice)} → ${money(row.price)}` : row.priceMax != null && row.priceMax !== row.price ? `${money(row.price)}~${money(row.priceMax)}` : money(row.price)}</td><td>{row.previousQuantity !== undefined ? `${row.previousQuantity ?? "-"} → ${row.quantity ?? "-"}` : row.quantity ?? "-"}</td><td>{options.length ? options.map((option) => `${option.sku}: ${option.previousQuantity ?? "-"}→${option.quantity}`).join(" / ") : row.optionCount && row.optionCount > 1 ? `${row.optionCount}개 옵션` : "단품"}</td><td>{row.imageCount == null ? "-" : `${row.imageCount}장`}</td><td className={row.valid === false ? "text-red-700" : "text-emerald-700"}>{row.issues?.length ? row.issues.map((issue) => issue.message).join(" / ") : "통과"}</td></tr>; })}</tbody></table></div><div className="mt-4 flex justify-end gap-2"><button onClick={() => setPreview(null)} disabled={busy} className="rounded-lg border bg-white px-4 py-2">취소·목록으로</button><button onClick={() => void run()} disabled={!preview.token || !preview.valid || busy} className="rounded-lg bg-rose-700 px-4 py-2 font-bold text-white disabled:opacity-40">위 내용을 확인했고 실제 전송</button></div></section>}
    {result && <section className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">작업 결과</h2><p className="text-sm text-zinc-600">성공 {result.succeeded}건 · 실패 {result.failed}건</p></div><div className="flex gap-2"><button onClick={downloadResult} className="rounded-lg border px-4 py-2 text-sm font-semibold">결과 CSV 다운로드</button><button onClick={() => setResult(null)} className="rounded-lg border px-4 py-2 text-sm">결과 화면 지우기</button></div></div><div className="mt-4 max-h-72 overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="bg-zinc-100"><th className="p-3">SKU</th><th>상태</th><th>메시지</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.sku} className="border-t"><td className="p-3">{row.sku}</td><td className={row.status === "성공" ? "text-emerald-700" : "text-red-700"}>{row.status}</td><td>{row.message}</td></tr>)}</tbody></table></div></section>}
  </div>;
}
