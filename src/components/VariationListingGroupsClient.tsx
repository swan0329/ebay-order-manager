"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState } from "react";
type Product = {
  id: string;
  sku: string;
  variationName: string;
  imageUrl: string | null;
  priceUsd: string | null;
};
type Group = {
  key: string;
  groupName: string;
  albumName: string;
  versionName: string;
  title: string;
  ebayTitle: string;
  products: Product[];
  truncated: boolean;
  activeSingleCount: number;
  ebayItemId: string | null;
  includedCount: number;
  newOptionCount: number;
  invalidImageCount: number;
  thumbnailStatus: "READY" | "FAILED" | "MISSING";
  thumbnailUrl: string | null;
  thumbnailError: string | null;
  thumbnailGeneratedAt: string | null;
};
type Payload = {
  groups: Group[];
  unmatchedCount: number;
  missingPriceCount: number;
  latestCompleteReportAt: string | null;
  pricingReady: boolean;
};
type BatchResult = {
  total: number;
  succeeded: number;
  uploaded: number;
  reused: number;
  failed: number;
  finishedAt: number;
};
type ConfirmResult = {
  confirmedGroups: number;
  newParentListings: number;
  addedOptions: number;
  endedSingles: number;
  pendingGroups: Array<{ title: string; parentSku: string }>;
  endableGroupKeys: string[];
  failures: Array<{
    sku: string | null;
    itemId: string | null;
    message: string | null;
  }>;
};
type ListingTemplate = {
  id: string;
  name: string;
  isDefault: boolean;
  descriptionTemplateHtml: string | null;
};
export function VariationListingGroupsClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    title: string;
    isR2: boolean;
  } | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
    startedAt: number;
    currentTitle: string;
  } | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [templates, setTemplates] = useState<ListingTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [endNewGroups, setEndNewGroups] = useState(false);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  useEffect(() => {
    void Promise.all([
      fetch("/api/listing-upload/variation-groups", { cache: "no-store" }),
      fetch("/api/listings/templates", { cache: "no-store" }),
    ])
      .then(async ([groupsResponse, templatesResponse]) => {
        const groupsBody = await groupsResponse.json();
        const templatesBody = await templatesResponse.json();
        if (!groupsResponse.ok) throw new Error(groupsBody.error);
        if (!templatesResponse.ok) throw new Error(templatesBody.error);
        const availableTemplates = (templatesBody.templates ?? []) as ListingTemplate[];
        setData(groupsBody);
        setTemplates(availableTemplates);
        setTemplateId(
          availableTemplates.find((template) => template.isDefault)?.id ?? "",
        );
      })
      .catch((e) => setError(String(e)));
  }, []);
  const progressStartedAt = progress?.startedAt;
  useEffect(() => {
    if (!progressStartedAt) return;
    const timer = window.setInterval(
      () =>
        setElapsedSeconds(Math.floor((Date.now() - progressStartedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [progressStartedAt]);
  const shown = useMemo(
    () =>
      data?.groups.filter(
        (g) =>
          !query.trim() ||
          `${g.ebayTitle} ${g.products.map((p) => p.variationName).join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ) ?? [],
    [data, query],
  );
  const selectedGroups = useMemo(
    () => data?.groups.filter((group) => selected.includes(group.key)) ?? [],
    [data, selected],
  );
  const selectedReady =
    selectedGroups.length > 0 &&
    selectedGroups.every(
      (group) => group.thumbnailStatus === "READY" && group.invalidImageCount === 0,
    );
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const descriptionTemplateReady = Boolean(
    selectedTemplate?.descriptionTemplateHtml?.trim(),
  );
  const toggle = (key: string) =>
    setSelected((v) =>
      v.includes(key) ? v.filter((x) => x !== key) : [...v, key],
    );
  function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }
  async function requestCsv(
    endpoint: string,
    groupKeys: string[],
    extra: Record<string, unknown> = {},
  ) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ groupKeys, templateId, confirmed: true, ...extra }),
      });
      if (!r.ok) {
        const contentType = r.headers.get("content-type") ?? "";
        const message = contentType.includes("application/json")
          ? (await r.json()).error
          : await r.text();
        throw new Error(message || "파일 생성 실패");
      }
      return await r.blob();
    } finally {
      window.clearTimeout(timeout);
    }
  }
  async function download(endpoint: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      const blob = await requestCsv(endpoint, selected);
      saveBlob(blob, name);
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "AbortError"
          ? "처리가 2분을 넘겨 중단되었습니다. R2 연결과 상품 이미지 응답 상태를 확인해 주세요."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshGroups() {
    const r = await fetch("/api/listing-upload/variation-groups", {
      cache: "no-store",
    });
    const body = await r.json();
    if (!r.ok)
      throw new Error(body.error || "묶음 상태를 새로고치지 못했습니다.");
    setData(body);
  }
  async function prepareThumbnails() {
    setBusy(true);
    setError(null);
    setBatchResult(null);
    setElapsedSeconds(0);
    const startedAt = Date.now();
    let uploaded = 0;
    let reused = 0;
    let failed = 0;
    setProgress({
      completed: 0,
      total: selected.length,
      startedAt,
      currentTitle: "준비 중",
    });
    for (let index = 0; index < selected.length; index += 1) {
      const key = selected[index];
      const title =
        data?.groups.find((group) => group.key === key)?.title ?? key;
      setProgress({
        completed: index,
        total: selected.length,
        startedAt,
        currentTitle: `${title} · 이미지 합성 및 R2 저장 중`,
      });
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 120_000);
      try {
        const r = await fetch(
          "/api/listing-upload/variation-groups/prepare-thumbnail",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({ groupKey: key }),
          },
        );
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "썸네일 생성 실패");
        if (body.reused) reused += 1;
        else uploaded += 1;
        setData((current) =>
          current
            ? {
                ...current,
                groups: current.groups.map((group) =>
                  group.key === key
                    ? {
                        ...group,
                        thumbnailStatus: "READY",
                        thumbnailUrl: body.url,
                        thumbnailError: null,
                        thumbnailGeneratedAt: body.generatedAt,
                      }
                    : group,
                ),
              }
            : current,
        );
      } catch (e) {
        failed += 1;
        const message =
          e instanceof DOMException && e.name === "AbortError"
            ? "2분을 넘겨 중단되었습니다."
            : e instanceof Error
              ? e.message
              : String(e);
        setData((current) =>
          current
            ? {
                ...current,
                groups: current.groups.map((group) =>
                  group.key === key
                    ? {
                        ...group,
                        thumbnailStatus: "FAILED",
                        thumbnailError: message,
                      }
                    : group,
                ),
              }
            : current,
        );
      } finally {
        window.clearTimeout(timeout);
      }
      setProgress({
        completed: index + 1,
        total: selected.length,
        startedAt,
        currentTitle: title,
      });
    }
    await refreshGroups().catch(() => {});
    const succeeded = uploaded + reused;
    setBatchResult({
      total: selected.length,
      succeeded,
      uploaded,
      reused,
      failed,
      finishedAt: Date.now(),
    });
    if (failed > 0)
      setError(
        `${failed}개 묶음은 실패했습니다. 빨간색 실패 사유를 확인한 뒤 다시 시도해 주세요.`,
      );
    setBusy(false);
    setProgress(null);
  }
  // 옵션 추가 행과 기존 단품 종료 행을 한 파일에 담아 받는다. eBay 업로드가 한 번으로
  // 끝나고, 단품과 옵션상품이 동시에 살아 있는 중복 등록 구간도 거의 사라진다.
  async function downloadVariationCsv() {
    setBusy(true);
    setError(null);
    setConfirmResult(null);
    try {
      const parts: string[] = [];
      for (let offset = 0; offset < selected.length; offset += 20) {
        const blob = await requestCsv(
          "/api/listing-upload/variation-groups/export",
          selected.slice(offset, offset + 20),
          { endSingles: true, endNewGroupSingles: endNewGroups },
        );
        const text = (await blob.text()).replace(/^\uFEFF/, "");
        parts.push(
          offset === 0 ? text : text.split(/\r?\n/).slice(1).join("\r\n"),
        );
      }
      saveBlob(
        new Blob([`\uFEFF${parts.filter(Boolean).join("\r\n")}`], {
          type: "text/csv;charset=utf-8",
        }),
        "ebay-variation-listings",
      );
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "AbortError"
          ? "CSV 생성이 2분을 넘겨 중단되었습니다."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }
  // eBay가 돌려준 처리 결과 파일로 부모 옵션상품의 Item number를 확정한다. 전체
  // 활성상품 보고서를 다시 받을 필요가 없고, eBay API도 호출하지 않는다.
  async function confirmUpload(file: File) {
    setBusy(true);
    setError(null);
    setConfirmResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch(
        "/api/listing-upload/variation-groups/confirm-upload",
        { method: "POST", body: form },
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "결과 파일을 읽지 못했습니다.");
      setConfirmResult(body.result);
      await refreshGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  // 결과 파일로 등록 성공이 확인된 묶음에 남은 단품만 골라 종료 CSV를 받는다.
  // 신규 묶음도 여기서는 안전하게 끝낼 수 있다.
  async function downloadConfirmedEndCsv(groupKeys: string[]) {
    setBusy(true);
    setError(null);
    try {
      const blob = await requestCsv(
        "/api/listing-upload/variation-groups/end-singles",
        groupKeys,
      );
      saveBlob(blob, "ebay-end-replaced-singles");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function showPreview(group: Group) {
    if (group.thumbnailStatus === "READY" && group.thumbnailUrl) {
      setPreview({
        url: group.thumbnailUrl,
        title: group.ebayTitle,
        isR2: true,
      });
      return;
    }
    setPreviewing(group.key);
    setError(null);
    try {
      const r = await fetch("/api/listing-upload/variation-groups/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupKey: group.key }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "미리보기 생성 실패");
      setPreview({ url: b.dataUrl, title: group.ebayTitle, isR2: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(null);
    }
  }
  if (!data)
    return (
      <p className="rounded-xl border bg-white p-6 text-sm text-zinc-500">
        {error || "묶음 후보를 분석하고 있습니다…"}
      </p>
    );
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="묶음상품 후보" value={`${data.groups.length}개`} />
        <Stat
          label="선택 옵션"
          value={`${data.groups.reduce((n, g) => n + g.products.length, 0)}장`}
        />
        <Stat label="단품 유지" value={`${data.unmatchedCount}장`} />
        <Stat label="가격 미입력" value={`${data.missingPriceCount}장`} />
      </section>
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
        <b>업로드 순서</b>
        <p className="mt-1 text-xs leading-5">
          ① 선택 묶음 썸네일 만들기 → ② <b>옵션 추가 + 단품 종료 CSV</b> 한 파일을
          eBay에 업로드 → ③ eBay가 준 처리 결과 파일을 아래에 올리기. 기존 단품을
          끝내는 행이 같은 파일에 함께 들어가므로 eBay 업로드는 한 번이면 되고,
          중간에 전체 활성상품 보고서를 다시 받지 않아도 됩니다. CSV 생성 시
          미리보기와 같은 구성을 R2에 업로드합니다.
        </p>
      </section>
      <section className="rounded-xl border bg-white p-4">
        <div className="flex gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="그룹, 앨범, 버전, 멤버 검색"
            className="h-10 flex-1 rounded-md border px-3 text-sm"
          />
          <button
            onClick={() => {
              const selectableKeys = shown
                .filter((g) => !g.truncated)
                .map((g) => g.key);
              const allSelected = selectableKeys.every((key) =>
                selected.includes(key),
              );
              setSelected(
                allSelected
                  ? selected.filter((key) => !selectableKeys.includes(key))
                  : [...new Set([...selected, ...selectableKeys])],
              );
            }}
            className="h-10 rounded-md border border-violet-300 px-3 text-sm font-semibold text-violet-700"
          >
            {shown
              .filter((g) => !g.truncated)
              .every((g) => selected.includes(g.key))
              ? "현재 목록 전체 해제"
              : "현재 목록 전체 선택"}
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {shown.map((g) => (
            <article
              key={g.key}
              className={`grid min-w-0 overflow-hidden gap-4 rounded-xl border-2 p-4 md:grid-cols-[180px_minmax(0,1fr)] ${selected.includes(g.key) ? "border-violet-500 bg-violet-50" : g.thumbnailStatus === "READY" ? "border-emerald-300 bg-emerald-50/40" : g.thumbnailStatus === "FAILED" ? "border-red-300 bg-red-50/40" : "border-amber-200 bg-white"}`}
            >
              <button
                type="button"
                onClick={() => showPreview(g)}
                className="relative overflow-hidden rounded-lg border bg-white text-left shadow-sm"
              >
                <span
                  className={`absolute right-2 top-2 z-10 rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow ${g.thumbnailStatus === "READY" ? "bg-emerald-600" : g.thumbnailStatus === "FAILED" ? "bg-red-600" : "bg-amber-500"}`}
                >
                  {g.thumbnailStatus === "READY"
                    ? "✓ R2 완료"
                    : g.thumbnailStatus === "FAILED"
                      ? "! 실패"
                      : "● 생성 필요"}
                </span>
                <div className="px-2 py-2 text-center">
                  <b className="block truncate text-xs">{g.groupName}</b>
                  <span className="block truncate text-[10px] text-zinc-500">
                    {[g.albumName, g.versionName].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {g.thumbnailStatus === "READY" && g.thumbnailUrl ? (
                  <div className="aspect-square bg-zinc-100 p-1">
                    <img
                      src={g.thumbnailUrl}
                      alt={`${g.ebayTitle} R2 썸네일`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="grid aspect-square grid-cols-4 gap-0.5 bg-zinc-100 p-1">
                    {g.products
                      .slice(0, 16)
                      .map((p) =>
                        p.imageUrl ? (
                          <img
                            key={p.id}
                            src={p.imageUrl}
                            alt=""
                            className="h-full min-h-0 w-full object-cover"
                          />
                        ) : (
                          <span key={p.id} />
                        ),
                      )}
                  </div>
                )}
                <span
                  className={`block p-2 text-center text-[10px] font-semibold ${g.thumbnailStatus === "READY" ? "text-emerald-700" : "text-violet-700"}`}
                >
                  {previewing === g.key
                    ? "정확한 원본 생성 중…"
                    : g.thumbnailStatus === "READY"
                      ? "현재 R2 썸네일 · 눌러서 크게 보기"
                      : "눌러서 1000×1000 미리보기"}
                </span>
              </button>
              <div className="min-w-0 overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 lg:flex-nowrap">
                  <label className="flex min-w-0 flex-1 gap-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(g.key)}
                      onChange={() => toggle(g.key)}
                      disabled={g.truncated}
                      className="mt-1 h-5 w-5 accent-violet-600"
                    />
                    <span className="min-w-0">
                      <b className="break-words">{g.ebayTitle}</b>
                      <span className="mt-0.5 block text-[11px] font-medium text-zinc-500">
                        CSV에 들어가는 실제 eBay 상품명
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {[g.groupName, g.albumName, g.versionName]
                          .filter(Boolean)
                          .join(" · ")}{" "}
                        · {g.products.length}개 옵션
                      </span>
                      <span className="block text-xs font-semibold text-violet-700">
                        {g.ebayItemId
                          ? `등록됨 · 새 옵션 ${g.newOptionCount}개`
                          : `신규 등록 · 완료 옵션 ${g.products.length}개`}
                      </span>
                      <span
                        className={`block text-xs font-semibold ${g.thumbnailStatus === "READY" ? "text-emerald-700" : g.thumbnailStatus === "FAILED" ? "text-red-700" : "text-amber-700"}`}
                      >
                        {g.thumbnailStatus === "READY"
                          ? `R2 업로드 완료${g.thumbnailGeneratedAt ? ` · ${new Date(g.thumbnailGeneratedAt).toLocaleString("ko-KR")}` : ""}`
                          : g.thumbnailStatus === "FAILED"
                            ? `썸네일 실패 · ${g.thumbnailError ?? "다시 생성해 주세요."}`
                            : "썸네일 생성 필요"}
                      </span>
                      {g.invalidImageCount > 0 && (
                        <span className="block text-xs font-semibold text-red-700">
                          개별 카드 이미지 R2 저장 필요 {g.invalidImageCount}개 · 이 묶음의 썸네일 만들기를 다시 눌러 주세요
                        </span>
                      )}
                      {g.thumbnailStatus === "READY" && g.thumbnailUrl && (
                        <a
                          href={g.thumbnailUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="mt-1 block text-xs font-semibold text-blue-700 underline"
                        >
                          R2 원본 이미지 새 창에서 열기
                        </a>
                      )}
                      {g.activeSingleCount > 0 && (
                        <span className="block text-xs text-amber-700">
                          기존 활성 단품 {g.activeSingleCount}개
                        </span>
                      )}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((current) =>
                        current.includes(g.key) ? [] : [g.key],
                      )
                    }
                    disabled={g.truncated}
                    className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 ${selected.includes(g.key) ? "border-violet-600 bg-violet-600 text-white" : "border-violet-300 bg-white text-violet-700 hover:bg-violet-50"}`}
                  >
                    {g.truncated
                      ? "선택 불가"
                      : selected.includes(g.key)
                        ? "✓ 이 묶음 선택됨"
                        : "이 묶음만 선택"}
                  </button>
                </div>
                <p className="mt-3 text-[11px] font-medium text-zinc-500">
                  카드 사진 {g.products.length}장 · 좌우로 밀어서 전체 보기
                </p>
                <div className="mt-1 flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-3 [scrollbar-color:rgb(139_92_246)_rgb(228_228_231)] [scrollbar-width:thin]">
                  {g.products.map((p) => (
                    <div key={p.id} className="w-20 shrink-0">
                      <div className="aspect-[2/3] overflow-hidden rounded bg-zinc-100">
                        {p.imageUrl && (
                          <img
                            src={p.imageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <p className="truncate text-[11px]">{p.variationName}</p>
                      <p className="text-[10px] text-zinc-500">
                        ${p.priceUsd ?? "-"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="sticky bottom-4 space-y-3 rounded-xl border bg-white/95 p-4 shadow-lg backdrop-blur">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <label className="block text-sm font-bold text-blue-950">
            상세페이지 템플릿
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className="mt-2 block h-11 w-full rounded-md border border-blue-300 bg-white px-3 text-sm font-medium text-zinc-900"
            >
              <option value="">템플릿을 선택해 주세요</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.isDefault ? " · 기본" : ""}
                  {!template.descriptionTemplateHtml?.trim()
                    ? " · 상세 HTML 없음"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-blue-900">
            선택한 템플릿의 상세 HTML과 제목·SKU 치환값을 옵션상품 CSV에도
            그대로 적용합니다.
          </p>
          <p className="mt-1 text-xs text-blue-900">
            옵션상품의 {"{title}"} 줄에는 개별 카드명이 아니라 묶음 대표
            상품명이 들어갑니다. eBay 옵션상품은 모든 카드가 상세페이지 하나를
            공유합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <b>{selected.length}개 묶음 선택</b>
            <p className="text-xs text-zinc-500">
              R2 완료{" "}
              {
                selectedGroups.filter(
                  (group) => group.thumbnailStatus === "READY",
                ).length
              }{" "}
              · 실패{" "}
              {
                selectedGroups.filter(
                  (group) => group.thumbnailStatus === "FAILED",
                ).length
              }{" "}
              · 준비 필요{" "}
              {
                selectedGroups.filter(
                  (group) => group.thumbnailStatus === "MISSING",
                ).length
              }
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!selected.length || busy}
              onClick={prepareThumbnails}
              className="h-11 rounded border border-violet-300 px-4 text-sm font-semibold text-violet-700 disabled:text-zinc-300"
            >
              {busy && progress
                ? `${progress.completed}/${progress.total} R2 저장 중`
                : "선택 묶음 썸네일 만들기"}
            </button>
            <button
              disabled={!selected.length || busy}
              onClick={() =>
                download(
                  "/api/listing-upload/variation-groups/end-singles",
                  "ebay-end-replaced-singles",
                )
              }
              className="h-11 rounded border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:text-zinc-300"
            >
              기존 단품 종료 CSV
            </button>
            <button
              disabled={
                !selectedReady ||
                busy ||
                !data.latestCompleteReportAt ||
                !data.pricingReady ||
                !descriptionTemplateReady
              }
              onClick={downloadVariationCsv}
              className="h-11 rounded bg-violet-600 px-5 text-sm font-semibold text-white disabled:bg-zinc-300"
            >
              옵션 추가 + 단품 종료 CSV
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <label
            className="flex items-center gap-2 text-xs text-zinc-600"
            title="신규 묶음은 eBay가 등록을 거부하면 단품만 사라집니다. 그래서 기본은 꺼져 있습니다."
          >
            <input
              type="checkbox"
              checked={endNewGroups}
              onChange={(event) => setEndNewGroups(event.target.checked)}
            />
            신규 묶음의 단품도 같은 파일에서 종료(등록이 거부되면 단품만 사라짐)
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-violet-700">
            <span>eBay 처리 결과 파일 올리기</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void confirmUpload(file);
              }}
              className="text-xs font-normal text-zinc-600"
            />
          </label>
        </div>
        {confirmResult && (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <b>결과 반영 완료</b> · 묶음 {confirmResult.confirmedGroups}개(신규
            등록 {confirmResult.newParentListings}개) · 옵션 추가{" "}
            {confirmResult.addedOptions}장 · 단품 종료{" "}
            {confirmResult.endedSingles}장
            {confirmResult.endableGroupKeys.length > 0 && (
              <div className="mt-2">
                <p className="text-amber-800">
                  등록이 확인된 묶음 {confirmResult.endableGroupKeys.length}개에
                  아직 활성 단품이 남아 있습니다.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    downloadConfirmedEndCsv(confirmResult.endableGroupKeys)
                  }
                  className="mt-1 h-9 rounded border border-red-300 px-3 text-xs font-semibold text-red-700 disabled:text-zinc-300"
                >
                  남은 단품 종료 CSV 받기
                </button>
              </div>
            )}
            {confirmResult.pendingGroups.length > 0 && (
              <p className="mt-1 text-amber-800">
                결과 파일에서 찾지 못한 묶음{" "}
                {confirmResult.pendingGroups.length}개:{" "}
                {confirmResult.pendingGroups
                  .slice(0, 5)
                  .map((group) => group.title)
                  .join(", ")}
              </p>
            )}
            {confirmResult.failures.length > 0 && (
              <div className="mt-1 text-red-700">
                <b>eBay가 실패로 알려 준 행 {confirmResult.failures.length}건</b>
                <ul className="mt-1 list-disc pl-4">
                  {confirmResult.failures.slice(0, 5).map((failure, index) => (
                    <li key={index}>
                      {failure.sku ?? failure.itemId ?? "-"}:{" "}
                      {failure.message ?? "사유 없음"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {!descriptionTemplateReady && (
          <p className="rounded bg-red-50 p-2 text-xs font-semibold text-red-800">
            상세페이지 HTML이 저장된 템플릿을 선택해야 CSV를 받을 수 있습니다.
            템플릿이 없다면 먼저 신규등록 → 등록 템플릿에서 만들어 주세요.
          </p>
        )}
        {batchResult && (
          <div
            className={`rounded-lg border p-3 text-sm ${batchResult.failed ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}
          >
            <b className="block text-base">
              {batchResult.failed
                ? "썸네일 작업이 일부 완료되었습니다."
                : "썸네일 작업이 모두 완료되었습니다."}
            </b>
            <p className="mt-1">
              전체 {batchResult.total}개 · 성공 {batchResult.succeeded}개 · 새로
              R2 업로드 {batchResult.uploaded}개 · 기존 R2 이미지 재사용{" "}
              {batchResult.reused}개 · 실패 {batchResult.failed}개
            </p>
            <p className="mt-1 text-xs">
              완료 시각{" "}
              {new Date(batchResult.finishedAt).toLocaleString("ko-KR")} · 각
              묶음의 ‘R2 썸네일 열어보기’로 실제 파일을 확인할 수 있습니다.
            </p>
          </div>
        )}
        {!selectedReady && selected.length > 0 && !busy && (
          <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
            대표 썸네일과 모든 개별 카드 이미지를 R2에 저장해야 CSV를 받을 수 있습니다. ‘선택 묶음 썸네일 만들기’를 누르면 Base64 이미지도 R2로 옮깁니다.
          </p>
        )}
        {progress && (
          <div className="space-y-1">
            <div className="flex justify-between gap-3 text-xs text-zinc-600">
              <span className="truncate">
                {progress.completed < progress.total
                  ? `현재: ${progress.currentTitle}`
                  : "R2 저장 완료"}
              </span>
              <span className="shrink-0">
                {progress.completed}/{progress.total} · 경과{" "}
                {formatDuration(elapsedSeconds)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
              <div
                className="h-full bg-violet-600 transition-[width]"
                style={{
                  width: `${progress.total ? Math.max(3, (progress.completed / progress.total) * 100) : 0}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-zinc-500">
              각 묶음의 카드를 합성해 R2에 저장합니다. 완료된 묶음은 바로 초록색
              ‘R2 업로드 완료’로 바뀝니다.
            </p>
          </div>
        )}
        {error && (
          <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}
      </div>
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-4xl overflow-auto rounded-xl bg-white p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <b>{preview.title}</b>
                <p
                  className={`text-xs font-semibold ${preview.isR2 ? "text-emerald-700" : "text-zinc-500"}`}
                >
                  {preview.isR2
                    ? "✓ 실제 R2에 저장된 1000×1000 썸네일"
                    : "1000×1000 미리보기 · 아직 R2에 저장되지 않음"}
                </p>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="rounded bg-zinc-900 px-3 py-2 text-sm text-white"
              >
                닫기
              </button>
            </div>
            <img
              src={preview.url}
              alt={`${preview.title} 썸네일 미리보기`}
              className="h-auto w-[min(1000px,90vw)]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes
    ? `${minutes}분 ${String(rest).padStart(2, "0")}초`
    : `${rest}초`;
}
