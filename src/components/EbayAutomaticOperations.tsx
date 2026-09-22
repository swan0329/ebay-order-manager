"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, StopCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifyProductDataChanged } from "@/lib/client-product-refresh";
import { parseChangeSkus } from "@/lib/change-product-selection";

type Operation = "revise" | "end";
type ChannelChoice = "BOTH" | "EBAY" | "SHOPIFY";
type AutomaticJob = {
  id: string;
  status: string;
  totalCount: number;
  processedCount?: number;
  successCount: number;
  failureCount: number;
  error?: string | null;
  submittedAt?: string | null;
  failures?: Array<{ sku: string; itemId: string; message: string }>;
  items?: Array<{ id: string; sku: string; status: string; error: string | null }>;
};

const ebayStorageKey = "active-ebay-feed-job";
const shopifyStorageKey = "active-shopify-automatic-job";
// eBay는 CANCELED, 내부 Shopify 작업은 CANCELLED 철자를 사용한다.
// 둘 중 하나를 빠뜨리면 중단된 작업도 화면에서 영원히 진행 중으로 보인다.
const terminal = new Set(["COMPLETED", "COMPLETED_WITH_ERROR", "FAILED", "CANCELED", "CANCELLED"]);
const maxAutomaticPollingMs = 20 * 60 * 1000;

function statusClass(status: string) {
  if (status === "COMPLETED") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "COMPLETED_WITH_ERROR" || status === "FAILED") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }
  return "border-blue-200 bg-blue-50 text-blue-900";
}

type FeedRecoveryJob = {
  id: string;
  operation: string;
  status: string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  reflection: {
    total: number;
    restored: number;
    failed: number;
    stillHeld: number;
    firstErrors: string[];
  };
};

/**
 * 변동처리는 먼저 모든 대상의 수량을 0으로 보내고, 그다음 실제 수량을 되돌린다.
 * 되돌리기 전까지 상품은 eBay에서 품절로 보이므로, 얼마나 남았는지 보이고 사람이
 * 직접 재촉할 수 있어야 한다.
 */
function EbayQuantityRecovery() {
  const [jobs, setJobs] = useState<FeedRecoveryJob[] | null>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/ebay/feed-recovery", { cache: "no-store" });
      const body = await response.json();
      if (response.ok && Array.isArray(body.jobs)) setJobs(body.jobs as FeedRecoveryJob[]);
    } catch {
      // 조회 실패는 표시 문제일 뿐이다.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const held = (jobs ?? []).reduce((sum, job) => sum + job.reflection.stillHeld, 0);

  // 되돌릴 것이 남아 있는 동안에는 짧게 다시 확인한다.
  useEffect(() => {
    if (!held) return;
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [held, load]);

  async function recoverNow() {
    setRunning(true);
    setNote("되돌리는 중입니다. 이 화면을 닫아도 계속됩니다…");
    try {
      const response = await fetch("/api/ebay/feed-recovery", { method: "POST" });
      const body = await response.json();
      setNote(response.ok ? `되돌리기를 실행했습니다 (작업 ${body.recovered}건).` : body.error ?? "실행하지 못했습니다.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "실행하지 못했습니다.");
    } finally {
      setRunning(false);
      void load();
    }
  }

  // 되돌릴 것이 없으면 아무것도 띄우지 않는다. 다 끝난 화면에 빨간 상자가 남아 있을
  // 이유가 없다.
  if (!jobs || !held) return null;

  return (
    <div className="m-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-amber-900">
          eBay 수량 되돌리는 중 · 남은 {held.toLocaleString()}건
        </span>
        <button
          type="button"
          onClick={recoverNow}
          disabled={running}
          className="ml-auto cursor-pointer rounded bg-zinc-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          {running ? "실행 중…" : "지금 되돌리기"}
        </button>
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-amber-900">자세히</summary>
        <p className="mt-1 text-xs text-zinc-700">
          가격을 바꾸는 동안 판매를 잠그려고 수량을 0으로 보냅니다. 남은 수가 0이 되면 상품이 eBay에서
          다시 보입니다. 5분마다 자동으로 되돌립니다.
        </p>
        <ul className="mt-1 space-y-0.5 text-xs text-zinc-700">
          {jobs
            .filter((job) => job.reflection.stillHeld > 0)
            .map((job) => (
              <li key={job.id}>
                {job.createdAt.slice(5, 16).replace("T", " ")} · 되돌림{" "}
                {job.reflection.restored.toLocaleString()} / 남음{" "}
                {job.reflection.stillHeld.toLocaleString()}
                {job.reflection.failed > 0 ? ` / 실패 ${job.reflection.failed.toLocaleString()}` : ""}
              </li>
            ))}
        </ul>
        {note && <p className="mt-1 text-xs font-semibold">{note}</p>}
      </details>
    </div>
  );
}

/**
 * eBay가 호출 한도를 이유로 설정 조회를 거부할 때, 사람이 직접 확인한 사실을 기록한다.
 * 확인해 주면 수량 변경이 다시 진행된다.
 */
function OutOfStockConfirmButton({ onDone }: { onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">eBay 호출 한도 때문에 설정을 읽지 못하고 있습니다.</p>
      <p className="mt-1 text-xs">
        eBay 판매자 설정에서 <strong>&quot;품절 시 리스팅 유지(Out of Stock Control)&quot;</strong>가
        켜져 있는지 직접 확인하신 뒤 아래를 눌러 주세요. 확인한 것으로 기록하고 작업을 다시
        진행합니다. 하루 뒤에는 자동으로 다시 확인합니다.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const response = await fetch("/api/ebay/out-of-stock-control", { method: "POST" });
            const body = await response.json();
            onDone(
              response.ok
                ? "확인한 것으로 기록했습니다. 변동처리를 다시 실행해 주세요."
                : body.error ?? "기록하지 못했습니다.",
            );
          } catch (error) {
            onDone(error instanceof Error ? error.message : "기록하지 못했습니다.");
          } finally {
            setBusy(false);
          }
        }}
        className="mt-2 cursor-pointer rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
      >
        {busy ? "기록 중…" : "eBay에서 켜진 것을 확인했습니다"}
      </button>
    </div>
  );
}

