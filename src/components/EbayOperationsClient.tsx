"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { OperationProgressOverlay } from "@/components/OperationProgressOverlay";

type Channel = "EBAY" | "SHOPIFY";
type Tab = "create" | "change" | "unavailable" | "review" | "imageRepair";
type OptionChange = { sku: string; name?: string; previousQuantity?: number | null; quantity: number; previousPrice?: number | null; price: number | null };
type CreateRow = { id: string; productId: string | null; productIds?: string[]; sku: string; name: string; price: number | null; priceMax?: number | null; quantity: number | null; optionCount?: number; listingType?: "SINGLE" | "VARIATION"; options?: OptionChange[]; status: string; error: string | null };
type ReviseRow = { productId: string; productIds?: string[]; sku: string; productName: string; itemId: string; quantity: number; price: number | null; previousQuantity: number | null; previousPrice: number | null; listingType?: "SINGLE" | "VARIATION_OPTION" | "VARIATION"; parentTitle?: string | null; optionCount?: number; affectedOptions?: OptionChange[]; stock?: number; reserved?: number; ownSellableQuantity?: number; pocamarketAvailableCount?: number | null; pocamarketListingQuantity?: number; availabilityStatus?: string; actionable?: boolean };
type UnavailableRow = ReviseRow & { reason: string };
type Summary = { createReady?: number; createNeedsReview?: number; createCountMeaning?: string; unavailableOptions?: number; unavailableSingles?: number; sourceReview?: number; heldForOrder?: number; shopifyListings?: number; shopifyVariationListings?: number; shopifySingleListings?: number; shopifyOptions?: number; imageRepairListings?: number };
type ImageRepairJob = { active: number; pending: number; running: number; succeeded: number; failed: number; total: number };
type InventoryJob = { kind: "inventory"; batchId: string | null; taskId?: string | null; stage?: string; active: number; pending: number; running: number; submitted?: number; succeeded: number; failed: number; completed: number; total: number; jobs: Array<{ id: string; productId: string | null; sku: string; action: string | null; status: string; message: string | null; errorSummary: string | null; createdAt?: string | Date; startedAt?: string | Date | null; finishedAt?: string | Date | null }> };
export type OperationsClientData = { create: CreateRow[]; change: ReviseRow[]; unavailable: UnavailableRow[]; review: UnavailableRow[]; imageRepair: UnavailableRow[]; limits: { createBatch: number; reviseBatch: number }; summary?: Summary; imageRepairJob?: ImageRepairJob; inventoryJob?: InventoryJob };
type PreviewRow = { id?: string; productId?: string | null; sku: string; title?: string; name?: string; productName?: string; itemId?: string; price: number | null; priceMax?: number | null; previousPrice?: number | null; quantity: number | null; previousQuantity?: number | null; imageCount?: number; optionCount?: number; listingType?: "SINGLE" | "VARIATION_OPTION" | "VARIATION"; parentTitle?: string | null; options?: OptionChange[]; affectedOptions?: OptionChange[]; valid?: boolean; issues?: Array<{ field: string; message: string }> };
type Preview = { token?: string; rows: PreviewRow[]; action: Tab; valid: boolean; estimateSeconds?: { minimum: number; maximum: number } };
type Result = { succeeded: number; failed: number; rows: Array<{ sku: string; status: "성공" | "실패"; message: string; productId?: string; action?: Tab }> };
type WorkLog = { id: string; startedAt: Date; channel: Channel; action: Tab; requested: number; succeeded: number; failed: number; message: string };

