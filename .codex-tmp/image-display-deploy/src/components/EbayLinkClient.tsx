"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Image as ImageIcon,
  ImageOff,
  Link2,
  PackagePlus,
  Search,
} from "lucide-react";

type LinkCandidate = {
  productId: string;
  sku: string;
  productName: string;
  brand: string | null;
  optionName: string | null;
  category: string | null;
  imageUrl: string | null;
  score: number;
  alreadyLinkedItemId: string | null;
  memberMismatch?: boolean;
};

type UnlinkedListing = {
  listingId: string;
  itemId: string;
  title: string | null;
  imageUrl: string | null;
  sku: string | null;
  priceUsd: string | null;
  quantity: number | null;
  matchStatus: string;
  itemWebUrl: string;
  candidates: LinkCandidate[];
};

type CandidateFilters = { group: string; member: string; album: string };
type CandidateFacets = { groups: string[]; members: string[]; albums: string[] };
const emptyFilters: CandidateFilters = { group: "", member: "", album: "" };

const statusLabels: Record<string, string> = {
  MANUALLY_VERIFIED: "이미지 확인 완료",
  UNMATCHED: "짝을 찾지 못함",
  TITLE_MATCHED: "제목으로 추정됨 · 확인 필요",
  DUPLICATE: "같은 SKU가 여러 건",
  CONFLICT: "기존 상품번호와 충돌",
};

// 점수가 높을수록 같은 카드일 가능성이 크다. 사람이 판단할 때 쓰는 눈금이다.
function scoreLabel(score: number) {
  if (score >= 0.82) return { text: "매우 비슷", className: "bg-emerald-100 text-emerald-800" };
  if (score >= 0.6) return { text: "비슷", className: "bg-amber-100 text-amber-800" };
  return { text: "약간 비슷", className: "bg-zinc-100 text-zinc-600" };
}

function candidateSubtitle(candidate: LinkCandidate) {
  return (
    [candidate.brand, candidate.optionName, candidate.category].filter(Boolean).join(" · ") ||
    "-"
  );
}

