"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, OctagonX, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { notifyProductDataChanged } from "@/lib/client-product-refresh";
import { RegistrationTargetPreview, type RegistrationPreviewTarget } from "@/components/RegistrationTargetPreview";

type Channel = "EBAY" | "SHOPIFY";
type ChannelChoice = "BOTH" | Channel;
type Job = {
  id: string;
  channel: Channel;
  status: string;
  totalCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  items?: Array<{ sku: string; status: string; error: string | null }>;
};

const terminal = new Set(["COMPLETED", "COMPLETED_WITH_ERROR", "FAILED", "CANCELLED"]);
const storageKey = (channel: Channel) => `active-${channel.toLowerCase()}-product-registration-job`;

export function ChannelRegistrationControls() {
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelChoice>("BOTH");
  const [requestedCount, setRequestedCount] = useState(1);
  const [jobs, setJobs] = useState<Partial<Record<Channel, Job>>>({});
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState("");
  const [needsEbayLocation, setNeedsEbayLocation] = useState(false);
  const [postalCode, setPostalCode] = useState("");
  const [locationCity, setLocationCity] = useState("");
  const [locationState, setLocationState] = useState("");
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [previews, setPreviews] = useState<Partial<Record<Channel, RegistrationPreviewTarget | null>>>({});
  const [previewLoading, setPreviewLoading] = useState<Partial<Record<Channel, boolean>>>({});
  const [previewErrors, setPreviewErrors] = useState<Partial<Record<Channel, string>>>({});
  const [submitted, setSubmitted] = useState<Partial<Record<Channel, boolean>>>({});
  const previewSequence = useRef({ EBAY: 0, SHOPIFY: 0 });
  const loadPreview = useCallback(async (kind: Channel, excludeIds: string[] = []) => {
    const sequence = ++previewSequence.current[kind];
    setPreviewLoading((current) => ({ ...current, [kind]: true }));
    setPreviewErrors((current) => ({ ...current, [kind]: "" }));
    try {
      const params = new URLSearchParams({ channel: kind, random: excludeIds.length ? "1" : "0" });
      excludeIds.forEach((id) => params.append("exclude", id));
      const response = await fetch(`/api/products/publish-preview?${params}`, { cache: "no-store" });
      const body = await response.json() as { target?: RegistrationPreviewTarget | null; noAlternative?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error ?? "시험등록 대상을 확인하지 못했습니다.");
      if (sequence !== previewSequence.current[kind]) return;
      if (body.noAlternative && excludeIds.length) throw new Error("현재 상품 외에 선택할 다른 미등록 상품이 없습니다.");
      setPreviews((current) => ({ ...current, [kind]: body.target ?? null }));
      setSubmitted((current) => ({ ...current, [kind]: false }));
    } catch (error) {
      if (sequence === previewSequence.current[kind]) setPreviewErrors((current) => ({ ...current, [kind]: error instanceof Error ? error.message : "조회 실패" }));
    } finally {
      if (sequence === previewSequence.current[kind]) setPreviewLoading((current) => ({ ...current, [kind]: false }));
    }
  }, []);
  useEffect(() => {
    if (requestedCount !== 1) return;
    const sequences = previewSequence.current;
    const timer = window.setTimeout(() => {
      for (const kind of channel === "BOTH" ? ["EBAY", "SHOPIFY"] as const : [channel]) void loadPreview(kind);
    }, 0);
    return () => { window.clearTimeout(timer); sequences.EBAY++; sequences.SHOPIFY++; };
  }, [channel, requestedCount, loadPreview]);

  const receive = useCallback((kind: Channel, job: Job) => {
    setJobs((current) => ({ ...current, [kind]: job }));
    if (terminal.has(job.status)) {
      window.localStorage.removeItem(storageKey(kind));
      if (job.successCount) notifyProductDataChanged();
      router.refresh();
    } else {
      window.localStorage.setItem(storageKey(kind), job.id);
    }
  }, [router]);

  const poll = useCallback(async (kind: Channel, jobId: string) => {
    const response = await fetch(`/api/channel-publish-jobs?jobId=${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as { job?: Job; error?: string } | null;
    if (!response.ok || !body?.job) throw new Error(body?.error ?? "상품 등록 상태를 확인하지 못했습니다.");
    receive(kind, body.job);
  }, [receive]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/ebay/inventory-location", { cache: "no-store" })
        .then(async (response) => response.ok ? response.json() as Promise<{ ready?: boolean }> : null)
        .then((body) => {
          if (body && body.ready === false) setNeedsEbayLocation(true);
        })
        .catch(() => undefined);
      for (const kind of ["EBAY", "SHOPIFY"] as const) {
        const jobId = window.localStorage.getItem(storageKey(kind));
        if (jobId) void poll(kind, jobId).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
      }
      void fetch("/api/channel-publish-jobs", { cache: "no-store" })
        .then(async (response) => response.ok ? response.json() as Promise<{ jobs?: Job[] }> : null)
        .then((body) => {
          for (const job of body?.jobs ?? []) receive(job.channel, job);
        })
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [poll, receive]);

  useEffect(() => {
    const active = Object.entries(jobs).filter((entry): entry is [Channel, Job] =>
      Boolean(entry[1] && !terminal.has(entry[1].status)),
    );
    if (!active.length) return;
    const timer = window.setInterval(() => {
      for (const [kind, job] of active) {
        void poll(kind, job.id).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
      }
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [jobs, poll]);

  async function startOne(kind: Channel, productIds: string[], expectedOptionProductIds?: string[]) {
    if (!productIds.length) return `${kind === "EBAY" ? "eBay" : "Shopify"}: 새로 등록할 미등록 상품이 없습니다.`;
    const response = await fetch("/api/products/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: kind, productIds, expectedOptionProductIds, confirmed: true }),
    });
    const body = (await response.json().catch(() => null)) as {
      job?: Job;
      selectedProductCount?: number;
      remainingProductCount?: number;
      reusedActiveJob?: boolean;
      error?: string;
    } | null;
    if (
      kind === "SHOPIFY" &&
      response.status === 422 &&
      body?.error?.includes("미등록 상품이 없습니다")
    ) {
      return "Shopify 등록 가능 상품 0개 · 건너뜀";
    }
    if (kind === "EBAY" && body?.error?.includes("활성 재고 위치가 없습니다")) {
      setNeedsEbayLocation(true);
    }
    if (!response.ok || !body?.job) {
      throw new Error(`${kind === "EBAY" ? "eBay" : "Shopify"}: ${body?.error ?? "등록을 시작하지 못했습니다."}`);
    }
    receive(kind, body.job);
    if (expectedOptionProductIds) setSubmitted((current) => ({ ...current, [kind]: true }));
    if (body.reusedActiveJob) {
      return `${kind === "EBAY" ? "eBay" : "Shopify"}에서 이미 진행 중인 등록 작업을 이어서 확인합니다.`;
    }
    const remaining = body.remainingProductCount ?? 0;
    return `${kind === "EBAY" ? "eBay" : "Shopify"} ${(body.selectedProductCount ?? 0).toLocaleString()}개 접수${remaining ? ` · 다음 실행 대상 ${remaining.toLocaleString()}개 남음` : ""}`;
  }

  async function createInventoryLocation() {
    if (!/^\d{5}$/.test(postalCode.trim())) {
      setMessage("한국 우편번호 5자리를 입력해 주세요.");
      return;
    }
    if (!locationCity.trim() || !locationState.trim()) {
      setMessage("eBay 발송지의 영문 도시와 시/도를 입력해 주세요.");
      return;
    }
    setCreatingLocation(true);
    setMessage("");
    try {
      const response = await fetch("/api/ebay/inventory-location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          postalCode: postalCode.trim(),
          city: locationCity.trim(),
          stateOrProvince: locationState.trim(),
          confirmed: true,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        merchantLocationKey?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.merchantLocationKey) {
        throw new Error(body?.error ?? "eBay 재고 위치를 만들지 못했습니다.");
      }
      setNeedsEbayLocation(false);
      setMessage("eBay 재고 위치를 만들었습니다. 이제 상품 등록 버튼을 다시 눌러 주세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "eBay 재고 위치를 만들지 못했습니다.");
    } finally {
      setCreatingLocation(false);
    }
  }

  async function start() {
    setStarting(true);
    setMessage("");
    const targets = channel === "BOTH" ? (["EBAY", "SHOPIFY"] as const) : [channel];
    try {
    const candidates = requestedCount === 1 ? targets.map((kind) => ({ kind, products: previews[kind] && !submitted[kind] ? [{ id: previews[kind]!.productId, sku: previews[kind]!.sku }] : [], memberIds: previews[kind]?.memberIds })) : await Promise.all(targets.map(async (kind) => {
      const response = await fetch(`/api/products/publish?channel=${kind}&limit=${requestedCount}`, { cache: "no-store" });
      const body = await response.json() as { products?: Array<{ id: string; sku: string }>; error?: string };
      if (!response.ok || !body.products) throw new Error(body.error ?? "등록 대상을 확인하지 못했습니다.");
      return { kind, products: body.products, memberIds: undefined as string[] | undefined };
    }));
    const description = candidates.map(({ kind, products }) => `${kind === "EBAY" ? "eBay" : "Shopify"}: ${products.length ? `미등록 ${products.length}개 · SKU ${products.slice(0, 5).map((product) => product.sku).join(", ")}${products.length > 5 ? " 외" : ""}` : "새 등록 대상 없음"}`).join("\n");
    setMessage(description);
    if (!candidates.some(({ products }) => products.length)) return;
    if (!window.confirm(`${description}\n\n위 미등록 상품을 실제 판매 등록할까요? 옵션 상품은 같은 묶음의 카드와 함께 등록됩니다. 이미 등록된 상품은 건너뜁니다.`)) return;
    const results = await Promise.allSettled(candidates.map(({ kind, products, memberIds }) => startOne(kind, products.map((product) => product.id), memberIds)));
    setMessage(results.map((result) => result.status === "fulfilled"
      ? result.value
      : result.reason instanceof Error ? result.reason.message : String(result.reason)).join(" / "));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "등록 대상을 확인하지 못했습니다.");
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    if (!window.confirm("아직 eBay·Shopify에 보내지 않은 등록 항목을 중단할까요? 이미 등록된 상품은 그대로 유지됩니다.")) return;
    setCancelling(true);
    try {
      const response = await fetch("/api/channel-publish-jobs", { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { cancelledJobs?: number; cancelledItems?: number; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "등록 작업을 중단하지 못했습니다.");
      for (const kind of ["EBAY", "SHOPIFY"] as const) window.localStorage.removeItem(storageKey(kind));
      setJobs({});
      setMessage(`등록 작업 ${body?.cancelledJobs ?? 0}개를 중단했습니다. 대기 중이던 ${body?.cancelledItems ?? 0}개는 전송하지 않습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "등록 작업을 중단하지 못했습니다.");
    } finally {
      setCancelling(false);
    }
  }

  const active = Object.values(jobs).some((job) => job && !terminal.has(job.status));
  const previewChannels: Channel[] = channel === "BOTH" ? ["EBAY", "SHOPIFY"] : [channel];
  const previewUnavailable = requestedCount === 1 && (previewChannels.some((kind) => previewLoading[kind]) || !previewChannels.some((kind) => previews[kind] && !submitted[kind]));
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200">
    <details className="group/registration">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-zinc-50 px-4 py-4">
        <span className="flex items-center gap-3"><Upload className="h-5 w-5 shrink-0 text-emerald-700" /><span><span className="block text-sm font-bold text-zinc-900">시험등록·신규등록</span><span className="mt-1 block text-xs text-zinc-500">미등록 상품 확인 후 판매 시작 · 옵션 묶음 자동 구성</span></span></span>
        <span className="flex items-center gap-2 text-xs text-zinc-500">{active ? "등록 중" : ""}<span className="group-open/registration:hidden">펼치기</span><span className="hidden group-open/registration:inline">접기</span><ChevronDown className="h-4 w-4 transition group-open/registration:rotate-180" /></span>
      </summary>
      <div className="space-y-4 border-t border-zinc-200 p-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="등록 방식">
        <button type="button" aria-pressed={requestedCount === 1} disabled={starting || active} onClick={() => setRequestedCount(1)} className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${requestedCount === 1 ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>1개 시험등록</button>
        <button type="button" aria-pressed={requestedCount > 1} disabled={starting || active} onClick={() => setRequestedCount(Math.max(2, requestedCount))} className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${requestedCount > 1 ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>여러 상품 신규등록</button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5 text-xs font-semibold text-zinc-600"><span className="block">등록 채널</span>
        <select value={channel} onChange={(event) => setChannel(event.currentTarget.value as ChannelChoice)} disabled={starting || active} aria-label="상품 등록 채널" className="h-10 rounded-md border border-emerald-300 bg-white px-3 text-sm font-semibold">
          <option value="BOTH">eBay + Shopify</option>
          <option value="EBAY">eBay만</option>
          <option value="SHOPIFY">Shopify만</option>
        </select>
        </label>
        <label className="flex h-10 items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-950">
          등록 작업 수
          <input
            type="number"
            min={1}
            max={500}
            value={requestedCount}
            disabled={starting || active}
            onChange={(event) => setRequestedCount(Math.max(1, Math.min(500, Number(event.currentTarget.value) || 1)))}
            aria-label="등록 작업 수"
            className="w-16 bg-transparent text-right outline-none"
          />
        </label>
      </div>
      <p className="text-xs leading-relaxed text-zinc-500">{requestedCount === 1 ? "시험등록도 실제 판매 등록입니다. 아래에서 채널별 대상과 사진을 확인하세요." : "입력한 수만큼 미등록 후보를 선택합니다. 같은 묶음은 옵션으로 합쳐져 실제 판매상품 수와 다를 수 있습니다."} 옵션 우선 · 대표 썸네일 자동 생성 · 나머지는 단품 등록</p>
      {requestedCount === 1 ? previewChannels.map((kind) => <RegistrationTargetPreview key={kind} channel={kind} target={previews[kind]} loading={Boolean(previewLoading[kind])} disabled={starting || active} submitted={submitted[kind]} error={previewErrors[kind]} onChange={() => void loadPreview(kind, previews[kind]?.memberIds ?? [])} />) : null}
      {needsEbayLocation ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-white p-3">
          <p className="text-sm font-semibold text-amber-900">eBay 최초 등록용 재고 위치가 필요합니다.</p>
          <p className="mt-1 text-xs text-zinc-600">eBay가 해외 판매자의 우편번호만으로 지역을 만들지 못하는 경우가 있어 실제 발송지의 영문 도시와 시/도도 함께 저장합니다.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={postalCode}
              onChange={(event) => setPostalCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 5))}
              inputMode="numeric"
              maxLength={5}
              placeholder="우편번호 5자리"
              aria-label="eBay 재고 위치 우편번호"
              className="h-10 w-40 rounded-md border border-amber-300 px-3 text-sm"
            />
            <input
              value={locationCity}
              onChange={(event) => setLocationCity(event.currentTarget.value.slice(0, 64))}
              placeholder="도시 (예: Cheonan-si)"
              aria-label="eBay 재고 위치 도시"
              className="h-10 w-52 rounded-md border border-amber-300 px-3 text-sm"
            />
            <input
              value={locationState}
              onChange={(event) => setLocationState(event.currentTarget.value.slice(0, 64))}
              placeholder="시/도 (예: Chungcheongnam-do)"
              aria-label="eBay 재고 위치 시/도"
              className="h-10 w-60 rounded-md border border-amber-300 px-3 text-sm"
            />
            <button
              type="button"
              onClick={() => void createInventoryLocation()}
              disabled={creatingLocation || postalCode.length !== 5 || !locationCity.trim() || !locationState.trim()}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-600 disabled:bg-zinc-300"
            >
              {creatingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              eBay 재고 위치 만들기
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
        <p className="text-sm font-medium text-zinc-700">{channel === "BOTH" ? "eBay + Shopify" : channel === "EBAY" ? "eBay" : "Shopify"} · {requestedCount === 1 ? "미리 본 대상으로 시험등록" : `채널별 미등록 후보 최대 ${requestedCount}개`}</p>
        <button type="button" onClick={() => void start()} disabled={starting || active || previewUnavailable} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-600 disabled:bg-zinc-300">
          {starting || active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {requestedCount === 1 ? "이 대상으로 시험등록" : "신규등록 시작"}
        </button>
      </div>
      </div>
    </details>
      {message ? <p role="status" className="border-t px-4 py-3 text-sm text-zinc-700">{message}</p> : null}
      {active ? <div className="flex items-center justify-between gap-3 border-t px-4 py-3"><p className="text-sm font-semibold text-emerald-800">등록 진행 상황</p><button type="button" onClick={() => void cancel()} disabled={cancelling} className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">{cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <OctagonX className="h-4 w-4" />}등록 중단</button></div> : null}
      {Object.entries(jobs).map(([kind, job]) => job ? (
        <div key={kind} role="status" className={`m-3 rounded-lg border p-3 text-sm ${job.failureCount || job.status === "FAILED" ? "border-rose-200 bg-rose-50 text-rose-900" : !terminal.has(job.status) ? "border-blue-200 bg-blue-50 text-blue-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          <p>
            <b>{kind === "EBAY" ? "eBay" : "Shopify"}</b> · {job.status === "CANCELLED" ? "중단됨" : terminal.has(job.status) ? "완료" : "등록 중"} · 처리 {job.processedCount}/{job.totalCount}
            {job.processedCount > job.successCount + job.failureCount ? ` · 이미 등록 완료 ${job.processedCount - job.successCount - job.failureCount}` : ""}
            {job.successCount || job.failureCount || job.processedCount === 0 ? ` · 신규 등록 성공 ${job.successCount} · 실패 ${job.failureCount}` : ""}
            {job.items?.filter((item) => item.status === "SKIPPED").slice(0, 3).map((item) => ` · ${item.sku}: 이미 등록 완료`).join("")}
            {job.items?.filter((item) => item.status === "PROCESSING" && item.error).slice(0, 1).map((item) => ` · ${item.sku}: ${item.error}`).join("")}
          </p>
          <progress aria-label={`${kind === "EBAY" ? "eBay" : "Shopify"} 등록 진행률`} max={Math.max(1, job.totalCount)} value={job.processedCount} className="mt-2 h-1.5 w-full accent-emerald-600" />
          {job.items?.some((item) => item.status === "FAILED") ? <details className="mt-2"><summary className="cursor-pointer font-semibold">실패 상품 상세</summary><ul className="mt-2 max-h-48 space-y-1 overflow-auto break-words">{job.items.filter(item => item.status === "FAILED").map((item, index) => <li key={`${item.sku}-${index}`}>{item.sku} · {item.error ?? "실패"}</li>)}</ul></details> : null}
        </div>
      ) : null)}
    </section>
  );
}
