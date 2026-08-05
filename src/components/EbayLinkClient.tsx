"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, ImageOff, Link2, Search } from "lucide-react";

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

const statusLabels: Record<string, string> = {
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
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<string, LinkCandidate[]>>({});
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initial
        .filter((listing) => listing.imageUrl)
        .map((listing) => [listing.listingId, listing.imageUrl as string]),
    ),
  );
  const [loadingImages, setLoadingImages] = useState(false);
  // 같은 목록에 대해 이미지 요청을 한 번만 보내기 위한 표시.
  const imagesRequested = useRef(false);

  // 화면에 뜬 리스팅의 eBay 사진을 받아온다. 저장된 것은 그대로 쓰고, 없는 것만
  // eBay에 물어본 뒤 저장하므로 다음부터는 호출이 없다.
  const loadImages = useCallback(async (rows: UnlinkedListing[]) => {
    const missing = rows.filter((row) => !row.imageUrl).map((row) => row.listingId);
    if (!missing.length) return;

    setLoadingImages(true);
    try {
      const response = await fetch("/api/ebay/active-report/listing-images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingIds: missing }),
      });
      const body = (await response.json().catch(() => null)) as
        | { images?: Record<string, string> }
        | null;
      if (response.ok && body?.images) {
        setImages((prev) => ({ ...prev, ...body.images }));
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

  async function link(listing: UnlinkedListing, candidate: LinkCandidate) {
    setBusyId(listing.listingId);
    setMessage("");
    try {
      const response = await fetch("/api/ebay/active-report/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: candidate.productId, itemId: listing.itemId }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "연결하지 못했습니다.");
      }

      setListings((prev) => prev.filter((row) => row.listingId !== listing.listingId));
      setMessage(`${candidate.sku} ↔ 상품번호 ${listing.itemId} 연결 완료. 판매중으로 바뀝니다.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "연결하지 못했습니다.");
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
      const response = await fetch(`/api/products?q=${encodeURIComponent(term)}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | {
            products?: Array<{
              id: string;
              sku: string;
              productName: string;
              brand: string | null;
              optionName: string | null;
              category: string | null;
              imageUrl: string | null;
              ebayItemId: string | null;
            }>;
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "상품을 찾지 못했습니다.");
      }

      setSearchResults((prev) => ({
        ...prev,
        [listing.listingId]: (body?.products ?? []).slice(0, 8).map((product) => ({
          productId: product.id,
          sku: product.sku,
          productName: product.productName,
          brand: product.brand,
          optionName: product.optionName,
          category: product.category,
          imageUrl: product.imageUrl,
          score: 0,
          alreadyLinkedItemId: product.ebayItemId,
        })),
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상품을 찾지 못했습니다.");
    } finally {
      setSearchingId(null);
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
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600">
        <span>
          연결 대기 {totalPending.toLocaleString()}건
          {totalPending > listings.length
            ? ` · 이 화면에 ${listings.length.toLocaleString()}건 표시`
            : ""}
        </span>
        {reportImportedAt ? (
          <span className="text-xs text-zinc-400">
            보고서 기준 {new Date(reportImportedAt).toLocaleString("ko-KR")}
          </span>
        ) : null}
      </div>

      {message ? (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-800">
          {message}
        </p>
      ) : null}

      {listings.map((listing) => {
        const busy = busyId === listing.listingId;
        const manual = searchResults[listing.listingId];
        return (
          <article
            key={listing.listingId}
            className="rounded-xl border border-zinc-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 gap-3">
                {images[listing.listingId] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={images[listing.listingId]}
                    alt=""
                    loading="lazy"
                    className="h-20 w-20 shrink-0 rounded-md border border-zinc-200 object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-zinc-300 text-zinc-400">
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
              <p className="mb-2 text-xs text-zinc-500">
                이 리스팅과 짝지을 상품을 고르세요
              </p>
              {(manual ?? listing.candidates).length === 0 ? (
                <p className="text-xs text-amber-700">
                  추천 후보를 찾지 못했습니다. 아래에서 직접 찾아 주세요.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {(manual ?? listing.candidates).map((candidate) => {
                    const badge = scoreLabel(candidate.score);
                    const blocked =
                      candidate.alreadyLinkedItemId !== null &&
                      candidate.alreadyLinkedItemId !== listing.itemId;
                    return (
                      <li key={candidate.productId}>
                        <div className="flex items-center gap-2 rounded-md border border-zinc-200 p-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={candidate.imageUrl ?? ""}
                            alt=""
                            loading="lazy"
                            className="h-12 w-12 shrink-0 rounded border border-zinc-200 object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-zinc-900">
                              {candidate.sku}
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
                            {blocked ? (
                              <p className="mt-0.5 text-[11px] text-rose-700">
                                이미 상품번호 {candidate.alreadyLinkedItemId} 연결됨
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => void link(listing, candidate)}
                            disabled={busy || blocked}
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            {busy ? "처리 중..." : "연결"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-3 flex gap-1.5">
                <input
                  value={searchTerms[listing.listingId] ?? ""}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setSearchTerms((prev) => ({ ...prev, [listing.listingId]: value }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void search(listing);
                  }}
                  placeholder="SKU나 상품명으로 직접 찾기"
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
            </div>
          </article>
        );
      })}
    </div>
  );
}
