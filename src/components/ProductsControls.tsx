"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bookmark,
  ChevronDown,
  Download,
  Image as ImageIcon,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Upload,
} from "lucide-react";
import { normalizeProductStatus, productStatusOptions } from "@/lib/product-status";
import { notifyProductDataChanged } from "@/lib/client-product-refresh";
import { ChannelAutomaticOperations } from "@/components/EbayAutomaticOperations";
import { ChannelRegistrationControls } from "@/components/ChannelRegistrationControls";
import { ChannelOperationCounts } from "@/components/ChannelOperationCounts";
import {
  parseProductSearchTerms,
  serializeProductSearchTerms,
} from "@/lib/product-search";

export type ProductFacetOptions = {
  groups: string[];
  members: string[];
  albums: string[];
  versions: string[];
};

const emptyFacets: ProductFacetOptions = {
  groups: [],
  members: [],
  albums: [],
  versions: [],
};

type SavedProductView = {
  id: string;
  name: string;
  query: string;
  createdAt: number;
};

const savedViewsStorageKey = "products-saved-filter-views";
const maxSavedViews = 12;

function statusFilterValue(value: string | null) {
  return value && value !== "all" ? normalizeProductStatus(value) : "all";
}

export function ProductsControls({
  initialFacets = emptyFacets,
}: {
  initialFacets?: ProductFacetOptions;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [facets, setFacets] = useState<ProductFacetOptions>(initialFacets);
  const [searchTerms, setSearchTerms] = useState(() =>
    parseProductSearchTerms(searchParams.get("q")),
  );
  const [searchDraft, setSearchDraft] = useState("");
  const [group, setGroup] = useState(searchParams.get("group") ?? "");
  const [member, setMember] = useState(searchParams.get("member") ?? "");
  const [album, setAlbum] = useState(searchParams.get("album") ?? "");
  const [version, setVersion] = useState(searchParams.get("version") ?? "");
  const [status, setStatus] = useState(statusFilterValue(searchParams.get("status")));
  const [stock, setStock] = useState(searchParams.get("stock") ?? "all");
  const [sort, setSort] = useState(searchParams.get("sort") ?? "pocamarket_latest");
  const [freshness, setFreshness] = useState(searchParams.get("freshness") ?? "all");
  const [upload, setUpload] = useState(searchParams.get("upload") ?? "all");
  const [operation, setOperation] = useState(
    searchParams.get("operation") ?? "all",
  );
  const statsChannel = searchParams.get("channel") === "SHOPIFY" ? "SHOPIFY" : "EBAY";
  const channelName = statsChannel === "SHOPIFY" ? "Shopify" : "eBay";
  const [liveRefresh, setLiveRefresh] = useState(true);
  const [message, setMessage] = useState("");
  const [savedViews, setSavedViews] = useState<SavedProductView[]>([]);
  const [viewName, setViewName] = useState("");
  const [viewMessage, setViewMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [normalizing, setNormalizing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const inventorySyncVersionRef = useRef<string | null>(null);
  const lastInventoryRefreshRef = useRef(0);
  const [templateColumnCount, setTemplateColumnCount] = useState<number | null>(null);
  const [templateUploading, setTemplateUploading] = useState(false);
  const paramsText = useMemo(() => searchParams.toString(), [searchParams]);
  const resetHref = useMemo(() => {
    const pageSize = searchParams.get("pageSize");
    const channel = searchParams.get("channel");
    const params = new URLSearchParams();
    if (pageSize) params.set("pageSize", pageSize);
    if (channel === "SHOPIFY") params.set("channel", channel);

    return productsHref(params);
  }, [searchParams]);
  const secondaryActionClass =
    "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50";

  useEffect(() => {
    const timer = window.setTimeout(() => setSavedViews(readSavedViews()), 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerms(parseProductSearchTerms(searchParams.get("q")));
      setSearchDraft("");
      setGroup(searchParams.get("group") ?? "");
      setMember(searchParams.get("member") ?? "");
      setAlbum(searchParams.get("album") ?? "");
      setVersion(searchParams.get("version") ?? "");
      setStatus(statusFilterValue(searchParams.get("status")));
      setStock(searchParams.get("stock") ?? "all");
      setSort(searchParams.get("sort") ?? "pocamarket_latest");
      setFreshness(searchParams.get("freshness") ?? "all");
      setUpload(searchParams.get("upload") ?? "all");
      setOperation(searchParams.get("operation") ?? "all");
    }, 0);

    return () => window.clearTimeout(timer);
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/export/ebay-template")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { template?: { columnCount: number } | null } | null) => {
        setTemplateColumnCount(data?.template?.columnCount ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/products/facets?group=${encodeURIComponent(group)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { facets?: ProductFacetOptions } | null) => {
        if (!controller.signal.aborted && data?.facets) {
          setFacets(data.facets);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFacets(emptyFacets);
        }
      });

    return () => {
      controller.abort();
    };
  }, [group]);

  useEffect(() => {
    if (!uploadStartedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - uploadStartedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [uploadStartedAt]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const controller = new AbortController();
    async function refreshWhenPocamarketChanges() {
      try {
        if (document.visibilityState === "hidden") return;
        const response = await fetch("/api/pocamarket-sync/progress", {
          cache: "no-store", signal: controller.signal,
        });
        if (!active || !response.ok) return;
        const body = (await response.json()) as {
          batch?: { status: string; updatedAt: string } | null;
        };
        const version = body.batch?.updatedAt ?? null;
        if (!version) return;
        if (!inventorySyncVersionRef.current || !liveRefresh) {
          inventorySyncVersionRef.current = version;
          return;
        }
        const completed = body.batch && !["QUEUED", "RUNNING"].includes(body.batch.status);
        if (version !== inventorySyncVersionRef.current &&
          (completed || Date.now() - lastInventoryRefreshRef.current >= 30_000)) {
          inventorySyncVersionRef.current = version;
          lastInventoryRefreshRef.current = Date.now();
          notifyProductDataChanged();
          router.refresh();
        }
      } catch {
        // Keep the current view on a transient network failure; the next poll retries.
      } finally {
        // Schedule only after completion: slow requests must not accumulate every 5 seconds.
        if (active) timer = window.setTimeout(() => void refreshWhenPocamarketChanges(), 10_000);
      }
    }
    void refreshWhenPocamarketChanges();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [router, liveRefresh]);

  function currentFilterParams(searchValue?: string) {
    const params = new URLSearchParams();

    const q = searchValue ?? serializeProductSearchTerms([...searchTerms, searchDraft]);

    for (const [key, value] of Object.entries({
      q,
      group,
      member,
      album,
      version,
      status,
      stock,
      sort,
      freshness,
      upload,
      operation,
    })) {
      const text = value.trim();

      if (text && text !== "all") {
        params.set(key, text);
      }
    }

    const pageSize = searchParams.get("pageSize");

    if (pageSize) {
      params.set("pageSize", pageSize);
    }
    if (statsChannel === "SHOPIFY") {
      params.set("channel", statsChannel);
    }

    return params;
  }

  function addSearchTerms(values: string[]) {
    const nextTerms = parseProductSearchTerms(
      [...searchTerms, ...values].join("\n"),
    );
    setSearchTerms(nextTerms);
    setSearchDraft("");
    return nextTerms;
  }

  function removeSearchTerm(index: number) {
    const nextTerms = searchTerms.filter((_, termIndex) => termIndex !== index);
    setSearchTerms(nextTerms);
    router.push(
      productsHref(currentFilterParams(serializeProductSearchTerms(nextTerms))),
    );
  }

  function addSearchTermsAndSearch(values: string[]) {
    const nextTerms = addSearchTerms(values);
    router.push(
      productsHref(currentFilterParams(serializeProductSearchTerms(nextTerms))),
    );
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(productsHref(currentFilterParams()));
  }

  function storeSavedViews(nextViews: SavedProductView[]) {
    setSavedViews(nextViews);

    try {
      window.localStorage.setItem(savedViewsStorageKey, JSON.stringify(nextViews));
      return true;
    } catch {
      setViewMessage("보기 저장에 실패했습니다.");
      return false;
    }
  }

  function saveCurrentView() {
    const name = viewName.trim();

    if (!name) {
      setViewMessage("보기 이름을 입력하세요.");
      return;
    }

    const query = currentFilterParams().toString();
    const view: SavedProductView = {
      id: createViewId(),
      name: name.slice(0, 40),
      query,
      createdAt: Date.now(),
    };
    const nextViews = [
      view,
      ...savedViews.filter(
        (savedView) => savedView.name !== view.name && savedView.query !== view.query,
      ),
    ].slice(0, maxSavedViews);

    if (storeSavedViews(nextViews)) {
      setViewName("");
      setViewMessage("보기를 저장했습니다.");
    }
  }

  function applySavedView(view: SavedProductView) {
    router.push(productsHref(new URLSearchParams(view.query)));
  }

  function deleteSavedView(id: string) {
    if (storeSavedViews(savedViews.filter((view) => view.id !== id))) {
      setViewMessage("보기를 삭제했습니다.");
    }
  }

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    setUploading(true);
    setUploadFileName(file.name);
    setUploadStartedAt(Date.now());
    setElapsedSeconds(0);
    setMessage("업로드 처리 중입니다. 완료되면 등록/수정 건수가 표시됩니다.");
    const form = new FormData();
    form.set("file", file);

    try {
      const response = await fetch("/api/import/products", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => null)) as
        | { created?: number; updated?: number; errors?: string[]; error?: string }
        | null;

      setMessage(
        response.ok
          ? `등록 ${data?.created ?? 0}건, 수정 ${data?.updated ?? 0}건${
              data?.errors?.length ? `, 오류 ${data.errors.length}건` : ""
            }`
          : data?.error ?? "업로드 실패",
      );
      if (response.ok) notifyProductDataChanged();
      router.refresh();
    } catch {
      setMessage("업로드 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setUploading(false);
      setUploadStartedAt(null);
      event.currentTarget.value = "";
    }
  }

  async function uploadEbayTemplate(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) return;

    setTemplateUploading(true);
    setMessage("eBay 템플릿 업로드 중...");
    const form = new FormData();
    form.set("file", file);

    try {
      const response = await fetch("/api/export/ebay-template", { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as
        | { columnCount?: number; error?: string }
        | null;

      if (response.ok && data?.columnCount != null) {
        setTemplateColumnCount(data.columnCount);
        setMessage(`eBay 템플릿 저장 완료 (${data.columnCount}개 컬럼)`);
      } else {
        setMessage(data?.error ?? "템플릿 업로드 실패");
      }
    } catch {
      setMessage("템플릿 업로드 요청에 실패했습니다.");
    } finally {
      setTemplateUploading(false);
      event.currentTarget.value = "";
    }
  }

  async function deleteEbayTemplate() {
    setMessage("eBay 템플릿 삭제 중...");

    try {
      const response = await fetch("/api/export/ebay-template", { method: "DELETE" });

      if (response.ok) {
        setTemplateColumnCount(null);
        setMessage("eBay 템플릿이 삭제되었습니다. 기본 형식으로 내보냅니다.");
      } else {
        setMessage("템플릿 삭제 실패");
      }
    } catch {
      setMessage("템플릿 삭제 요청에 실패했습니다.");
    }
  }

  async function normalizeStatus() {
    setNormalizing(true);
    setMessage("상태 정규화 중...");

    try {
      const response = await fetch("/api/admin/normalize-product-status", { method: "POST" });
      const data = (await response.json().catch(() => null)) as
        | { updated?: number; stockedSoldOut?: number; unlisted?: number; error?: string }
        | null;

      setMessage(
        response.ok
          ? `상태 정규화 완료: 미등록 전환 ${data?.unlisted ?? 0}건 (재고 있음 품절 ${data?.stockedSoldOut ?? 0}건)`
          : data?.error ?? "상태 정규화 실패",
      );
      if (response.ok) notifyProductDataChanged();
      router.refresh();
    } catch {
      setMessage("상태 정규화 요청에 실패했습니다.");
    } finally {
      setNormalizing(false);
    }
  }

  const advancedFilterCount = [
    group,
    member,
    album,
    version,
    status !== "all" ? status : "",
    stock !== "all" ? stock : "",
    sort !== "pocamarket_latest" ? sort : "",
    upload !== "all" ? upload : "",
    freshness !== "all" ? freshness : "",
  ].filter(Boolean).length;

  return (
    <section className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="order-last rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 sm:p-4">
          <form
            onSubmit={applyFilters}
            className="space-y-3"
          >
            <div className="grid gap-2 md:grid-cols-[minmax(260px,1fr)_210px_auto_auto]">
              <div>
                <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 focus-within:border-zinc-900">
                  <Search className="ml-1 h-4 w-4 shrink-0 text-zinc-400" />
                  {searchTerms.map((term, index) => (
                    <span key={`${term}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-sm font-medium text-blue-800">
                      <span className="max-w-48 truncate">{term}</span>
                      <button type="button" onClick={() => removeSearchTerm(index)} className="text-blue-500 hover:text-blue-900" aria-label={`${term} 검색어 삭제`}>×</button>
                    </span>
                  ))}
                  <input
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        if (searchDraft.trim()) addSearchTermsAndSearch([searchDraft]);
                      }
                    }}
                    onPaste={(event) => {
                      const pasted = event.clipboardData.getData("text");
                      if (/\r?\n/.test(pasted)) {
                        event.preventDefault();
                        addSearchTermsAndSearch([...parseProductSearchTerms(pasted), searchDraft]);
                      }
                    }}
                    placeholder={searchTerms.length ? "다음 상품 입력 후 Enter" : "SKU·VAR-대표번호·eBay 번호/주소·상품명"}
                    className="h-8 min-w-48 flex-1 border-0 bg-transparent px-1 text-sm outline-none"
                    aria-label="상품 다중 검색어"
                  />
                </div>
                <p className="mt-1 px-1 text-xs text-zinc-500">검색어를 Enter로 여러 개 추가하면, 그중 하나라도 일치하는 상품을 한 번에 찾습니다.</p>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-500">목록 조회 채널<select aria-label="목록 조회 채널" value={statsChannel} onChange={event => { const next = new URLSearchParams(searchParams.toString()); next.set("channel", event.currentTarget.value); next.delete("page"); router.push(`/products?${next}`); }} className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900"><option value="EBAY">eBay</option><option value="SHOPIFY">Shopify</option></select></label>
              <select name="operation" value={operation} onChange={(event) => setOperation(event.currentTarget.value)} className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-zinc-900" aria-label="업무 분류">
                <option value="all">모든 상품 보기</option><option value="listable">{channelName} 등록 준비 후보</option><option value="selling">{channelName} 판매 연결·공급 가능</option><option value="own_photo_listable">촬영 완료·{channelName} 등록 전</option><option value="procurement_listable">포카 조달·{channelName} 등록 준비 후보</option><option value="price_missing">판매가격 입력 필요</option><option value="unit_no_members">유닛 멤버 미지정</option><option value="image_pending">판매 이미지 작업 필요</option><option value="in_stock">내 재고·이미지 준비됨</option><option value="procurement_ready">포카에서 구매 가능</option><option value="stop_required">{channelName} 판매 중단 필요</option><option value="sold_out">판매할 재고 없음</option><option value="review">포카 정보 확인 필요</option>
              </select>
              <button type="submit" className="h-11 rounded-lg bg-zinc-950 px-6 text-sm font-semibold text-white hover:bg-zinc-800">상품 조회</button>
              <Link href={resetHref} className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-100">초기화</Link>
            </div>

            <details className="group rounded-lg border border-zinc-200 bg-white" open={advancedFilterCount > 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-800">
                <span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />상세 필터와 저장된 보기{advancedFilterCount ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{advancedFilterCount}개 적용</span> : null}</span>
                <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
              </summary>
              <div className="space-y-3 border-t border-zinc-200 p-4">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  <FilterInput name="group" label="그룹" value={group} onChange={setGroup} options={facets.groups} />
                  <FilterInput name="member" label="멤버" value={member} onChange={setMember} options={facets.members} />
                  <FilterInput name="album" label="앨범" value={album} onChange={setAlbum} options={facets.albums} />
                  <FilterInput name="version" label="버전/특전처" value={version} onChange={setVersion} options={facets.versions} />
                  <select name="status" value={status} onChange={(event) => setStatus(event.currentTarget.value)} className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"><option value="all">전체 상태</option>{productStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                  <select name="stock" value={stock} onChange={(event) => setStock(event.currentTarget.value)} className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"><option value="all">전체 재고</option><option value="in_stock">재고보유</option><option value="sold_out">내 재고 없음</option></select>
                  <select name="upload" value={upload} onChange={(event) => setUpload(event.currentTarget.value)} className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"><option value="all">전체 eBay 연결</option><option value="uploaded">eBay 연결됨</option><option value="not_uploaded">eBay 미연결</option><option value="review_required">eBay 연결 검토 필요</option></select>
                  <select name="freshness" value={freshness} onChange={(event) => setFreshness(event.currentTarget.value)} className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"><option value="all">전체 최신화</option><option value="older_24h">24시간 이상</option><option value="older_7d">7일 이상</option><option value="never">미최신화</option></select>
                  <select name="sort" value={sort} onChange={(event) => setSort(event.currentTarget.value)} className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"><option value="pocamarket_latest">최신화 최신순</option><option value="pocamarket_oldest">최신화 오래된순</option><option value="sku">상품번호순</option></select>
                  <button type="button" onClick={() => setLiveRefresh((value) => !value)} className={`h-10 rounded-md border px-3 text-sm font-semibold ${liveRefresh ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-300 bg-zinc-100 text-zinc-600"}`}>실시간 정렬 {liveRefresh ? "켜짐" : "꺼짐"}</button>
                </div>
                <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-zinc-500">저장된 보기</span>{savedViews.length ? savedViews.map((view) => <span key={view.id} className="inline-flex overflow-hidden rounded-md border border-zinc-300 text-sm"><button type="button" onClick={() => applySavedView(view)} className="max-w-[180px] truncate px-3 py-1.5 hover:bg-zinc-50">{view.name}</button><button type="button" onClick={() => deleteSavedView(view.id)} className="border-l border-zinc-200 px-2 text-zinc-400 hover:text-rose-600" aria-label={`${view.name} 보기 삭제`}><Trash2 className="h-3.5 w-3.5" /></button></span>) : <span className="text-xs text-zinc-400">저장된 보기 없음</span>}</div>
                  <div className="flex gap-2"><input value={viewName} onChange={(event) => { setViewName(event.currentTarget.value); setViewMessage(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveCurrentView(); } }} maxLength={40} placeholder="보기 이름" className="h-9 min-w-0 rounded-md border border-zinc-300 px-3 text-sm" /><button type="button" onClick={saveCurrentView} className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-zinc-300 px-3 text-sm font-semibold"><Bookmark className="h-4 w-4" />저장</button></div>
                </div>
                {viewMessage ? <p className="text-sm text-zinc-600">{viewMessage}</p> : null}
              </div>
            </details>
          </form>
        </div>

        <div className="space-y-4">
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
            <div><h2 className="text-sm font-bold text-zinc-900">재고 작업</h2><p className="mt-1 text-xs text-zinc-500">상품과 촬영본 준비</p></div>
            <div className="flex flex-wrap gap-2">
            <Link
              href="/products/new"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              <Plus className="h-4 w-4" />
              내부 상품 추가
            </Link>
            <Link
              href="/inventory/photo-card-match"
              className={secondaryActionClass}
            >
              <ImageIcon className="h-4 w-4" />
              촬영본 연결
            </Link>
            <a href="http://127.0.0.1:43127" target="_blank" rel="noreferrer" className={secondaryActionClass} title="바탕화면 연결 도우미를 먼저 실행해 주세요"><Smartphone className="h-4 w-4" />휴대폰 연결</a>
            </div>
          </section>
          <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-bold text-zinc-900">판매채널 자동 반영</h2><p className="mt-1 text-sm text-zinc-500">대상 수를 확인한 뒤 기존 상품을 변경하거나 새 상품을 등록하세요.</p></div>
              <div className="flex flex-wrap gap-2">
                <Link href="/products/watermark-settings" prefetch={false} className={secondaryActionClass}><Settings className="h-4 w-4" />이미지·워터마크 설정</Link>
                <a href="/api/export/ebay-operations?type=revise" className={secondaryActionClass} title="변경 전·후 가격과 수량을 확인하는 파일입니다"><Download className="h-4 w-4" />가격·수량 검토 파일</a>
              </div>
            </div>
            <ChannelOperationCounts />
            <ChannelAutomaticOperations />
            <ChannelRegistrationControls />
          </section>
        </div>

        <details className="group rounded-xl border border-zinc-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-700"><span className="inline-flex items-center gap-2"><Settings className="h-4 w-4" />파일 가져오기·내보내기 및 템플릿</span><ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></summary>
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 p-4">
            <Link href="/listing-upload/templates" className={secondaryActionClass}><Settings className="h-4 w-4" />Excel 템플릿</Link>
            <label className={`${secondaryActionClass} cursor-pointer`}><Upload className="h-4 w-4" />{uploading ? "처리 중..." : "엑셀/CSV 업로드"}<input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={importCsv} disabled={uploading} className="sr-only" /></label>
            <a href={`/api/export/products${paramsText ? `?${paramsText}` : ""}`} className={secondaryActionClass}><Download className="h-4 w-4" />상품 CSV</a>
            <a href="/api/export/pocamarket-daily-changes" className={secondaryActionClass}><Download className="h-4 w-4" />포카 일일 변경 Excel</a>
            <span className="basis-full border-t border-zinc-100" />
            <span className="text-xs font-semibold text-zinc-500">eBay 작업 파일</span>
            <a href="/api/export/ebay-operations?type=revise&format=csv" className={secondaryActionClass} title="Seller Hub Reports에 올리는 가격·수량 변경 CSV"><Download className="h-4 w-4" />가격·수량 업로드 CSV</a>
            <a href="/api/export/ebay-operations?type=revise&format=csv&limit=3" className={secondaryActionClass} title="형식 확인용으로 대상 3개만 생성"><Download className="h-4 w-4" />시험용 CSV 3개</a>
            <a href="/api/export/ebay-operations?type=end" className={secondaryActionClass}><Download className="h-4 w-4" />판매중단 검토 파일</a>
            <span className="mx-1 h-6 w-px bg-zinc-200" />
            <span className="text-xs font-semibold text-zinc-500">eBay 템플릿 {templateColumnCount != null ? `${templateColumnCount}개 컬럼 저장됨` : "없음"}</span>
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-300 px-3 text-xs font-medium"><Upload className="h-3.5 w-3.5" />{templateUploading ? "업로드 중..." : templateColumnCount != null ? "교체" : "업로드"}<input type="file" accept=".csv,.xlsx,.xls" onChange={uploadEbayTemplate} disabled={templateUploading} className="sr-only" /></label>
            {templateColumnCount != null ? <button type="button" onClick={() => void deleteEbayTemplate()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-300 px-3 text-xs font-medium text-rose-600"><Trash2 className="h-3.5 w-3.5" />삭제</button> : null}
          </div>
        </details>
        {uploading ? (
          <p className="text-sm text-zinc-600">
            {uploadFileName ? `${uploadFileName} ` : ""}
            업로드 처리 중... {elapsedSeconds}초 경과
          </p>
        ) : message ? (
          <p className="text-sm text-zinc-600">{message}</p>
        ) : null}
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2">
          <p className="flex-1 text-sm text-amber-900">
            재고가 있는데 품절/비활성 상태인 상품이 있으면 아래 버튼으로 일괄 수정하세요.
          </p>
          <button
            type="button"
            onClick={() => void normalizeStatus()}
            disabled={normalizing}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {normalizing ? "정리 중..." : "상태 자동정리"}
          </button>
        </div>
      </div>
    </section>
  );
}

function FilterInput({
  name,
  label,
  value,
  onChange,
  options,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = useMemo(() => {
    const keyword = value.trim().toLowerCase();
    if (!keyword) return options.slice(0, 100);
    const includes = options.filter((opt) => opt.toLowerCase().includes(keyword));
    const startsWith = includes.filter((opt) => opt.toLowerCase().startsWith(keyword));
    const others = includes.filter((opt) => !opt.toLowerCase().startsWith(keyword));
    return [...startsWith, ...others].slice(0, 100);
  }, [options, value]);

  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }

  function handleOptionClick(option: string) {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChange(option);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        name={name}
        value={value}
        autoComplete="off"
        onChange={(event) => { onChange(event.currentTarget.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        placeholder={label}
        className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
      />
      {open && filtered.length > 0 ? (
        <ul className="absolute left-0 right-0 z-50 mt-1 max-h-96 min-w-[240px] overflow-y-auto rounded-md border border-zinc-300 bg-white shadow-xl">
          {filtered.map((option) => (
            <li key={option}>
              <button
                type="button"
                className="block w-full truncate px-3 py-2.5 text-left text-sm text-zinc-900 hover:bg-zinc-100"
                title={option}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleOptionClick(option);
                }}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function productsHref(params: URLSearchParams) {
  const query = params.toString();

  return query ? `/products?${query}` : "/products";
}

function createViewId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readSavedViews(): SavedProductView[] {
  try {
    const raw = window.localStorage.getItem(savedViewsStorageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is SavedProductView => {
        if (!entry || typeof entry !== "object") {
          return false;
        }

        const view = entry as Partial<SavedProductView>;

        return (
          typeof view.id === "string" &&
          typeof view.name === "string" &&
          typeof view.query === "string" &&
          typeof view.createdAt === "number"
        );
      })
      .slice(0, maxSavedViews);
  } catch {
    return [];
  }
}