export function ChannelAutomaticOperations() {
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelChoice>("BOTH");
  const [operation, setOperation] = useState<Operation>("revise");
  const [selectionMode, setSelectionMode] = useState<"ALL" | "SKUS">("ALL");
  const [skuText, setSkuText] = useState("");
  const selectedSkus = parseChangeSkus(skuText);
  const [ebayJob, setEbayJob] = useState<AutomaticJob | null>(null);
  const [shopifyJob, setShopifyJob] = useState<AutomaticJob | null>(null);
  const [imageJobs, setImageJobs] = useState<Record<string, AutomaticJob>>({});
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [pollingStopped, setPollingStopped] = useState<Set<string>>(() => new Set());
  const completedJobIds = useRef(new Set<string>());
  const pollingIds = useRef(new Set<string>());

  const receiveJob = useCallback((kind: "EBAY" | "SHOPIFY", next: AutomaticJob) => {
    const storageKey = kind === "EBAY" ? ebayStorageKey : shopifyStorageKey;
    if (kind === "EBAY") setEbayJob(next);
    else setShopifyJob(next);

    const timedOut = Boolean(
      !terminal.has(next.status) &&
      next.submittedAt &&
      Date.now() - new Date(next.submittedAt).getTime() >= maxAutomaticPollingMs,
    );
    if (terminal.has(next.status) || timedOut) {
      window.localStorage.removeItem(storageKey);
      if (timedOut) {
        setPollingStopped((prev) => new Set(prev).add(next.id));
        setMessage("eBay 처리가 오래 지연되어 화면의 자동 확인을 중지했습니다. 작업 요청 자체는 eBay에 이미 전달되어 있습니다.");
        return;
      }
      if (!completedJobIds.current.has(next.id)) {
        completedJobIds.current.add(next.id);
        notifyProductDataChanged();
        router.refresh();
      }
    } else {
      window.localStorage.setItem(storageKey, next.id);
    }
  }, [router]);

  const poll = useCallback(async (kind: "EBAY" | "SHOPIFY", jobId: string) => {
    if (pollingIds.current.has(jobId)) return;
    pollingIds.current.add(jobId);
    try {
    const endpoint = kind === "EBAY"
      ? `/api/ebay/operations?jobId=${encodeURIComponent(jobId)}`
      : `/api/channel-publish-jobs?jobId=${encodeURIComponent(jobId)}`;
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { job?: AutomaticJob; error?: string } | null;
    if (!response.ok || !body?.job) {
      throw new Error(body?.error ?? `${kind === "EBAY" ? "eBay" : "Shopify"} 처리 상태를 확인하지 못했습니다.`);
    }
    receiveJob(kind, body.job);
    } finally { pollingIds.current.delete(jobId); }
  }, [receiveJob]);

  // 브라우저 저장소만 보면 이 화면은 서버에서 돌고 있는 작업을 모른다. 다른 기기에서
  // 시작했거나, 오래 걸려 자동 확인이 끊겼거나, 저장소가 비워졌으면 화면은 놀고 있는
  // 것처럼 보이는데 새 작업은 "이미 진행 중"이라며 거부된다. 서버에 직접 물어본다.
  const adoptServerJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/channel-publish-jobs", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as
        | { jobs?: Array<AutomaticJob & { channel: string; mode: string }> }
        | null;
      if (!response.ok || !Array.isArray(body?.jobs)) return;
      for (const job of body.jobs) {
        if (terminal.has(job.status)) continue;
        if (job.mode === "IMAGES") {
          setImageJobs((prev) => ({ ...prev, [job.channel]: job }));
          window.localStorage.setItem(`active-change-images-${job.channel}`, job.id);
        } else if (job.channel === "SHOPIFY") {
          // eBay 가격·재고는 Feed 작업이라 다른 경로로 조회한다. 여기서 받아들이면
          // 엉뚱한 곳에 상태를 물어보게 되므로 Shopify 것만 가져온다.
          receiveJob("SHOPIFY", job);
        }
      }
    } catch {
      // 조회 실패는 화면 표시 문제일 뿐이다. 작업 시작을 막지 않는다.
    }
  }, [receiveJob]);

  useEffect(() => {
    // 이 파일의 다른 조회와 같은 방식으로 렌더 뒤에 미룬다.
    const timer = window.setTimeout(() => void adoptServerJobs(), 0);
    return () => window.clearTimeout(timer);
  }, [adoptServerJobs]);

  useEffect(() => {
    const saved = [
      ["EBAY", window.localStorage.getItem(ebayStorageKey)],
      ["SHOPIFY", window.localStorage.getItem(shopifyStorageKey)],
    ] as const;
    const timer = window.setTimeout(() => {
      for (const [kind, jobId] of saved) {
        if (jobId) void poll(kind, jobId).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [poll]);

  useEffect(() => {
    const activeJobs = [
      ["EBAY", ebayJob],
      ["SHOPIFY", shopifyJob],
    ] as const;
    if (!activeJobs.some(([, job]) => job && !terminal.has(job.status) && !pollingStopped.has(job.id))) return;
    const timer = window.setInterval(() => {
      for (const [kind, job] of activeJobs) {
        if (job && !terminal.has(job.status) && !pollingStopped.has(job.id)) {
          void poll(kind, job.id).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
        }
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [ebayJob, poll, pollingStopped, shopifyJob]);

  useEffect(() => {
    let disposed = false;
    let fetching = false;
    async function refreshImages() {
      if (fetching) return;
      fetching = true;
      try {
      for (const kind of ["EBAY", "SHOPIFY"]) {
        const id = window.localStorage.getItem(`active-change-images-${kind}`);
        if (!id) continue;
        try {
          const response = await fetch(`/api/channel-publish-jobs?jobId=${encodeURIComponent(id)}`, { cache: "no-store" });
          const body = await response.json();
          if (!response.ok || !body.job) throw new Error(body.error ?? "이미지 처리 상태 조회 실패");
          if (disposed) return;
          setImageJobs(prev => ({ ...prev, [kind]: body.job }));
          if (terminal.has(body.job.status)) {
            window.localStorage.removeItem(`active-change-images-${kind}`);
            notifyProductDataChanged();
          }
        } catch (error) { if (!disposed) setMessage(String(error)); }
      }
      } finally { fetching = false; }
    }
    void refreshImages();
    const timer = window.setInterval(() => void refreshImages(), 10000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  async function requestJob(kind: "EBAY" | "SHOPIFY") {
    const endpoint = operation === "revise" ? "/api/channel-publishing/changes"
      : kind === "EBAY" ? "/api/ebay/operations" : "/api/shopify/operations";
    const response = await fetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(operation === "revise" ? { channel: kind, ...(selectionMode === "SKUS" ? { skus: selectedSkus } : {}) } : { operation }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${kind}: ${body.error ?? "자동 작업 시작 실패"}`);
    if (body.job) receiveJob(kind, body.job);
    if (body.imageJob) {
      setImageJobs(prev => ({ ...prev, [kind]: body.imageJob }));
      window.localStorage.setItem(`active-change-images-${kind}`, body.imageJob.id);
    }
    if (body.errors?.length) throw new Error(`${kind}: ${body.errors.join(" / ")}`);
    const notes = (body.notes ?? []).join(" / ");
    if (!body.job && !body.imageJob) return `${kind}: 반영할 변경 없음${notes ? ` · ${notes}` : ""}`;
    return notes ? `${kind}: ${notes}` : "";
  }

  async function start() {
    if (operation === "revise" && selectionMode === "SKUS" && (!selectedSkus.length || selectedSkus.length > 500)) {
      setMessage("상품번호를 1~500개 입력해 주세요."); return;
    }
    const channelLabel = channel === "BOTH" ? "eBay와 Shopify" : channel === "EBAY" ? "eBay" : "Shopify";
    const operationLabel = operation === "revise" ? "가격·재고·이미지 변경" : "개별상품 판매중단";
    if (!window.confirm(
      `${channelLabel}의 ${operation === "revise" && selectionMode === "SKUS" ? `지정 상품 ${selectedSkus.length}개 (${selectedSkus.slice(0, 20).join(", ")}${selectedSkus.length > 20 ? " 외" : ""}) 중` : "전체 상품 중"} ${operationLabel} 대상을 반영할까요?\n\n묶음 이미지 변경은 대표·전체 옵션 이미지를 함께 갱신합니다. 가격·재고는 지정한 카드만 반영합니다.`,
    )) return;

    setStarting(true);
    setMessage("");
    const channels = channel === "BOTH" ? (["EBAY", "SHOPIFY"] as const) : [channel];
    const results = await Promise.allSettled(channels.map((kind) => requestJob(kind)));
    const failures = results.flatMap((result) => result.status === "rejected"
      ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
      : []);
    setMessage([...failures, ...results.flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : [])].join(" / "));
    // 거부당했으면 무엇이 막고 있는지 바로 보여 준다. 중단 버튼도 그때 함께 나타난다.
    if (failures.length) await adoptServerJobs();
    setStarting(false);
  }

  const active = [ebayJob, shopifyJob, ...Object.values(imageJobs)].some((job) => job && !terminal.has(job.status) && !pollingStopped.has(job.id));
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200">
      <EbayQuantityRecovery />
      <details className="group/changes" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-zinc-50 px-4 py-4">
          <span className="flex items-center gap-3"><RefreshCw className="h-5 w-5 shrink-0 text-blue-700" /><span><span className="block text-sm font-bold text-zinc-900">기존 상품 변동처리</span><span className="mt-1 block text-xs text-zinc-500">가격·재고·이미지 변경 및 판매중단</span></span></span>
          <span className="flex items-center gap-2 text-xs text-zinc-500">{active ? "처리 중" : ""}<ChevronDown className="h-4 w-4 transition group-open/changes:rotate-180" /></span>
        </summary>
        <div className="space-y-4 border-t border-zinc-200 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-semibold text-zinc-600">반영 채널
              <select aria-label="자동 반영 채널" value={channel} onChange={(event) => setChannel(event.currentTarget.value as ChannelChoice)} disabled={starting || active} className="block h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 disabled:bg-zinc-100">
                <option value="BOTH">eBay + Shopify</option><option value="EBAY">eBay만</option><option value="SHOPIFY">Shopify만</option>
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-zinc-600">작업 종류
              <select aria-label="자동 반영 작업" value={operation} onChange={(event) => setOperation(event.currentTarget.value as Operation)} disabled={starting || active} className="block h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 disabled:bg-zinc-100">
                <option value="revise">가격·재고·이미지 변경</option><option value="end">개별상품 판매중단</option>
              </select>
            </label>
          </div>
      {operation === "revise" ? <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
        <label className="flex items-center gap-2 text-sm font-semibold">변동처리 대상
          <select value={selectionMode} onChange={e => setSelectionMode(e.target.value as "ALL" | "SKUS")} disabled={starting || active} className="rounded border bg-white p-2">
            <option value="ALL">전체 변경 상품</option><option value="SKUS">상품번호로 지정</option>
          </select>
        </label>
        <>
          <label htmlFor="change-product-skus" className="block text-sm font-semibold">상품번호 입력 (여러 개 가능)</label>
          <textarea id="change-product-skus" aria-label="변동처리 상품번호" value={skuText} onChange={e => { setSkuText(e.target.value); setSelectionMode("SKUS"); }} disabled={starting || active} rows={3} placeholder={"변동처리할 상품번호를 입력하세요. 예: 101214, 15131\n15369_15372"} className="w-full rounded border border-zinc-300 bg-white p-2 text-sm" />
          <p className="text-xs font-semibold text-blue-700">{selectionMode === "ALL" ? "현재 전체 변경 상품 대상입니다. 번호를 입력하면 지정 상품만 처리하도록 전환됩니다." : `현재 입력한 ${selectedSkus.length}개 상품만 변동처리합니다.`}</p>
          <p className="text-xs text-zinc-600">상품번호 {selectedSkus.length}개 · 쉼표, 줄바꿈, 공백으로 구분해 최대 500개 입력할 수 있습니다. 중복은 자동 제외합니다. 묶음 이미지는 대표·전체 옵션을 함께 갱신하며 가격·재고는 지정한 카드만 처리합니다.</p>
        </>
      </div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3">
        <p className="text-sm font-medium text-zinc-700">{channel === "BOTH" ? "eBay + Shopify" : channel === "EBAY" ? "eBay" : "Shopify"} · {operation === "end" ? "전체 판매중단 대상" : selectionMode === "ALL" ? "전체 변경 상품" : `지정 상품 ${selectedSkus.length}개`}</p>
        <button type="button" onClick={() => void start()} disabled={starting || active} className={`inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-4 text-sm font-semibold text-white disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 ${operation === "end" ? "border-rose-700 bg-rose-700 hover:bg-rose-600" : "border-blue-700 bg-blue-700 hover:bg-blue-600"}`}>
          {starting || active ? <Loader2 className="h-4 w-4 animate-spin" /> : operation === "end" ? <StopCircle className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          {operation === "end" ? "판매중단 반영" : "변동처리 시작"}
        </button>
      </div>
      <details className="text-xs text-zinc-500"><summary className="cursor-pointer">반영 범위와 처리 한도 안내</summary><p className="mt-2 leading-relaxed">이미지·워터마크·배경 변경은 묶음 대표와 옵션 이미지까지 반영합니다. 한 번에 채널별 가격·재고 최대 500개(Shopify), 이미지 최대 500개 판매상품을 처리합니다. 남은 대상은 다음 실행에 반영합니다.</p></details>
        </div>
      </details>
      {message ? (
        <div className="border-t p-4">
          <p role="status" className="text-sm font-medium text-rose-700">{message}</p>
          {/*
            Trading API 일일 호출 한도를 넘기면 설정을 읽지 못해 수량 변경이 통째로
            막힌다. 사람이 eBay 화면에서 직접 보고 확인해 주면 그때까지 기다리지 않아도
            된다. 한도는 하루가 지나면 풀린다.
          */}
          {/(518|품절 시 리스팅 유지|판매 보류·재개)/.test(message) && (
            <OutOfStockConfirmButton onDone={setMessage} />
          )}
        </div>
      ) : null}
      {(["EBAY", "SHOPIFY"] as const).map(kind => {
        const entries = [
          { label: operation === "end" ? "판매중단" : "가격·수량", job: kind === "EBAY" ? ebayJob : shopifyJob },
          { label: "이미지", job: imageJobs[kind] },
        ].filter((entry): entry is { label: string; job: AutomaticJob } => Boolean(entry.job));
        if (!entries.length) return null;
        const running = entries.some(({job}) => !terminal.has(job.status));
        const failed = entries.some(({job}) => job.failureCount > 0 || job.status === "FAILED");
        return <div key={kind} className={`m-3 rounded-md border p-3 text-sm ${statusClass(running ? "RUNNING" : failed ? "FAILED" : "COMPLETED")}`} role="status">
          <strong>{kind === "EBAY" ? "eBay" : "Shopify"} 변동처리</strong>
          {entries.map(({label, job}) => {
            const processed = job.processedCount ?? job.successCount + job.failureCount;
            const status = ({ COMPLETED: "완료", COMPLETED_WITH_ERROR: "일부 실패", FAILED: "실패", CANCELLED: "중단", CANCELED: "중단", QUEUED: "대기", RUNNING: "진행 중", WAITING: "차례 대기 중" } as Record<string,string>)[job.status] ?? "결과 확인 중";
            const failures = job.failures ?? job.items?.filter(i => i.status === "FAILED").map(i => ({sku:i.sku,itemId:i.id,message:i.error ?? "처리 실패"})) ?? [];
            return <div key={job.id} className="mt-2 border-t border-current/10 pt-2">
              <p className="font-semibold">{label} · {status}</p>
              <p>대상 {job.totalCount} · 처리 {processed} · 성공 {job.successCount} · 실패 {job.failureCount}{label === "이미지" ? ` · 변경 없음 ${Math.max(0, processed-job.successCount-job.failureCount)} · 미처리 ${Math.max(0,job.totalCount-processed)}` : ""}</p>
              {job.error ? <p className="text-rose-700">{job.error}</p> : null}
              {failures.length ? <details><summary className="cursor-pointer">실패 상세</summary>{failures.map(f => <p key={f.itemId}>{f.sku} · {f.message}</p>)}</details> : null}
            </div>;
          })}
        </div>;
      })}
    </section>
  );
}