export function EbayLinkClient({
  initial,
  totalPending,
  reportImportedAt,
}: {
  initial: UnlinkedListing[];
  totalPending: number;
  reportImportedAt: string | null;
}) {
  const router = useRouter();
  const [listings, setListings] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  // 실패 사유는 해당 줄에도 같이 띄운다. 목록이 길면 화면 맨 위 알림이 보이지
  // 않아 아무 일도 일어나지 않은 것처럼 보인다.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [newSkus, setNewSkus] = useState<Record<string, string>>({});
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<string, LinkCandidate[]>>({});
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [batchSearching, setBatchSearching] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [candidateFilters, setCandidateFilters] = useState<Record<string, CandidateFilters>>({});
  const [baseFacets, setBaseFacets] = useState<CandidateFacets>({ groups: [], members: [], albums: [] });
  const [listingFacets, setListingFacets] = useState<Record<string, CandidateFacets>>({});
  const [images, setImages] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initial
        .filter((listing) => listing.imageUrl)
        .map((listing) => [listing.listingId, listing.imageUrl as string]),
    ),
  );
  const [loadingImages, setLoadingImages] = useState(false);
  const [comparison, setComparison] = useState<{ listing: UnlinkedListing; candidate: LinkCandidate } | null>(null);
  // 같은 목록에 대해 이미지 요청을 한 번만 보내기 위한 표시.
  const imagesRequested = useRef(false);

  // 화면에 뜬 리스팅의 eBay 사진을 받아온다. 저장된 것은 그대로 쓰고, 없는 것만
  // eBay에 물어본 뒤 저장하므로 다음부터는 호출이 없다.
  const loadImages = useCallback(async (rows: UnlinkedListing[]) => {
    const missing = rows
      .filter((row) => !row.imageUrl || !row.title)
      .map((row) => row.listingId);
    if (!missing.length) return;

    setLoadingImages(true);
    try {
      const response = await fetch("/api/ebay/active-report/listing-images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingIds: missing }),
      });
      const body = (await response.json().catch(() => null)) as
        | { images?: Record<string, string>; titles?: Record<string, string> }
        | null;
      if (response.ok && body?.images) {
        setImages((prev) => ({ ...prev, ...body.images }));
        if (body.titles) {
          setListings((prev) => prev.map((listing) => ({
            ...listing,
            title: body.titles?.[listing.listingId] ?? listing.title,
          })));
        }
      }
    } catch {
      // 사진은 보조 정보다. 실패해도 목록과 연결 기능은 그대로 쓴다.
    } finally {
      setLoadingImages(false);
    }
  }, []);

  useEffect(() => {
    if (imagesRequested.current) return;
    imagesRequested.current = true;
    void loadImages(initial);
  }, [initial, loadImages]);

  const loadCandidateFacets = useCallback(async (
    listingId: string | null,
    filters: CandidateFilters,
  ) => {
    const response = await fetch("/api/ebay/active-report/product-facets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ group: filters.group || null, member: filters.member || null }),
    });
    const body = (await response.json().catch(() => null)) as CandidateFacets | null;
    if (!response.ok || !body) return;
    if (listingId) setListingFacets((prev) => ({ ...prev, [listingId]: body }));
    else setBaseFacets(body);
  }, []);

  useEffect(() => {
    void loadCandidateFacets(null, emptyFilters);
  }, [loadCandidateFacets]);

  function updateCandidateFilter(
    listingId: string,
    key: keyof CandidateFilters,
    value: string,
  ) {
    const current = candidateFilters[listingId] ?? emptyFilters;
    const next = key === "group"
      ? { group: value, member: "", album: "" }
      : key === "member"
        ? { ...current, member: value, album: "" }
        : { ...current, album: value };
    setCandidateFilters((prev) => ({ ...prev, [listingId]: next }));
    setSearchResults((prev) => {
      const copy = { ...prev };
      delete copy[listingId];
      return copy;
    });
    void loadCandidateFacets(listingId, next);
  }

  async function link(
    listing: UnlinkedListing,
    candidate: LinkCandidate,
    mode: "new" | "replace" | "alongside" = "new",
  ) {
    setBusyId(listing.listingId);
    setMessage("");
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[listing.listingId];
      return next;
    });
    try {
      const response = await fetch("/api/ebay/active-report/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: candidate.productId,
          itemId: listing.itemId,
          replaceExisting: mode === "replace",
          allowMultiple: mode === "alongside",
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string; replacedItemId?: string | null; addedAlongside?: boolean }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "연결하지 못했습니다.");
      }

      setListings((prev) => prev.filter((row) => row.listingId !== listing.listingId));
      setMessage(
        `${candidate.sku} ↔ 상품번호 ${listing.itemId} 연결 완료.` +
          (body?.replacedItemId
            ? ` 예전 연결(${body.replacedItemId})은 풀렸고 그 리스팅은 대기 목록으로 돌아갑니다.`
            : body?.addedAlongside
              ? " 기존 연결은 그대로 두고 함께 묶었습니다. 이 상품에 리스팅이 둘이니 재고에 주의하세요."
              : " 판매중으로 바뀝니다."),
      );
      router.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "연결하지 못했습니다.";
      setMessage(text);
      setRowErrors((prev) => ({ ...prev, [listing.listingId]: text }));
    } finally {
      setBusyId(null);
    }
  }

  // 프로그램에 아예 없는 카드일 때. 리스팅 정보로 상품을 만들고 곧바로 연결한다.
  async function createProduct(listing: UnlinkedListing) {
    const sku = (newSkus[listing.listingId] ?? "").trim();
    if (!sku) {
      setRowErrors((prev) => ({ ...prev, [listing.listingId]: "새 SKU를 입력해 주세요." }));
      return;
    }

    setBusyId(listing.listingId);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[listing.listingId];
      return next;
    });
    try {
      const response = await fetch("/api/ebay/active-report/create-product", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId: listing.listingId, sku }),
      });
      const body = (await response.json().catch(() => null)) as
        | { sku?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "상품을 만들지 못했습니다.");
      }

      setListings((prev) => prev.filter((row) => row.listingId !== listing.listingId));
      setMessage(
        `${body?.sku ?? sku} 상품을 만들어 상품번호 ${listing.itemId}와 연결했습니다. 그룹·멤버·앨범은 상품 목록에서 채워 주세요.`,
      );
      router.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "상품을 만들지 못했습니다.";
      setRowErrors((prev) => ({ ...prev, [listing.listingId]: text }));
    } finally {
      setBusyId(null);
    }
  }

  // 추천 후보가 없거나 다 틀렸을 때 SKU·상품명으로 직접 찾는다.
  async function search(listing: UnlinkedListing) {
    const term = searchTerms[listing.listingId]?.trim();
    if (!term) {
      setMessage("찾을 SKU나 상품명을 입력해 주세요.");
      return;
    }

    setSearchingId(listing.listingId);
    setMessage("");
    try {
      const response = await fetch("/api/ebay/active-report/search-products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: term }),
      });
      const body = (await response.json().catch(() => null)) as
        | { products?: LinkCandidate[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "상품을 찾지 못했습니다.");
      }

      const found = body?.products ?? [];
      setSearchResults((prev) => ({ ...prev, [listing.listingId]: found }));
      if (!found.length) {
        setRowErrors((prev) => ({
          ...prev,
          [listing.listingId]: `"${term}"으로 찾은 상품이 없습니다.`,
        }));
      }
    } catch (error) {
      setRowErrors((prev) => ({
        ...prev,
        [listing.listingId]:
          error instanceof Error ? error.message : "상품을 찾지 못했습니다.",
      }));
    } finally {
      setSearchingId(null);
    }
  }

  // 사진으로 찾기. 제목 표기가 달라 글자로 못 찾는 카드를 잡아낸다.
  async function searchByImage(listing: UnlinkedListing) {
    setSearchingId(listing.listingId);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[listing.listingId];
      return next;
    });
    try {
      const response = await fetch("/api/ebay/active-report/image-candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId: listing.listingId,
          ...(candidateFilters[listing.listingId] ?? emptyFilters),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | {
            candidates?: LinkCandidate[];
            listingImageUrl?: string;
            memberFilter?: string | null;
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "사진으로 찾지 못했습니다.");
      }

      if (body?.listingImageUrl) {
        setImages((prev) => ({ ...prev, [listing.listingId]: body.listingImageUrl! }));
      }
      const found = body?.candidates ?? [];
      setSearchResults((prev) => ({ ...prev, [listing.listingId]: found }));
      if (found.length && body?.memberFilter) {
        setMessage(
          `${body.memberFilter} 카드로 좁혀서 찾았습니다. 앨범·특전처는 상품명을 보고 골라 주세요.`,
        );
      }
      if (!found.length) {
        setRowErrors((prev) => ({
          ...prev,
          [listing.listingId]: "사진이 비슷한 상품을 찾지 못했습니다.",
        }));
      }
    } catch (error) {
      setRowErrors((prev) => ({
        ...prev,
        [listing.listingId]:
          error instanceof Error ? error.message : "사진으로 찾지 못했습니다.",
      }));
    } finally {
      setSearchingId(null);
    }
  }

  async function searchAllVisibleByImage() {
    setBatchSearching(true);
    setBatchProgress(0);
    setMessage(`현재 화면 ${listings.length}건의 사진 후보를 차례로 찾습니다.`);
    try {
      for (let index = 0; index < listings.length; index += 1) {
        await searchByImage(listings[index]!);
        setBatchProgress(index + 1);
      }
      setMessage(
        `현재 화면 ${listings.length}건의 사진 후보 검색이 끝났습니다. 큰 사진끼리 확인한 뒤 같은 카드만 연결하세요.`,
      );
    } finally {
      setBatchSearching(false);
    }
  }

  if (!listings.length) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">
        {reportImportedAt
          ? "연결이 필요한 eBay 리스팅이 없습니다. 모두 연결됐습니다."
          : "활성상품 보고서를 아직 가져오지 않았습니다. 상품 목록 위에서 먼저 보고서를 가져와 주세요."}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white/95 px-3 py-2 text-sm text-zinc-600 shadow-sm backdrop-blur">
        <span>
          연결 대기 {totalPending.toLocaleString()}건
          {totalPending > listings.length
            ? ` · 이 화면에 ${listings.length.toLocaleString()}건 표시`
            : ""}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {reportImportedAt ? (
            <span className="text-xs text-zinc-400">
              보고서 기준 {new Date(reportImportedAt).toLocaleString("ko-KR")}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void searchAllVisibleByImage()}
            disabled={batchSearching || searchingId !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 disabled:bg-zinc-300"
          >
            <ImageIcon className="h-4 w-4" />
            {batchSearching
              ? `사진 후보 찾는 중 ${batchProgress}/${listings.length}`
              : `현재 ${listings.length}건 사진 후보 자동 찾기`}
          </button>
        </div>
      </div>

      {message ? (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-800">
          {message}
        </p>
      ) : null}

      {listings.map((listing) => {
        const busy = busyId === listing.listingId;
        const manual = searchResults[listing.listingId];
        const filters = candidateFilters[listing.listingId] ?? emptyFilters;
        const facets = listingFacets[listing.listingId] ?? baseFacets;
        // 필터를 바꾼 뒤에는 검색 전 제목 추천을 다시 보여주지 않는다. 이전 멤버
        // 후보를 새 필터 결과로 오해해 연결하는 사고를 막는다.
        const hasCandidateFilter = Boolean(filters.group || filters.member || filters.album);
        const visibleCandidates = manual ?? (hasCandidateFilter ? [] : listing.candidates);
        return (
          <article
            key={listing.listingId}
            className="rounded-xl border border-zinc-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 gap-4">
                {images[listing.listingId] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={images[listing.listingId]}
                    alt=""
                    loading="lazy"
                    className="h-40 w-28 shrink-0 rounded-md border border-zinc-200 bg-zinc-100 object-contain sm:h-48 sm:w-36"
                  />
                ) : (
                  <div className="flex h-40 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-zinc-300 text-zinc-400 sm:h-48 sm:w-36">
                    <ImageOff className="h-5 w-5" />
                    <span className="text-[10px]">
                      {loadingImages ? "불러오는 중" : "사진 없음"}
                    </span>
                  </div>
                )}
                <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900">
                  {listing.title || "(제목 없음)"}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  상품번호 {listing.itemId}
                  {listing.sku ? ` · eBay SKU ${listing.sku}` : ""}
                  {listing.priceUsd ? ` · $${listing.priceUsd}` : ""}
                  {listing.quantity !== null ? ` · 수량 ${listing.quantity}` : ""}
                </p>
                <p className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                  {statusLabels[listing.matchStatus] ?? listing.matchStatus}
                </p>
                </div>
              </div>
              <a
                href={listing.itemWebUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 underline hover:text-zinc-800"
              >
                eBay에서 보기
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="mt-3 border-t border-zinc-100 pt-3">
              {rowErrors[listing.listingId] ? (
                <p className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {rowErrors[listing.listingId]}
                </p>
              ) : null}
              <div className="mb-3 grid gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 sm:grid-cols-3">
                <CandidateAutocomplete
                  id={`ebay-link-group-${listing.listingId}`}
                  label="그룹"
                  value={filters.group}
                  options={facets.groups}
                  onChange={(value) => updateCandidateFilter(listing.listingId, "group", value)}
                />
                <CandidateAutocomplete
                  id={`ebay-link-member-${listing.listingId}`}
                  label="멤버"
                  value={filters.member}
                  options={facets.members}
                  cacheKey={filters.group}
                  onChange={(value) => updateCandidateFilter(listing.listingId, "member", value)}
                />
                <CandidateAutocomplete
                  id={`ebay-link-album-${listing.listingId}`}
                  label="앨범·특전"
                  value={filters.album}
                  options={facets.albums}
                  cacheKey={`${filters.group}\u0000${filters.member}`}
                  onChange={(value) => updateCandidateFilter(listing.listingId, "album", value)}
                />
                <p className="sm:col-span-3 text-[11px] text-violet-800">
                  그룹·멤버·앨범을 고르고 아래 검색 버튼을 누르면 선택 범위 밖의 상품은 후보에 나오지 않습니다.
                </p>
                <button
                  type="button"
                  onClick={() => void searchByImage(listing)}
                  disabled={searchingId === listing.listingId}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-zinc-300 sm:col-span-3"
                >
                  <Search className="h-4 w-4" />
                  {searchingId === listing.listingId
                    ? "선택 조건으로 검색 중..."
                    : "선택 조건으로 후보 검색"}
                </button>
              </div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-zinc-500">이 리스팅과 짝지을 상품을 고르세요</p>
              </div>
              {visibleCandidates.length === 0 ? (
                <p className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                  제목만으로는 확실한 후보를 찾지 못했습니다.{" "}
                  위에서 조건을 고른 뒤 <strong>선택 조건으로 후보 검색</strong>을 눌러 주세요.
                </p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {visibleCandidates.map((candidate) => {
                    const badge = scoreLabel(candidate.score);
                    const blocked =
                      candidate.alreadyLinkedItemId !== null &&
                      candidate.alreadyLinkedItemId !== listing.itemId;
                    return (
                      <li key={candidate.productId}>
                        <div className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
                          <button type="button" onClick={() => setComparison({ listing, candidate })} title="두 사진 크게 비교" className="w-full shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={candidate.imageUrl ?? ""}
                              alt=""
                              loading="lazy"
                              className="h-44 w-full shrink-0 rounded border border-zinc-200 bg-zinc-100 object-contain"
                            />
                          </button>
                          <div className="mt-2 min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-zinc-900">
                              {candidate.sku}
                            </p>
                            {/* 같은 멤버 카드가 여럿일 때 앨범·특전처는 상품명에만
                                들어 있으므로, 이게 있어야 버전을 고를 수 있다. */}
                            <p className="text-xs text-zinc-700">
                              {candidate.productName}
                            </p>
                            <p className="truncate text-xs text-zinc-500">
                              {candidateSubtitle(candidate)}
                            </p>
                            {candidate.score > 0 ? (
                              <span
                                className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
                              >
                                {badge.text}
                              </span>
                            ) : null}
                            <button type="button" onClick={() => setComparison({ listing, candidate })} className="ml-2 text-[11px] font-semibold text-violet-700 underline">
                              크게 비교
                            </button>
                            {candidate.memberMismatch ? (
                              <p className="mt-0.5 text-[11px] font-medium text-rose-700">
                                멤버가 제목에 없음 · 다른 멤버 카드일 수 있음
                              </p>
                            ) : null}
                            {blocked ? (
                              <p className="mt-0.5 text-[11px] text-amber-700">
                                이미 상품번호 {candidate.alreadyLinkedItemId} 연결됨 ·
                                같은 카드를 두 건 올렸으면 &quot;함께&quot;, 예전 게
                                잘못됐으면 &quot;바꿔서&quot;
                              </p>
                            ) : null}
                          </div>
                          {blocked ? (
                            <div className="mt-2 flex shrink-0 gap-1">
                              <button
                                type="button"
                                onClick={() => void link(listing, candidate, "alongside")}
                                disabled={busy}
                                title="기존 연결을 그대로 두고 이 리스팅도 같은 상품에 묶습니다"
                                className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
                              >
                                <Link2 className="h-3.5 w-3.5" />
                                {busy ? "처리 중..." : "함께 연결"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void link(listing, candidate, "replace")}
                                disabled={busy}
                                title={`예전 연결(${candidate.alreadyLinkedItemId})을 풀고 이 리스팅으로 바꿉니다`}
                                className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-amber-500 px-2.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
                              >
                                바꿔서 연결
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void link(listing, candidate)}
                              disabled={busy}
                              className="mt-2 inline-flex h-9 w-full shrink-0 items-center justify-center gap-1 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              {busy ? "처리 중..." : "연결"}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5">
                <input
                  value={searchTerms[listing.listingId] ?? ""}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setSearchTerms((prev) => ({ ...prev, [listing.listingId]: value }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void search(listing);
                  }}
                  placeholder="SKU · 상품명 · 멤버(유닛 포함)로 찾기"
                  className="h-9 flex-1 rounded-md border border-zinc-300 px-2 text-sm text-zinc-900"
                />
                <button
                  type="button"
                  onClick={() => void search(listing)}
                  disabled={searchingId === listing.listingId}
                  className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
                >
                  <Search className="h-3.5 w-3.5" />
                  {searchingId === listing.listingId ? "찾는 중..." : "찾기"}
                </button>
              </div>

              <div className="mt-3 rounded-md border border-dashed border-zinc-300 p-2.5">
                <p className="mb-1.5 text-xs text-zinc-500">
                  프로그램에 이 카드가 아예 없나요? 리스팅 정보(제목·사진·가격·수량)로
                  상품을 만들어 바로 연결합니다. 그룹·멤버·앨범은 만든 뒤 채우시면 됩니다.
                </p>
                <div className="flex gap-1.5">
                  <input
                    value={newSkus[listing.listingId] ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setNewSkus((prev) => ({ ...prev, [listing.listingId]: value }));
                    }}
                    placeholder="새 상품에 쓸 SKU"
                    className="h-9 flex-1 rounded-md border border-zinc-300 px-2 text-sm text-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => void createProduct(listing)}
                    disabled={busy || !(newSkus[listing.listingId] ?? "").trim()}
                    className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md bg-zinc-900 px-3 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
                  >
                    <PackagePlus className="h-3.5 w-3.5" />
                    {busy ? "처리 중..." : "상품 만들어 연결"}
                  </button>
                </div>
              </div>
            </div>
          </article>
        );
      })}
      {comparison ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="eBay 상품 사진 비교">
          <div className="max-h-[95vh] w-full max-w-5xl overflow-auto rounded-xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">같은 카드인지 크게 비교</h2>
                <p className="text-sm text-zinc-600">eBay {comparison.listing.itemId} ↔ SKU {comparison.candidate.sku}</p>
              </div>
              <button type="button" onClick={() => setComparison(null)} className="rounded border px-3 py-1.5 text-sm">닫기</button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <figure>
                <figcaption className="mb-2 text-center text-sm font-semibold">eBay 등록 사진</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={images[comparison.listing.listingId] ?? comparison.listing.imageUrl ?? ""} alt="eBay 등록 사진" className="mx-auto max-h-[65vh] w-full rounded-lg border bg-zinc-100 object-contain" />
              </figure>
              <figure>
                <figcaption className="mb-2 text-center text-sm font-semibold">프로그램 상품 사진 · {comparison.candidate.sku}</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={comparison.candidate.imageUrl ?? ""} alt="프로그램 상품 사진" className="mx-auto max-h-[65vh] w-full rounded-lg border bg-zinc-100 object-contain" />
              </figure>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <div className="text-sm"><p className="font-semibold">{comparison.candidate.productName}</p><p className="text-zinc-500">{candidateSubtitle(comparison.candidate)}</p></div>
              <button type="button" onClick={() => { void link(comparison.listing, comparison.candidate); setComparison(null); }} className="rounded-md bg-emerald-600 px-5 py-2.5 font-semibold text-white">같은 카드 · 연결</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// 촬영본 연결 화면과 같은 검색형 선택기다. 긴 앨범 목록을 스크롤하지 않고
// 일부 글자만 입력해도 해당 항목만 좁혀 보여준다.
function CandidateAutocomplete({
  id,
  label,
  value,
  options,
  cacheKey = "",
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  cacheKey?: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [knownOptions, setKnownOptions] = useState(options);
  const previousCacheKey = useRef(cacheKey);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(value), 0);
    return () => window.clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (previousCacheKey.current !== cacheKey) {
        previousCacheKey.current = cacheKey;
        setKnownOptions(options);
        return;
      }
      setKnownOptions((current) => [...new Set([...current, ...options])]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cacheKey, options]);

  // 입력 순간에는 옵션 API가 아직 도착하지 않았을 수 있다. 옵션이 뒤늦게
  // 채워져도 정확한 영문명·한글 별칭을 다시 판정해 실제 필터값으로 확정한다.
  useEffect(() => {
    const normalized = normalizeCandidateSearch(draft);
    if (!normalized || draft === value) return;
    const exact = knownOptions.find((option) =>
      candidateSearchTerms(option).some((term) => term === normalized),
    );
    if (!exact) return;

    const timer = window.setTimeout(() => {
      setDraft(exact);
      onChangeRef.current(exact);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draft, knownOptions, value]);

  const selectedOptionIsDisplayed =
    draft === value && knownOptions.some((option) => option === value);
  const query = selectedOptionIsDisplayed ? "" : normalizeCandidateSearch(draft);
  const visibleOptions = knownOptions
    .filter((option) => (query ? candidateSearchTerms(option).some((term) => term.includes(query)) : true))
    .slice(0, 100);

  function choose(option: string) {
    setDraft(option);
    onChange(option);
    setOpen(false);
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="text-xs font-semibold text-zinc-700">
        {label}
      </label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          id={id}
          value={draft}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onChange={(event) => {
            const nextDraft = event.currentTarget.value;
            setDraft(nextDraft);
            setOpen(true);
            if (!nextDraft.trim()) {
              onChange("");
              return;
            }

            // 한글 멤버명처럼 저장값과 표기가 다른 정확한 별칭도 실제 옵션값으로
            // 확정한다(현진 → HYUNJIN 등).
            const normalized = normalizeCandidateSearch(nextDraft);
            const exact = knownOptions.find((option) =>
              candidateSearchTerms(option).some((term) => term === normalized),
            );
            if (exact) {
              setDraft(exact);
              onChange(exact);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && visibleOptions[0]) {
              event.preventDefault();
              choose(visibleOptions[0]);
            }
          }}
          placeholder={`${label} 검색`}
          className="h-10 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-500"
        />
      </div>
      {open && visibleOptions.length ? (
        <div className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg">
          {visibleOptions.map((option) => (
            <button
              key={option}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              className="block w-full px-3 py-2 text-left text-sm text-zinc-800 hover:bg-violet-50"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const koreanMemberAliases: Record<string, string[]> = {
  "BANG CHAN": ["방찬", "찬"],
  "LEE KNOW": ["리노"],
  CHANGBIN: ["창빈"],
  HYUNJIN: ["현진"],
  HAN: ["한", "한지성", "지성"],
  FELIX: ["필릭스", "용복"],
  SEUNGMIN: ["승민"],
  "I.N": ["아이엔", "정인", "양정인"],
};

function normalizeCandidateSearch(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s._-]+/g, "");
}

function candidateSearchTerms(option: string) {
  return [option, ...(koreanMemberAliases[option.toLocaleUpperCase()] ?? [])].map(
    normalizeCandidateSearch,
  );
}