const money = (value: number | null | undefined) => value == null ? "-" : `$${value.toFixed(2)}`;
const actionName = (tab: Tab) => tab === "create" ? "신규등록" : tab === "change" ? "가격·재고 변경" : tab === "unavailable" ? "품절·판매중지" : tab === "imageRepair" ? "이미지·썸네일 교체" : "주문 예약·수집 필요";
const jobAction = (action: string | null): Tab | undefined => action === "CHANGE" ? "change" : action === "UNAVAILABLE" ? "unavailable" : undefined;
const resultFromJob = (job?: InventoryJob): Result | null => !job?.total || job.active ? null : ({
  succeeded: job.succeeded,
  failed: job.failed,
  rows: job.jobs.map((item) => ({ productId: item.productId ?? undefined, sku: item.sku, action: jobAction(item.action), status: item.status === "success" ? "성공" as const : "실패" as const, message: item.status === "success" ? item.message ?? "eBay 실제 반영 확인 완료" : item.errorSummary ?? item.message ?? "eBay 실제 반영 미확인" })),
});

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
  const [result, setResult] = useState<Result | null>(() => resultFromJob(initial.inventoryJob));
  const [history, setHistory] = useState<WorkLog[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [jobClock, setJobClock] = useState(() => Date.now());
  const rows = tab === "create" ? data.create : tab === "change" ? data.change : tab === "unavailable" ? data.unavailable : tab === "imageRepair" ? data.imageRepair : data.review;
  const ids = useMemo(() => rows.flatMap((row) => {
    if (tab === "create") return (row as CreateRow).productId ? [(row as CreateRow).productId!] : [];
    const revise = row as ReviseRow;
    return revise.actionable === false ? [] : [revise.productId];
  }), [rows, tab]);
  const max = tab === "create" ? data.limits.createBatch : data.limits.reviseBatch;
  const selectableIds = ids.slice(0, max);
  const all = selectableIds.length > 0 && selectableIds.every((id) => selected.includes(id));
  const estimatedSeconds = tab === "imageRepair"
    ? { minimum: Math.max(12, selected.length * 12), maximum: Math.max(30, selected.length * 35) }
    : channel === "EBAY" && (tab === "change" || tab === "unavailable")
      ? { minimum: 5, maximum: 60 }
    : { minimum: Math.max(3, selected.length * 2), maximum: Math.max(10, selected.length * 8) };
  const estimatedText = `${estimatedSeconds.minimum}~${estimatedSeconds.maximum}초 예상`;
  const progress = busy ? Math.min(92, Math.max(8, Math.round((elapsed / estimatedSeconds.maximum) * 100))) : preview ? 75 : result ? 100 : selected.length ? 25 : 0;

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (channel !== "EBAY" || !data.imageRepairJob?.active) return;
    let active = true;
    const timer = window.setInterval(async () => {
      const response = await fetch("/api/ebay/operations?channel=EBAY", { cache: "no-store" }).catch(() => null);
      if (!active || !response?.ok) return;
      const next = await response.json() as OperationsClientData;
      setData(next);
      if (!next.imageRepairJob?.active) setMessage(`대표사진 교체 완료: 성공 ${next.imageRepairJob?.succeeded ?? 0}건 · 실패 ${next.imageRepairJob?.failed ?? 0}건`);
    }, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [channel, data.imageRepairJob?.active]);

  useEffect(() => {
    if (channel !== "EBAY" || !data.inventoryJob?.active) return;
    let mounted = true;
    const poll = async () => {
      const response = await fetch("/api/ebay/operations/inventory-jobs", { cache: "no-store" }).catch(() => null);
      if (!mounted || !response?.ok) return;
      const job = await response.json() as InventoryJob;
      setData((current) => ({ ...current, inventoryJob: job }));
      if (!job.active) {
        setResult(resultFromJob(job));
        setMessage(`eBay 실제 반영 확인 완료: 성공 ${job.succeeded}건 · 실패·미확인 ${job.failed}건`);
        const operations = await fetch("/api/ebay/operations?channel=EBAY", { cache: "no-store" }).catch(() => null);
        if (mounted && operations?.ok) setData(await operations.json());
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [channel, data.inventoryJob?.active, data.inventoryJob?.batchId]);

  useEffect(() => {
    if (!data.inventoryJob?.active) return;
    const timer = window.setInterval(() => setJobClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [data.inventoryJob?.active]);

  const inventoryTiming = useMemo(() => {
    const job = data.inventoryJob;
    const started = job?.jobs.map((item) => item.startedAt ?? item.createdAt).filter(Boolean).map((value) => new Date(value!).getTime()).filter(Number.isFinite).sort((a, b) => a - b)[0];
    if (!job || !started) return { elapsed: 0, eta: null as number | null };
    const elapsedSeconds = Math.max(1, Math.round((jobClock - started) / 1_000));
    return { elapsed: elapsedSeconds };
  }, [data.inventoryJob, jobClock]);
  const serverJobActive = channel === "EBAY" && Boolean(data.inventoryJob?.active);

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

  async function reconcileAndRefresh() {
    if (channel !== "EBAY" || tab !== "imageRepair") {
      await refresh();
      return;
    }
    setBusy(true); setPhase("preview"); setElapsed(0); setMessage("과거 전송 건의 eBay 실제 대표사진을 재조회하고 있습니다.");
    try {
      const started = await fetch("/api/ebay/operations/image-repair?wait=1", { method: "POST" });
      const startedBody = await started.json();
      if (!started.ok) throw new Error(startedBody.error ?? "대표사진 완료 상태 재확인을 시작하지 못했습니다.");
      const previousCount = data.imageRepair.length;
      const response = await fetch("/api/ebay/operations?channel=EBAY", { cache: "no-store" });
      if (!response.ok) throw new Error("재확인 후 작업 목록을 불러오지 못했습니다.");
      const next = await response.json() as OperationsClientData;
      setData(next);
      const removed = Math.max(0, previousCount - next.imageRepair.length);
      setMessage(`eBay 실제 대표사진 재확인 완료: 완료 확인 ${removed}건 제외 · 현재 미완료 ${next.imageRepair.length}건${next.imageRepair.length ? " · 남은 항목은 다시 누르면 다음 20건을 확인합니다." : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "대표사진 완료 상태 재확인 실패");
    } finally {
      setBusy(false); setPhase("idle");
    }
  }

  async function send(previewData: Preview, targetIds: string[], actionTab: Tab) {
    if (!previewData.token || !previewData.valid) return;
    try {
      const ebayCreate = channel === "EBAY" && actionTab === "create";
      const url = ebayCreate ? "/api/listing-upload/drafts/upload" : "/api/ebay/operations";
      const body = ebayCreate ? { ids: previewData.rows.flatMap((row) => row.id ? [row.id] : []), dryRun: false, confirmed: true, previewToken: previewData.token } : { action: actionTab === "create" ? "CREATE" : actionTab === "change" ? "CHANGE" : actionTab === "unavailable" ? "UNAVAILABLE" : actionTab === "imageRepair" ? "IMAGE_REPAIR" : "REVIEW", productIds: targetIds, dryRun: false, confirmed: true, previewToken: previewData.token, channel };
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const output = await response.json();
      if (!response.ok) throw new Error(output.error ?? "전송 실패");
      if (output.queued) {
        setData((current) => output.jobType === "inventory" ? ({ ...current, inventoryJob: output.job }) : ({ ...current, imageRepairJob: output.job }));
        setMessage(`서버 작업을 시작했습니다. 메뉴를 이동해도 계속 처리됩니다. 대기·처리 중 ${output.job.active}건`);
        setPreview(null); setSelected([]); await refresh();
        return;
      }
      const failedRows = Array.isArray(output.failed) ? output.failed : Array.isArray(output.results) ? output.results.filter((item: { error?: string }) => item.error) : [];
      const failedCount = failedRows.length || Number(output.failed ?? 0);
      const succeeded = output.uploaded ?? output.succeeded ?? Math.max(0, targetIds.length - failedCount);
      const resultRows = previewData.rows.map((row, index) => {
        const failure = failedRows.find((item: { itemId?: string; productId?: string; reason?: string; error?: string }) => item.itemId === row.itemId || item.productId === row.productId) ?? (index >= succeeded ? failedRows[index - succeeded] : null);
        return { sku: row.sku, productId: row.productId ?? undefined, status: failure ? "실패" as const : "성공" as const, message: failure?.reason ?? failure?.error ?? (failure ? "전송 실패" : "마켓 재조회 확인 완료") };
      });
      setResult({ succeeded, failed: failedCount, rows: resultRows });
      setMessage(`마켓 실제 반영 확인 완료: 성공 ${succeeded}건 · 실패·미확인 ${failedCount}건`);
      setHistory((current) => [{ id: crypto.randomUUID(), startedAt: new Date(), channel, action: actionTab, requested: previewData.rows.length, succeeded, failed: failedCount, message: failedCount ? "일부 실패 — 실패 건만 재검증 후 재시작 가능" : "완료" }, ...current].slice(0, 10));
      setPreview(null); setSelected([]); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "전송 실패"); }
  }

  // 사용자가 "작업 시작"을 누르는 것이 실제 적용 승인이다. 화면에 긴 검토표를
  // 띄우지는 않지만, 서버에서는 항상 같은 최신 대상과 토큰을 먼저 검증한 뒤에만
  // 외부 마켓 쓰기를 시작한다. 검증에서 빠진 항목은 전송하지 않고 결과로 남긴다.
  async function startAutomatically(targetIds = selected, actionTab: Tab = tab) {
    if (!targetIds.length) return;
    setElapsed(0); setBusy(true); setPhase("preview"); setMessage(""); setResult(null); setPreview(null);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/ebay/operations", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: actionTab === "create" ? "CREATE" : actionTab === "change" ? "CHANGE" : actionTab === "unavailable" ? "UNAVAILABLE" : actionTab === "imageRepair" ? "IMAGE_REPAIR" : "REVIEW", productIds: targetIds, dryRun: true, channel }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "자동 검증 실패");
      const candidate: Preview = { token: body.previewToken, rows: body.rows ?? body.drafts ?? [], action: actionTab, valid: body.valid !== false && Boolean(body.previewToken), estimateSeconds: body.estimateSeconds };
      if (!candidate.valid) {
        setPreview(candidate);
        setMessage("자동 검증에서 제외된 항목이 있습니다. 이 항목들은 마켓에 전송하지 않았습니다.");
        return;
      }
      setPhase("sending");
      await send(candidate, targetIds, actionTab);
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
    const retryTab = result?.rows.find((row) => row.status === "실패" && row.action)?.action ?? tab;
    setTab(retryTab); setSelected(failedIds); setPreview(null); setMessage(`실패·미확인 ${failedIds.length}건을 최신 값으로 다시 검증하고 적용합니다.`);
    await startAutomatically(failedIds, retryTab);
  }

  function stopCurrentWork() {
    if (phase === "sending") {
      setMessage("외부 마켓 전송은 중간 취소 시 결과가 불명확해질 수 있어 서버 응답을 기다립니다. 완료 후 실패 항목만 안전하게 재시작할 수 있습니다.");
      return;
    }
    abortRef.current?.abort();
  }

  return <div className="mt-6 space-y-4">
    <OperationProgressOverlay open={busy} title={phase === "sending" ? `${channel === "EBAY" ? "eBay" : "Shopify"} 작업 등록 중` : "전송 대상 자동 검증 중"} detail={phase === "sending" ? `${actionName(tab)} ${selected.length}건을 안전한 서버 작업으로 등록하고 있습니다.` : "최신 재고·가격·옵션·이미지를 다시 확인하고 있습니다."} elapsedSeconds={elapsed} estimateSeconds={estimatedSeconds.maximum} total={phase === "sending" ? selected.length : undefined}/>
    <div className="flex gap-2 rounded-2xl border bg-white p-2">{(["EBAY", "SHOPIFY"] as const).map((item) => <button key={item} disabled={busy} onClick={() => void load(item)} className={`flex-1 rounded-xl px-4 py-3 font-bold ${channel === item ? (item === "EBAY" ? "bg-violet-600 text-white" : "bg-emerald-600 text-white") : "text-zinc-600"}`}>{item === "EBAY" ? "eBay" : "Shopify"}</button>)}</div>
    {channel === "EBAY" && data.summary && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"><b>신규등록 숫자의 의미:</b> {data.summary.createCountMeaning}. 검증 전·실패 초안 {(data.summary.createNeedsReview ?? 0).toLocaleString()}건은 신규등록 수에 포함하지 않습니다.<span className="ml-3">실제 품절·중지: 묶음 옵션 {data.summary.unavailableOptions ?? 0}건 / 단품 {data.summary.unavailableSingles ?? 0}건</span>{(data.summary.heldForOrder ?? 0) > 0 && <span className="ml-3">주문 예약 보류 {data.summary.heldForOrder}건</span>}{(data.summary.sourceReview ?? 0) > 0 && <span className="ml-3 font-bold text-amber-800">포카마켓 수집값 없음 {data.summary.sourceReview}건 — 자동 전송 제외</span>}</div>}
    {channel === "SHOPIFY" && data.summary && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"><b>Shopify 등록 단위:</b> 카드 {data.summary.shopifyOptions ?? 0}장을 묶음상품 {data.summary.shopifyVariationListings ?? 0}개와 단품 {data.summary.shopifySingleListings ?? 0}개, 총 {data.summary.shopifyListings ?? 0}개 리스팅으로 계산합니다.<span className="ml-3 font-bold">이미지·썸네일 교체 가능 {data.summary.imageRepairListings ?? 0}개</span></div>}
    {channel === "EBAY" && data.summary && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"><b>eBay 묶음 대표사진:</b> 최신 활성상품 보고서에서 확인되고 옵션 이미지가 모두 준비된 묶음 {data.summary.imageRepairListings ?? 0}개를 현재 워터마크 설정으로 교체할 수 있습니다.</div>}
    {channel === "EBAY" && data.imageRepairJob && data.imageRepairJob.total > 0 && <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950"><b>최근 대표사진 작업:</b> 전체 {data.imageRepairJob.total}건 · 실제 반영 확인 {data.imageRepairJob.succeeded}건 · 실패·미확인 {data.imageRepairJob.failed}건 · 처리 중/대기 {data.imageRepairJob.active}건. eBay 재조회까지 통과한 항목만 목록과 숫자에서 자동으로 제외됩니다.</div>}
    {channel === "EBAY" && data.inventoryJob && data.inventoryJob.total > 0 && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><div className="flex flex-wrap items-center justify-between gap-2"><b>eBay 가격·재고 대량작업 {data.inventoryJob.active ? "진행 중" : "완료"}</b><span>대상 {data.inventoryJob.total} · eBay 접수 {data.inventoryJob.submitted ?? 0} · 성공 {data.inventoryJob.succeeded} · 실패 {data.inventoryJob.failed} · 결과 대기 {Math.max(0, data.inventoryJob.total - data.inventoryJob.completed)}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100"><div className="h-full rounded-full bg-sky-600 transition-[width]" style={{width:`${data.inventoryJob.total ? data.inventoryJob.completed ? Math.round((data.inventoryJob.completed / data.inventoryJob.total) * 100) : (data.inventoryJob.submitted ?? 0) > 0 ? 55 : 15 : 0}%`}}/></div><p className="mt-2 text-xs">{data.inventoryJob.active ? `${Math.floor(inventoryTiming.elapsed / 60)}분 ${inventoryTiming.elapsed % 60}초 경과 · 예상 1~10분${inventoryTiming.elapsed > 600 ? " · 예상 범위를 넘어 eBay 처리 지연 중" : ""}. ` : ""}개별 상품을 하나씩 재조회하지 않고 eBay 공식 백그라운드 대량처리 결과 파일로 성공·실패를 확정합니다. 메뉴를 이동하거나 창을 닫아도 계속됩니다.</p>{data.inventoryJob.active && (data.inventoryJob.submitted ?? 0) > 0 && <p className="mt-2 font-semibold">eBay 작업번호 {data.inventoryJob.taskId}로 전체 {(data.inventoryJob.submitted ?? 0).toLocaleString()}건이 접수되었습니다. 성공 수는 eBay 결과 파일이 나온 즉시 한꺼번에 갱신됩니다.</p>}{!data.inventoryJob.active && data.inventoryJob.failed > 0 && <p className="mt-2 font-semibold text-amber-900">실패 항목은 아래 결과에 이유가 남아 있으며, ‘실패·미확인 재시작’으로 해당 항목만 다시 처리할 수 있습니다.</p>}</div>}
    <div className="grid gap-3 sm:grid-cols-5">{([['create', '신규등록', data.create.length], ['change', '가격·재고 변동', data.change.length], ['unavailable', '품절·판매중지', data.unavailable.length], ['review', '주문 예약·수집 필요', data.review.length], ['imageRepair', channel === "EBAY" ? '묶음 대표사진 교체' : '이미지·썸네일 교체', data.imageRepair.length] as const] as const).map(([key, label, count]) => <button key={key} disabled={busy} onClick={() => choose(key)} className={`rounded-2xl border p-4 text-left disabled:opacity-50 ${tab === key ? "border-violet-600 bg-violet-50" : "bg-white"}`}><span className="text-sm text-zinc-500">{label}</span><strong className="mt-1 block text-2xl">{count.toLocaleString()}건</strong></button>)}</div>
    <section className="overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b bg-zinc-50 p-3">
        <button onClick={() => void startAutomatically()} disabled={busy || !selected.length || (channel === "EBAY" && Boolean(data.inventoryJob?.active))} className="rounded-lg border border-violet-700 bg-white px-4 py-2 text-sm font-bold text-violet-800 disabled:opacity-40">작업 시작 · 자동 검증 후 적용</button>
        <button onClick={() => void retryFailures()} disabled={busy || !result?.failed || Boolean(data.inventoryJob?.active)} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40">실패·미확인 {result?.failed ?? 0}건 재시작</button>
        <button onClick={() => { setResult(null); setPreview(null); setMessage(""); }} disabled={busy || (!result && !preview)} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40">완료작업 지우기</button>
        <button onClick={() => { setSelected([]); resetReview(); }} disabled={busy || !selected.length} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40">선택 해제</button>
        <button onClick={stopCurrentWork} disabled={!busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">작업 중지</button>
        <div className="ml-auto flex gap-2"><button onClick={downloadResult} disabled={!result} className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-40">결과 CSV</button><button onClick={downloadFailures} disabled={!result?.failed} className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-40">오류 CSV</button></div>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-xl border bg-zinc-50 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-zinc-500">작업 상태</p><p className="mt-1 font-bold">{busy ? phase === "sending" ? `${channel === "EBAY" ? "eBay" : "Shopify"} 작업 등록 중` : "대상 자동 검증 중" : serverJobActive ? "eBay 서버 작업 진행 중 — 메뉴 이동 가능" : preview ? "자동 검증 제외 항목 확인" : result ? result.failed ? "일부 실패 — 해당 항목만 재시작 가능" : "작업 완료" : "대기"}</p></div><span className={`rounded-full px-3 py-1 text-sm font-bold ${busy || serverJobActive ? "bg-blue-100 text-blue-800" : result?.failed ? "bg-amber-100 text-amber-800" : result ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"}`}>{busy ? `${elapsed}초` : serverJobActive ? `${data.inventoryJob?.completed ?? 0}/${data.inventoryJob?.total ?? 0}` : result ? `성공 ${result.succeeded} · 실패 ${result.failed}` : `선택 ${selected.length}건`}</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200"><div style={{ width: `${progress}%` }} className={`h-full rounded-full transition-[width] duration-500 ${busy ? "animate-pulse bg-violet-600" : result ? "bg-emerald-600" : "bg-zinc-500"}`} /></div>
          <p className="mt-3 text-sm text-zinc-600">{busy ? phase === "sending" ? `선택 ${selected.length}건을 eBay 대량작업으로 등록 중입니다.` : `현재 대상 검증 중 · ${elapsed}초 경과` : serverJobActive ? `${Math.floor(inventoryTiming.elapsed / 60)}분 ${inventoryTiming.elapsed % 60}초 경과 · eBay 접수 ${data.inventoryJob?.submitted ?? 0}건 · 공식 결과 파일 대기 중(예상 1~10분)` : preview ? `${preview.rows.length}개 항목은 자동 검증에서 제외되어 마켓에 전송하지 않았습니다.` : result ? message : tab === "imageRepair" ? channel === "EBAY" ? `옵션 구성과 옵션별 사진은 유지하고 묶음 대표사진만 교체합니다. ${estimatedText}` : `묶음은 제작 썸네일을 첫 사진으로, 옵션은 개별 카드 사진으로 연결합니다. ${estimatedText}` : "목록에서 항목을 선택한 뒤 ‘작업 시작’을 누르면 자동 검증을 통과한 항목만 바로 적용합니다."}</p>
        </div>
        <div className="rounded-xl border p-4"><p className="text-xs font-semibold text-zinc-500">처리 집계</p><div className="mt-2 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-zinc-100 p-2"><b className="block text-lg">{serverJobActive ? data.inventoryJob?.total : selected.length}</b><span className="text-xs text-zinc-600">{serverJobActive ? "전체" : "선택"}</span></div><div className="rounded-lg bg-emerald-50 p-2"><b className="block text-lg text-emerald-800">{serverJobActive ? data.inventoryJob?.succeeded : result?.succeeded ?? 0}</b><span className="text-xs text-zinc-600">성공</span></div><div className="rounded-lg bg-red-50 p-2"><b className="block text-lg text-red-800">{serverJobActive ? data.inventoryJob?.failed : result?.failed ?? 0}</b><span className="text-xs text-zinc-600">실패</span></div></div><p className="mt-3 text-xs text-zinc-500">서버 작업은 강제 취소하지 않고 안전하게 끝냅니다. 실패한 항목은 원인이 저장되며 해당 항목만 다시 검증해 재시작할 수 있습니다.</p></div>
      </div>
    </section>
    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div className="flex flex-wrap items-center gap-2"><button onClick={toggleAll} disabled={!ids.length || busy} className="rounded-lg border px-3 py-2 text-sm font-semibold">{all ? "전체 선택 해제" : ids.length <= max ? `전체 대상 ${ids.length.toLocaleString()}건 선택` : `대상 일괄 선택 (최대 ${max.toLocaleString()}건)`}</button><span className="text-sm text-zinc-500">선택 {selected.length.toLocaleString()} / 실제 대상 {ids.length.toLocaleString()} · 자동 검증 통과분만 적용</span></div><button onClick={() => void reconcileAndRefresh()} disabled={busy} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">{channel === "EBAY" && tab === "imageRepair" ? "eBay 완료상태 재확인" : "목록 새로고침"}</button></div>
      {busy && <div className="border-b bg-zinc-50 p-4"><div className="mb-2 flex justify-between text-sm"><b>{phase === "sending" ? `${channel === "EBAY" ? "eBay" : "Shopify"} 전송 처리 중` : "데이터 확인 중"}</b><span>{elapsed}초 경과 · {estimatedText}</span></div><div className="h-2 overflow-hidden rounded bg-zinc-200"><div style={{ width: `${progress}%` }} className="h-full rounded bg-violet-600 transition-[width] duration-500" /></div>{phase === "sending" && <p className="mt-2 text-xs text-zinc-600">{channel === "EBAY" ? "eBay가 대표사진 수정 성공을 반환한 뒤에만 완료로 표시합니다. 옵션 구성과 옵션별 사진은 전송하지 않습니다." : "이미지 교체는 Shopify의 비동기 처리 완료와 실제 대표사진·옵션 연결 확인까지 기다립니다. 완료 확인 전에는 성공으로 표시하지 않습니다."}</p>}</div>}
      {message && <p className="border-b bg-amber-50 p-3 text-sm">{message}</p>}
      <div className="max-h-[620px] overflow-auto"><table className="w-full min-w-[1450px] text-left text-sm"><thead className="sticky top-0 bg-zinc-100"><tr><th className="p-3">선택</th><th>마켓</th><th>작업</th><th>SKU</th><th>상품명</th><th>내 재고/주문예약</th><th>포카마켓 최종 수집값</th><th>마켓 상품 ID</th><th>기존 가격 → 전송 가격</th><th>기존 수량 → 전송 수량</th><th>판정</th></tr></thead><tbody>
        {rows.map((row) => { const create = tab === "create" ? row as CreateRow : null; const revise = tab !== "create" ? row as ReviseRow : null; const id = create?.productId ?? revise!.productId; const selectable = revise?.actionable !== false; return <tr key={id} className={`border-t ${!selectable ? "bg-amber-50 text-zinc-500" : ""}`}><td className="p-3"><input aria-label={`${row.sku} 선택`} type="checkbox" disabled={!selectable} checked={selected.includes(id)} onChange={() => toggle(id)} /></td><td>{channel === "EBAY" ? "eBay" : "Shopify"}</td><td>{actionName(tab)}{(create?.listingType === "VARIATION" || revise?.listingType?.startsWith("VARIATION")) ? <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">옵션</span> : null}</td><td>{row.sku}</td><td className="max-w-sm truncate">{create?.name ?? revise?.parentTitle ?? revise?.productName}</td><td>{revise ? `${revise.stock ?? "-"} / ${revise.reserved ?? "-"} → 판매가능 ${revise.ownSellableQuantity ?? "-"}` : "-"}</td><td>{revise ? revise.pocamarketAvailableCount == null ? "수집값 없음" : `${revise.pocamarketAvailableCount}개 → 반영 ${revise.pocamarketListingQuantity ?? 0}개` : "-"}</td><td>{revise?.itemId ?? "신규"}</td><td>{revise ? `${money(revise.previousPrice)} → ${money(revise.price)}` : create?.priceMax != null && create.priceMax !== create.price ? `${money(create.price)}~${money(create.priceMax)}` : money(create?.price)}</td><td>{revise ? `${revise.previousQuantity ?? "-"} → ${revise.quantity}` : create?.optionCount && create.optionCount > 1 ? `${create.optionCount}개 옵션 · 총 ${create.quantity}` : create?.quantity ?? "-"}</td><td>{tab === "unavailable" || tab === "review" || tab === "imageRepair" ? (row as UnavailableRow).reason : create?.error ?? create?.status ?? "변경 필요"}</td></tr>; })}
        {!rows.length && <tr><td colSpan={11} className="p-10 text-center text-zinc-500">현재 이 마켓에서 실제 처리할 항목이 없습니다.</td></tr>}
      </tbody></table></div>
    </section>
    {preview && <section className="rounded-2xl border border-red-300 bg-red-50 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">자동 검증 제외 · {preview.rows.length}개 리스팅</h2><p className="mt-1 text-sm">아래 항목은 최신 재고·가격·옵션·포카마켓 조건을 통과하지 못해 마켓에 전송하지 않았습니다.</p></div><span className="rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-800">전송 제외</span></div><div className="mt-4 max-h-80 overflow-auto rounded-xl border bg-white"><table className="w-full min-w-[950px] text-left text-sm"><thead className="sticky top-0 bg-zinc-100"><tr><th className="p-3">SKU</th><th>상품명</th><th>가격</th><th>수량</th><th>옵션 구성</th><th>이미지</th><th>검증 결과</th></tr></thead><tbody>{preview.rows.map((row) => { const options = row.options ?? row.affectedOptions ?? []; return <tr key={row.id ?? row.productId ?? row.sku} className="border-t"><td className="p-3 font-medium">{row.sku}</td><td>{row.parentTitle ?? row.title ?? row.name ?? row.productName ?? "-"}</td><td>{row.previousPrice !== undefined ? `${money(row.previousPrice)} → ${money(row.price)}` : row.priceMax != null && row.priceMax !== row.price ? `${money(row.price)}~${money(row.priceMax)}` : money(row.price)}</td><td>{row.previousQuantity !== undefined ? `${row.previousQuantity ?? "-"} → ${row.quantity ?? "-"}` : row.quantity ?? "-"}</td><td>{options.length ? options.map((option) => `${option.sku}: ${option.previousQuantity ?? "-"}→${option.quantity}`).join(" / ") : row.listingType === "VARIATION_OPTION" ? `부모상품은 유지 · 옵션 SKU ${row.sku}만 수정` : row.optionCount && row.optionCount > 1 ? `${row.optionCount}개 옵션` : "단품"}</td><td>{row.imageCount == null ? "-" : `${row.imageCount}장`}</td><td className={row.valid === false ? "text-red-700" : "text-emerald-700"}>{row.issues?.length ? row.issues.map((issue) => issue.message).join(" / ") : "검증 토큰이 생성되지 않음"}</td></tr>; })}</tbody></table></div><div className="mt-4 flex justify-end"><button onClick={() => setPreview(null)} disabled={busy} className="rounded-lg border bg-white px-4 py-2">제외 목록 닫기</button></div></section>}
    {result && <section className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">작업 결과</h2><p className="text-sm text-zinc-600">성공 {result.succeeded}건 · 실패 {result.failed}건</p></div><div className="flex gap-2"><button onClick={downloadResult} className="rounded-lg border px-4 py-2 text-sm font-semibold">결과 CSV 다운로드</button><button onClick={() => setResult(null)} className="rounded-lg border px-4 py-2 text-sm">결과 화면 지우기</button></div></div><div className="mt-4 max-h-72 overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="bg-zinc-100"><th className="p-3">SKU</th><th>상태</th><th>메시지</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.sku} className="border-t"><td className="p-3">{row.sku}</td><td className={row.status === "성공" ? "text-emerald-700" : "text-red-700"}>{row.status}</td><td>{row.message}</td></tr>)}</tbody></table></div></section>}
    {history.length > 0 && <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">이번 화면의 작업 이력</h2><p className="mt-1 text-sm text-zinc-600">브라우저를 닫거나 새로고침하기 전까지 최근 10건을 보관합니다. 실제 마켓 반영 결과는 위 결과 CSV로 내려받아 보관할 수 있습니다.</p><div className="mt-4 overflow-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="bg-zinc-100"><th className="p-3">시각</th><th>마켓</th><th>작업</th><th>요청</th><th>성공</th><th>실패</th><th>작업 메시지</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.id} className="border-t"><td className="p-3">{entry.startedAt.toLocaleTimeString("ko-KR")}</td><td>{entry.channel === "EBAY" ? "eBay" : "Shopify"}</td><td>{actionName(entry.action)}</td><td>{entry.requested}</td><td className="text-emerald-700">{entry.succeeded}</td><td className={entry.failed ? "text-red-700" : "text-zinc-500"}>{entry.failed}</td><td>{entry.message}</td></tr>)}</tbody></table></div></section>}
  </div>;
}
