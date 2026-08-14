"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildEbayListingTitle } from "@/lib/ebay-listing-fields";

type Candidate = {
  cardId: string;
  id: string;
  sku: string;
  title: string;
  groupName: string | null;
  memberName: string | null;
  albumName: string | null;
  versionName: string | null;
  existingImageUrl: string | null;
  currentImageUrl: string | null;
  sourceImageUrl: string | null;
  imageSource: string | null;
  userFrontImageUrl: string | null;
  userBackImageUrl: string | null;
  userFrontR2Key: string | null;
  userBackR2Key: string | null;
  stockQuantity: number | null;
  salePrice: number | null;
  ebayPrice: number | null;
  featuredMembers: string | null;
  userImageRegistered: boolean;
  hasBackImage: boolean;
  imageScore?: number;
};

type Facets = {
  groups: string[];
  members: string[];
  albums: string[];
  versions: string[];
};

type CandidateResponse = {
  candidates: Candidate[];
  facets: Facets;
  paging: { limit: number; offset: number; hasMore: boolean };
  error?: string;
};

type DeleteR2Response = {
  deleted?: "front" | "back" | "all";
  product?: {
    id: string;
    sku: string;
    imageUrl: string | null;
    sourceImageUrl: string | null;
    imageSource: string | null;
    userFrontImageUrl: string | null;
    userBackImageUrl: string | null;
    userFrontR2Key: string | null;
    userBackR2Key: string | null;
    hasBackImage: boolean;
    ebayImageUrls: string[];
  };
  error?: string;
};

type PendingR2UploadResponse = {
  pendingCount?: number;
  error?: string;
};

type BulkR2UploadResponse = {
  pendingTotal?: number;
  processed?: number;
  success?: number;
  failed?: number;
  remaining?: number;
  failures?: Array<{
    productId: string;
    sku: string;
    reason: string;
  }>;
  error?: string;
};

type R2BulkProgress = {
  total: number;
  processed: number;
  success: number;
  failed: number;
  remaining: number;
};

type ClipRebuildProgress = {
  processed: number;
  remaining: number | null;
};

type FingerprintRebuildProgress = {
  scanned: number;
  updated: number;
  failed: number;
  skipped: number;
  clipFailed: number;
  remaining: number | null;
};

type CompletedPreview = {
  frontImageUrl: string;
  backImageUrl: string | null;
};

type UploadSide = "front" | "back";
type DeleteSide = "front" | "back" | "all";

type DeleteR2ModalState = {
  candidate: Candidate;
  side: DeleteSide;
};

type ImageMatchCandidate = {
  product?: {
    id: string;
    sku: string;
    productName: string;
    optionName: string | null;
    category: string | null;
    brand: string | null;
    imageUrl: string | null;
    stockQuantity?: number | null;
    salePrice?: number | null;
    ebayPrice?: number | null;
    featuredMembers?: string | null;
    finalScore?: number;
    similarity?: number;
  };
};

type DebugDiagnosis =
  | { found: false; sku: string }
  | {
      found: true;
      sku: string;
      productName: string | null;
      group: string | null;
      member: string | null;
      album: string | null;
      hasImage: boolean;
      hasClipEmbedding: boolean;
      clipLen: number;
      hasHashes: boolean;
      uploadHasClip: boolean;
      clipScorePercent: number | null;
      passesFilters: boolean;
      filteredTotal: number | null;
      filteredRank: number | null;
      inResults: boolean;
    };

function normalizeCandidateMetadata(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s._-]+/g, "");
}

function candidateMatchesSelectedMetadata(
  candidate: { brand: string | null; optionName: string | null },
  filters: { group: string; member: string },
) {
  const group = normalizeCandidateMetadata(filters.group);
  const member = normalizeCandidateMetadata(filters.member);
  return (
    (!group || normalizeCandidateMetadata(candidate.brand) === group) &&
    (!member || normalizeCandidateMetadata(candidate.optionName) === member)
  );
}

const emptyFacets: Facets = {
  groups: [],
  members: [],
  albums: [],
  versions: [],
};

function describeDebug(debug: DebugDiagnosis, uploadHadClip: boolean): string {
  if (!debug.found) {
    return `⚠️ SKU "${debug.sku}" 상품을 찾지 못했습니다. SKU를 정확히 입력했는지 확인하세요.`;
  }

  const parts: string[] = [`[${debug.sku}] ${debug.productName ?? ""}`];
  parts.push(`그룹=${debug.group ?? "-"} / 멤버=${debug.member ?? "-"} / 앨범=${debug.album ?? "-"}`);

  if (!debug.hasImage) {
    parts.push("❌ 이 카드에 이미지가 없어 검색 대상에서 제외됩니다.");
    return parts.join("\n");
  }
  if (!uploadHadClip) {
    parts.push("⚠️ 업로드 이미지의 AI 임베딩이 안 만들어졌습니다(모델 미로딩). 다시 시도하세요.");
  }
  if (!debug.hasClipEmbedding) {
    parts.push(
      `❌ 이 카드에 CLIP 임베딩이 없습니다(clipLen=${debug.clipLen}). → 그래서 못 찾습니다.`,
    );
    return parts.join("\n");
  }

  parts.push(
    `CLIP 임베딩 있음 · 내 사진과 유사도 ${debug.clipScorePercent}% · 필터통과=${
      debug.passesFilters ? "예" : "아니오 ❌"
    }`,
  );

  if (!debug.passesFilters) {
    parts.push(
      "❌ 지금 건 필터가 이 카드를 제외합니다. 필터값(그룹/멤버/앨범)이 이 카드의 값과 다릅니다. 위에 표시된 멤버/그룹/앨범 값과 똑같이 맞추거나 필터를 비우세요.",
    );
    return parts.join("\n");
  }

  if (debug.filteredRank !== null) {
    parts.push(
      `필터 안에서 CLIP 순위 ${debug.filteredRank}위 / ${debug.filteredTotal}개`,
    );
  }

  if (debug.inResults) {
    parts.push("✅ 검색 결과(후보)에 들어있음 → 더보기로 펼치면 보입니다.");
  } else {
    parts.push(
      "❌ 검색 결과에 없음" +
        (debug.filteredRank !== null
          ? ` (순위 ${debug.filteredRank}위라 반환 목록에서 잘렸거나 코드 문제)`
          : ""),
    );
  }
  parts.push(`(ORB 지문 ${debug.hasHashes ? "있음" : "없음"})`);

  return parts.join("\n");
}

const storageKey = "photo-card-match.recent-filters.v1";
const candidateFetchDebounceMs = 150;
const r2BulkBatchSize = 20;
const imageResultPageSize = 48;

type FingerprintBatchResponse = {
  scanned?: number;
  updated?: number;
  failed?: number;
  skipped?: number;
  clipFailed?: number;
  remaining?: number;
  error?: string;
};

async function fetchFingerprintBatch(
  batchSize: number,
  onRetry: (attempt: number) => void,
): Promise<FingerprintBatchResponse> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(
        `/api/admin/build-image-fingerprints?limit=${batchSize}`,
        {
          method: "POST",
          cache: "no-store",
        },
      );
      const data = (await response.json().catch(() => null)) as
        | FingerprintBatchResponse
        | null;

      if (!response.ok || !data) {
        throw new Error(data?.error ?? `지문 생성 실패 (${response.status})`);
      }

      return data;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("지문 생성 요청이 실패했습니다.");
      if (attempt >= 3) break;
      onRetry(attempt);
      await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
  }

  throw lastError ?? new Error("지문 생성 요청이 실패했습니다.");
}

export function PhotoCardMatchClient() {
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [frontImageUrl, setFrontImageUrl] = useState<string | null>(null);
  const [backImageUrl, setBackImageUrl] = useState<string | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [activeUploadSide, setActiveUploadSide] = useState<UploadSide>("front");
  const [dragSide, setDragSide] = useState<UploadSide | null>(null);
  const [group, setGroup] = useState("");
  const [member, setMember] = useState("");
  const [album, setAlbum] = useState("");
  const [version, setVersion] = useState("");
  const [keyword, setKeyword] = useState("");
  const [debugSku, setDebugSku] = useState("");
  const [debugResult, setDebugResult] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [regSku, setRegSku] = useState("");
  const [regName, setRegName] = useState("");
  const [regGroup, setRegGroup] = useState("");
  const [regMember, setRegMember] = useState("");
  const [regAlbum, setRegAlbum] = useState("");
  const [regPrice, setRegPrice] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState<
    "pending" | "registered" | "all"
  >("all");
  const [stockAdjustingId, setStockAdjustingId] = useState<string | null>(null);
  const [ebayPriceSavingId, setEbayPriceSavingId] = useState<string | null>(null);
  const [featuredMembersSavingId, setFeaturedMembersSavingId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<Record<string, string[]>>({});
  const [facets, setFacets] = useState<Facets>(emptyFacets);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [previewCandidate, setPreviewCandidate] = useState<Candidate | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isImageResult, setIsImageResult] = useState(false);
  const [imageVisibleCount, setImageVisibleCount] = useState(imageResultPageSize);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingTarget, setDeletingTarget] = useState<string | null>(null);
  const [continuousMode, setContinuousMode] = useState(true);
  const [uploadResetKey, setUploadResetKey] = useState(0);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [completedPreviews, setCompletedPreviews] = useState<
    Record<string, CompletedPreview>
  >({});
  const [replaceCandidate, setReplaceCandidate] = useState<Candidate | null>(null);
  const [deleteModal, setDeleteModal] = useState<DeleteR2ModalState | null>(null);
  const [message, setMessage] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [r2PendingCount, setR2PendingCount] = useState<number | null>(null);
  const [r2PendingLoading, setR2PendingLoading] = useState(false);
  const [r2PendingError, setR2PendingError] = useState("");
  const [r2BulkUploading, setR2BulkUploading] = useState(false);
  const [r2BulkProgress, setR2BulkProgress] = useState<R2BulkProgress>({
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    remaining: 0,
  });
  const [fingerprintRunning, setFingerprintRunning] = useState(false);
  const [fingerprintProgress, setFingerprintProgress] =
    useState<FingerprintRebuildProgress>({
      scanned: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      clipFailed: 0,
      remaining: null,
    });
  const [fingerprintMessage, setFingerprintMessage] = useState("");
  const [clipRunning, setClipRunning] = useState(false);
  const [clipProgress, setClipProgress] = useState<ClipRebuildProgress>({
    processed: 0,
    remaining: null,
  });
  const [clipMessage, setClipMessage] = useState("");
  const [clipCompletion, setClipCompletion] = useState<{
    total: number;
    embedded: number;
    failed: number;
    remaining: number;
  } | null>(null);
  const autoNextTimer = useRef<number | null>(null);
  const r2BulkCancelRef = useRef(false);
  const fingerprintCancelRef = useRef(false);
  const clipCancelRef = useRef(false);
  // Auto image-match plumbing: a ref to the latest suggestByImage (so the
  // auto-trigger effect can call it without re-subscribing every render), an
  // in-flight guard + pending flag (re-run once if inputs changed mid-match),
  // and a cache of the uploaded image's CLIP embedding keyed by its data URL so
  // changing a filter doesn't re-embed the same photo (the slow client step).
  const suggestByImageRef = useRef<(() => void) | null>(null);
  const imageMatchBusyRef = useRef(false);
  const imageMatchPendingRef = useRef(false);
  const imageFilterSignatureRef = useRef("");
  const frontClipCacheRef = useRef<{ url: string; embedding: number[] } | null>(null);
  // Latest frontImageUrl readable from effects that intentionally don't depend
  // on it (so they don't re-run when a photo is added/cleared).
  const frontImageUrlRef = useRef<string | null>(null);
  imageFilterSignatureRef.current = JSON.stringify([
    normalizeCandidateMetadata(group),
    normalizeCandidateMetadata(member),
    normalizeCandidateMetadata(album),
    normalizeCandidateMetadata(version),
  ]);

  const cancelAutoNext = useCallback(() => {
    if (autoNextTimer.current) {
      window.clearTimeout(autoNextTimer.current);
      autoNextTimer.current = null;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(storageKey);

      if (!saved) {
        setFiltersLoaded(true);
        return;
      }

      try {
        const parsed = JSON.parse(saved) as Partial<{
          group: string;
          member: string;
          album: string;
          version: string;
        }>;
        setGroup(parsed.group ?? "");
        setMember(parsed.member ?? "");
        setAlbum(parsed.album ?? "");
        setVersion(parsed.version ?? "");
      } catch {
        window.localStorage.removeItem(storageKey);
      } finally {
        setFiltersLoaded(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      cancelAutoNext();
    };
  }, [cancelAutoNext]);

  useEffect(() => {
    if (!filtersLoaded) {
      return;
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ group, member, album, version }),
    );
  }, [filtersLoaded, group, member, album, version]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.cardId === selectedCandidateId) ?? null,
    [candidates, selectedCandidateId],
  );
  const r2BulkProgressPercent = useMemo(() => {
    if (r2BulkProgress.total <= 0) {
      return 0;
    }

    return Math.min(
      100,
      Math.round((r2BulkProgress.processed / r2BulkProgress.total) * 100),
    );
  }, [r2BulkProgress]);

  // Auto-built product name for the new-card form, using the SAME rule as the
  // eBay upload Excel title (buildEbayListingTitle): "[그룹] [멤버] Official
  // [앨범] Photocard Kpop", trimmed to 80 chars. Used when 상품명 is left blank.
  const composedRegName = useMemo(
    () =>
      buildEbayListingTitle({
        brand: regGroup.trim() || null,
        category: regAlbum.trim() || null,
        optionName: regMember.trim() || null,
        featuredMembers: null,
        ebayTitle: null,
        productName: null,
      } as unknown as Parameters<typeof buildEbayListingTitle>[0]),
    [regGroup, regAlbum, regMember],
  );

  const newProductHref = useMemo(() => {
    const params = new URLSearchParams();
    const title = [group, album, member, version].filter(Boolean).join(" ");

    if (group.trim()) {
      params.set("brand", group.trim());
    }

    if (album.trim()) {
      params.set("category", album.trim());
    }

    if (member.trim()) {
      params.set("optionName", member.trim());
    }

    if (title) {
      params.set("productName", title);
    }

    if (version.trim()) {
      params.set("memo", version.trim());
    }

    const query = params.toString();

    return query ? `/products/new?${query}` : "/products/new";
  }, [group, album, member, version]);

  const buildPhotoCardFilterParams = useCallback(() => {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries({
      group,
      member,
      album,
      version,
      keyword,
    })) {
      if (value.trim()) {
        params.set(key, value.trim());
      }
    }

    return params;
  }, [group, member, album, version, keyword]);

  const fetchR2PendingCount = useCallback(async () => {
    const params = buildPhotoCardFilterParams();
    const response = await fetch(`/api/inventory/photo-card-r2-upload?${params}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as PendingR2UploadResponse | null;

    if (!response.ok || data?.pendingCount === undefined) {
      throw new Error(data?.error ?? "R2 전송 대기 건수 조회에 실패했습니다.");
    }

    return data.pendingCount;
  }, [buildPhotoCardFilterParams]);

  const refreshR2PendingCount = useCallback(
    async (silent = false) => {
      if (!silent) {
        setR2PendingLoading(true);
      }
      setR2PendingError("");

      try {
        const count = await fetchR2PendingCount();
        setR2PendingCount(count);
      } catch (error) {
        setR2PendingError(
          error instanceof Error ? error.message : "R2 전송 대기 건수 조회에 실패했습니다.",
        );
      } finally {
        if (!silent) {
          setR2PendingLoading(false);
        }
      }
    },
    [fetchR2PendingCount],
  );

  const refreshClipCompletion = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/embedding-progress", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        total: number;
        embedded: number;
        failed: number;
        remaining: number;
      };
      setClipCompletion(data);
    } catch {
      // ignore — counter is best-effort
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshClipCompletion();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [refreshClipCompletion]);

  const storeImageFile = useCallback(async (file: File, side: UploadSide) => {
    if (!file.type.startsWith("image/")) {
      setMessage("이미지 파일만 업로드할 수 있습니다.");
      return;
    }

    cancelAutoNext();
    setImageProcessing(true);
    try {
      const dataUrl = await fileToDataUrl(file);

      if (side === "front") {
        setFrontFile(file);
        setFrontImageUrl(dataUrl);
        setActiveUploadSide("back");
      } else {
        setBackImageUrl(dataUrl);
        setActiveUploadSide("front");
      }

      setMessage(`${side === "front" ? "앞면" : "뒷면"} 이미지가 준비되었습니다.`);
    } finally {
      setImageProcessing(false);
    }
  }, [cancelAutoNext]);

  const clearUploadedImages = useCallback(() => {
    cancelAutoNext();
    frontClipCacheRef.current = null;
    imageMatchPendingRef.current = false;
    setFrontFile(null);
    setFrontImageUrl(null);
    setBackImageUrl(null);
    setSelectedCandidateId(null);
    setPreviewCandidate(null);
    setActiveUploadSide("front");
    setUploadResetKey((current) => current + 1);
  }, [cancelAutoNext]);

  const saveCandidate = useCallback(async (candidate: Candidate) => {
    if (!frontImageUrl) {
      setMessage("앞면 이미지를 먼저 업로드해 주세요.");
      return;
    }

    const savedFrontImageUrl = frontImageUrl;
    const savedBackImageUrl = backImageUrl;
    setSavingId(candidate.cardId);
    setReplaceCandidate(null);
    setMessage("촬영본을 연결 중입니다.");

    try {
      const response = await fetch("/api/inventory/confirm-photo-card-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_id: candidate.cardId,
          user_front_image_url: savedFrontImageUrl,
          user_back_image_url: savedBackImageUrl,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | {
            product?: {
              id: string;
              sku: string;
              imageUrl: string | null;
              sourceImageUrl: string | null;
              imageSource: string | null;
              userFrontImageUrl: string | null;
              userBackImageUrl: string | null;
              userFrontR2Key: string | null;
              userBackR2Key: string | null;
              hasBackImage: boolean;
              ebayImageUrls: string[];
              stockQuantity?: number;
              stockIncremented?: boolean;
            };
            error?: string;
          }
        | null;

      if (!response.ok || !data?.product) {
        throw new Error(data?.error ?? "촬영본 저장에 실패했습니다.");
      }

      const savedProduct = data.product;

      setCandidates((current) =>
        current.map((item) =>
          item.cardId === candidate.cardId
            ? {
                ...item,
                userImageRegistered: true,
                hasBackImage: savedProduct.hasBackImage,
                currentImageUrl: savedProduct.imageUrl,
                sourceImageUrl: savedProduct.sourceImageUrl,
                imageSource: savedProduct.imageSource,
                userFrontImageUrl: savedProduct.userFrontImageUrl,
                userBackImageUrl: savedProduct.userBackImageUrl,
                userFrontR2Key: savedProduct.userFrontR2Key,
                userBackR2Key: savedProduct.userBackR2Key,
                stockQuantity:
                  savedProduct.stockQuantity ??
                  (item.stockQuantity ?? 0) + (savedProduct.stockIncremented ? 1 : 0),
              }
            : item,
        ),
      );
      setCompletedPreviews((current) => ({
        ...current,
        [candidate.cardId]: {
          frontImageUrl: savedProduct.userFrontImageUrl ?? savedFrontImageUrl,
          backImageUrl: savedProduct.userBackImageUrl ?? null,
        },
      }));
      const backSavedMsg =
        savedBackImageUrl && !savedProduct.hasBackImage ? " (뒷면 저장 실패 — 다시 시도해주세요)" : "";
      const stockMsg = savedProduct.stockIncremented
        ? ` · 재고 +1 (현재 ${savedProduct.stockQuantity ?? 1}개)`
        : "";
      setMessage(`${data.product.sku} 촬영본 연결 완료${stockMsg}${backSavedMsg}`);
      void refreshR2PendingCount(true);

      if (continuousMode) {
        if (autoNextTimer.current) {
          window.clearTimeout(autoNextTimer.current);
        }

        autoNextTimer.current = window.setTimeout(() => {
          autoNextTimer.current = null;
          if (registrationStatus === "pending") {
            setCandidates((current) =>
              current.filter((item) => item.cardId !== candidate.cardId),
            );
          }
          clearUploadedImages();
          setMessage("다음 카드 업로드 상태로 전환했습니다.");
        }, 1000);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "촬영본 저장에 실패했습니다.");
    } finally {
      setSavingId(null);
    }
  }, [
    frontImageUrl,
    backImageUrl,
    continuousMode,
    registrationStatus,
    clearUploadedImages,
    refreshR2PendingCount,
  ]);

  // Sets the card's stock to an absolute value (used by −/＋ and direct entry).
  const commitStock = useCallback(async (candidate: Candidate, nextStock: number) => {
    const current = candidate.stockQuantity ?? 0;

    if (!Number.isFinite(nextStock) || nextStock < 0) {
      setMessage(`${candidate.sku} 재고는 0 이상의 숫자여야 합니다.`);
      return;
    }

    if (nextStock === current) {
      return;
    }

    setStockAdjustingId(candidate.cardId);

    try {
      const response = await fetch("/api/inventory/movement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: candidate.cardId,
          type: "ADJUST",
          quantity: nextStock,
          reason: "촬영본 매칭 재고 수정",
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { movement?: { afterQuantity?: number }; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "재고 변경에 실패했습니다.");
      }

      const after = data?.movement?.afterQuantity ?? nextStock;
      setCandidates((items) =>
        items.map((item) =>
          item.cardId === candidate.cardId ? { ...item, stockQuantity: after } : item,
        ),
      );
      setMessage(`${candidate.sku} 재고 ${after}개로 변경됨`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "재고 변경에 실패했습니다.");
    } finally {
      setStockAdjustingId(null);
    }
  }, []);

  const saveEbayPrice = useCallback(async (candidate: Candidate, rawValue: string) => {
    const trimmed = rawValue.trim();
    const nextPrice = trimmed === "" ? null : Number(trimmed);

    if (nextPrice !== null && (!Number.isFinite(nextPrice) || nextPrice < 0)) {
      setMessage(`${candidate.sku} 달러 가격은 0 이상의 숫자여야 합니다.`);
      return;
    }

    setEbayPriceSavingId(candidate.cardId);

    try {
      const response = await fetch(`/api/products/${candidate.cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ebayPrice: trimmed }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ebayPrice?: number | null; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "달러 가격 저장에 실패했습니다.");
      }

      const savedPrice = data?.ebayPrice ?? null;
      setCandidates((items) =>
        items.map((item) =>
          item.cardId === candidate.cardId ? { ...item, ebayPrice: savedPrice } : item,
        ),
      );
      setMessage(
        savedPrice === null
          ? `${candidate.sku} 달러 가격을 비웠습니다.`
          : `${candidate.sku} 달러 가격 $${savedPrice} 저장됨`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "달러 가격 저장에 실패했습니다.");
    } finally {
      setEbayPriceSavingId(null);
    }
  }, []);

  const saveFeaturedMembers = useCallback(
    async (candidate: Candidate, members: string[]) => {
      setFeaturedMembersSavingId(candidate.cardId);
      try {
        const response = await fetch("/api/inventory/featured-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: candidate.cardId, members }),
        });
        const data = (await response.json().catch(() => null)) as
          | { featuredMembers?: string | null; error?: string }
          | null;
        if (!response.ok) {
          throw new Error(data?.error ?? "멤버 저장에 실패했습니다.");
        }
        const saved = data?.featuredMembers ?? null;
        setCandidates((items) =>
          items.map((item) =>
            item.cardId === candidate.cardId ? { ...item, featuredMembers: saved } : item,
          ),
        );
        setMessage(`${candidate.sku} 포함 멤버 저장: ${saved ?? "(없음)"}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "멤버 저장에 실패했습니다.");
      } finally {
        setFeaturedMembersSavingId(null);
      }
    },
    [],
  );

  useEffect(() => {
    const unitGroups = [
      ...new Set(
        candidates
          .filter((item) => (item.memberName ?? "").trim().toLowerCase() === "unit")
          .map((item) => (item.groupName ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const missing = unitGroups.filter((group) => !(group in groupMembers));
    if (!missing.length) {
      return;
    }

    let active = true;
    void (async () => {
      for (const group of missing) {
        try {
          const response = await fetch(
            `/api/inventory/group-members?group=${encodeURIComponent(group)}`,
          );
          const data = (await response.json().catch(() => null)) as
            | { members?: string[] }
            | null;
          if (!active) return;
          setGroupMembers((current) => ({ ...current, [group]: data?.members ?? [] }));
        } catch {
          if (active) {
            setGroupMembers((current) => ({ ...current, [group]: [] }));
          }
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [candidates, groupMembers]);

  const requestSaveCandidate = useCallback((candidate: Candidate | null) => {
    if (!candidate) {
      setMessage("후보 카드를 먼저 선택해 주세요.");
      return;
    }

    if (candidate.userImageRegistered) {
      setReplaceCandidate(candidate);
      return;
    }

    void saveCandidate(candidate);
  }, [saveCandidate]);

  const requestDeleteR2Images = useCallback((candidate: Candidate, side: DeleteSide) => {
    setDeleteModal({ candidate, side });
  }, []);

  const deleteR2Images = useCallback(
    async (candidate: Candidate, side: DeleteSide) => {
      const actionLabel = deleteActionLabel(side);
      const targetId = `${candidate.cardId}:${side}`;
      setDeletingTarget(targetId);

      try {
        const response = await fetch("/api/inventory/delete-r2-photo-card-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product_id: candidate.cardId,
            side,
          }),
        });
        const data = (await response.json().catch(() => null)) as DeleteR2Response | null;

        if (!response.ok || !data?.product) {
          throw new Error(data?.error ?? "R2 이미지 삭제에 실패했습니다.");
        }

        setCandidates((current) =>
          current.map((item) =>
            item.cardId === candidate.cardId
              ? {
                  ...item,
                  userImageRegistered: Boolean(data.product?.userFrontImageUrl),
                  hasBackImage: data.product?.hasBackImage ?? false,
                  currentImageUrl: data.product?.imageUrl ?? item.currentImageUrl,
                  sourceImageUrl: data.product?.sourceImageUrl ?? item.sourceImageUrl,
                  imageSource: data.product?.imageSource ?? item.imageSource,
                  userFrontImageUrl: data.product?.userFrontImageUrl ?? null,
                  userBackImageUrl: data.product?.userBackImageUrl ?? null,
                  userFrontR2Key: data.product?.userFrontR2Key ?? null,
                  userBackR2Key: data.product?.userBackR2Key ?? null,
                }
              : item,
          ),
        );
        setCompletedPreviews((current) => {
          const next = { ...current };
          delete next[candidate.cardId];
          return next;
        });
        setMessage(`${candidate.sku} ${actionLabel} 삭제 완료`);
        void refreshR2PendingCount(true);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "R2 이미지 삭제에 실패했습니다.");
      } finally {
        setDeletingTarget(null);
      }
    },
    [refreshR2PendingCount],
  );

  const stopR2BulkUpload = useCallback(() => {
    r2BulkCancelRef.current = true;
  }, []);

  const startR2BulkUpload = useCallback(async () => {
    if (r2BulkUploading) {
      return;
    }

    const initialPending = r2PendingCount ?? 0;

    if (initialPending <= 0) {
      setMessage("R2로 전송할 촬영본이 없습니다.");
      return;
    }

    r2BulkCancelRef.current = false;
    setR2BulkUploading(true);
    setR2PendingError("");

    const requestBody = {
      group: group.trim() || undefined,
      member: member.trim() || undefined,
      album: album.trim() || undefined,
      version: version.trim() || undefined,
      keyword: keyword.trim() || undefined,
      batch_size: r2BulkBatchSize,
    };
    let latestProgress: R2BulkProgress = {
      total: initialPending,
      processed: 0,
      success: 0,
      failed: 0,
      remaining: initialPending,
    };
    setR2BulkProgress(latestProgress);
    setMessage(`R2 전송 시작: ${initialPending}건`);

    try {
      while (latestProgress.remaining > 0 && !r2BulkCancelRef.current) {
        const previousRemaining = latestProgress.remaining;
        const response = await fetch("/api/inventory/photo-card-r2-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const data = (await response.json().catch(() => null)) as BulkR2UploadResponse | null;

        if (
          !response.ok ||
          data?.processed === undefined ||
          data.remaining === undefined
        ) {
          throw new Error(data?.error ?? "R2 대량 전송에 실패했습니다.");
        }

        const processedInBatch = data.processed;
        const successInBatch = data.success ?? 0;
        const failedInBatch = data.failed ?? 0;
        const remaining = Math.max(0, data.remaining);

        latestProgress = {
          total: Math.max(
            latestProgress.total,
            latestProgress.processed + processedInBatch + remaining,
          ),
          processed: latestProgress.processed + processedInBatch,
          success: latestProgress.success + successInBatch,
          failed: latestProgress.failed + failedInBatch,
          remaining,
        };
        setR2BulkProgress(latestProgress);

        if (processedInBatch <= 0) {
          break;
        }

        if (remaining >= previousRemaining && successInBatch <= 0) {
          break;
        }
      }

      if (r2BulkCancelRef.current) {
        setMessage(
          `R2 전송을 중지했습니다. 성공 ${latestProgress.success}건 / 실패 ${latestProgress.failed}건`,
        );
      } else if (latestProgress.remaining <= 0) {
        setMessage(
          `R2 전송 완료: 성공 ${latestProgress.success}건 / 실패 ${latestProgress.failed}건`,
        );
      } else {
        setMessage(
          `R2 전송이 일부만 처리되었습니다. 성공 ${latestProgress.success}건 / 실패 ${latestProgress.failed}건`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "R2 대량 전송에 실패했습니다.");
    } finally {
      setR2BulkUploading(false);
      setR2PendingCount(latestProgress.remaining);
      setReloadTick((current) => current + 1);
      void refreshR2PendingCount(true);
    }
  }, [
    r2BulkUploading,
    r2PendingCount,
    group,
    member,
    album,
    version,
    keyword,
    refreshR2PendingCount,
  ]);

  const stopFingerprintRebuild = useCallback(() => {
    fingerprintCancelRef.current = true;
  }, []);

  const retryFingerprintFailures = useCallback(async () => {
    if (fingerprintRunning) return;

    setFingerprintMessage("실패한 이미지 지문 항목을 재시도 대기열로 되돌리는 중입니다.");

    try {
      const response = await fetch(
        "/api/admin/build-image-fingerprints?resetFailed=1",
        {
          method: "POST",
          cache: "no-store",
        },
      );
      const data = (await response.json().catch(() => null)) as
        | { reset?: number; error?: string }
        | null;

      if (!response.ok || !data) {
        throw new Error(data?.error ?? `실패 항목 초기화 실패 (${response.status})`);
      }

      setFingerprintProgress((current) => ({ ...current, failed: 0 }));
      setFingerprintMessage(
        `실패 항목 ${data.reset ?? 0}건을 재시도 대기열로 되돌렸습니다.`,
      );
    } catch (error) {
      setFingerprintMessage(
        error instanceof Error ? error.message : "실패 항목 초기화에 실패했습니다.",
      );
    }
  }, [fingerprintRunning]);

  const startFingerprintRebuild = useCallback(async () => {
    if (fingerprintRunning) return;

    fingerprintCancelRef.current = false;
    setFingerprintRunning(true);
    setFingerprintMessage("ORB/색상 지문을 생성 중입니다. 기존 CLIP 임베딩은 보존됩니다.");
    setFingerprintProgress({
      scanned: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      clipFailed: 0,
      remaining: null,
    });

    const batchSize = 16;
    let totals: FingerprintRebuildProgress = {
      scanned: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      clipFailed: 0,
      remaining: null,
    };
    let previousRemaining = Number.POSITIVE_INFINITY;

    try {
      while (!fingerprintCancelRef.current) {
        const data = await fetchFingerprintBatch(batchSize, (attempt) => {
          setFingerprintMessage(
            `요청이 일시 실패해 재시도 중입니다 (${attempt}/3). 이미 완료된 지문은 저장되어 있습니다.`,
          );
        });

        const scanned = data.scanned ?? 0;
        const updated = data.updated ?? 0;
        const failed = data.failed ?? 0;
        const skipped = data.skipped ?? 0;
        const clipFailed = data.clipFailed ?? 0;
        const remaining = data.remaining ?? 0;

        totals = {
          scanned: totals.scanned + scanned,
          updated: totals.updated + updated,
          failed: totals.failed + failed,
          skipped: totals.skipped + skipped,
          clipFailed: totals.clipFailed + clipFailed,
          remaining,
        };
        setFingerprintProgress(totals);

        if (remaining <= 0) {
          setFingerprintMessage(
            `ORB/색상 지문 생성 완료: 갱신 ${totals.updated.toLocaleString()}건, 실패 ${totals.failed.toLocaleString()}건, 건너뜀 ${totals.skipped.toLocaleString()}건.`,
          );
          break;
        }

        if (scanned <= 0) {
          setFingerprintMessage(
            `더 처리할 지문 후보가 없습니다. 남은 ${remaining.toLocaleString()}건은 이미지 URL 상태를 확인해야 합니다.`,
          );
          break;
        }

        if (updated <= 0 && remaining >= previousRemaining) {
          setFingerprintMessage(
            `중지: 남은 ${remaining.toLocaleString()}건이 줄지 않습니다. 이미지 로드 실패 항목을 확인해야 합니다.`,
          );
          break;
        }

        previousRemaining = remaining;
        setFingerprintMessage(
          `ORB/색상 지문 생성 중: 갱신 ${totals.updated.toLocaleString()}건, 실패 ${totals.failed.toLocaleString()}건, 남은 ${remaining.toLocaleString()}건.`,
        );
      }

      if (fingerprintCancelRef.current) {
        setFingerprintMessage(
          `중지되었습니다. 갱신 ${totals.updated.toLocaleString()}건, 남은 ${totals.remaining?.toLocaleString() ?? "-"}건.`,
        );
      }
    } catch (error) {
      const savedCount = totals.updated + totals.failed;
      setFingerprintMessage(
        `${
          error instanceof Error ? error.message : "ORB/색상 지문 생성이 중단되었습니다."
        } 저장된 ${savedCount.toLocaleString()}건은 유지됐고, 다시 시작하면 남은 항목부터 이어집니다.`,
      );
    } finally {
      setFingerprintRunning(false);
      void refreshClipCompletion();
    }
  }, [fingerprintRunning, refreshClipCompletion]);

  const stopClipRebuild = useCallback(() => {
    clipCancelRef.current = true;
  }, []);


  const startClipRebuild = useCallback(async () => {
    if (clipRunning) return;

    clipCancelRef.current = false;
    setClipRunning(true);
    setClipMessage(
      "AI 모델 다운로드 중... 첫 실행 시 약 100MB. 브라우저가 캐시하므로 다음부턴 즉시 시작됩니다.",
    );
    setClipProgress({ processed: 0, remaining: null });

    let totalProcessed = 0;
    let totalFailed = 0;

    try {
      const { embedImageBlob, loadClip, getActiveDevice } = await import(
        "@/lib/clipBrowser"
      );
      await loadClip((info) => {
        if (clipCancelRef.current) return;
        if (info.status === "progress" && info.file && info.progress !== undefined) {
          setClipMessage(
            `모델 다운로드 중: ${info.file} (${Math.round(info.progress)}%)`,
          );
        } else if (info.status === "ready") {
          setClipMessage("모델 준비 완료. 임베딩을 시작합니다...");
        }
      });

      const device = getActiveDevice();
      const batchSize = device === "webgpu" ? 30 : 10;
      setClipMessage(
        `모델 준비 완료 (${device === "webgpu" ? "GPU 가속 ON ⚡" : "CPU 모드"}). 큐 조회 중...`,
      );

      let previousRemaining = Number.POSITIVE_INFINITY;

      while (!clipCancelRef.current) {
        const queueResponse = await fetch(
          `/api/admin/embedding-queue?limit=${batchSize}`,
          { cache: "no-store" },
        );

        if (!queueResponse.ok) {
          throw new Error(`큐 조회 실패 (${queueResponse.status})`);
        }

        const queue = (await queueResponse.json()) as {
          remaining: number;
          items: Array<{ id: string; imageUrl: string | null }>;
        };

        setClipProgress({ processed: totalProcessed, remaining: queue.remaining });

        if (queue.items.length === 0) {
          setClipMessage(`✅ 완료! 총 ${totalProcessed}개 처리 끝났습니다.`);
          break;
        }

        // Stall guard: each pass either embeds an item or flags it as failed,
        // both of which shrink the queue. If a full pass didn't reduce
        // `remaining` at all, we can't make progress (e.g. the failure-marking
        // save itself is failing) — stop instead of looping forever.
        if (queue.remaining >= previousRemaining) {
          setClipMessage(
            `⚠️ 중지: 남은 ${queue.remaining}개가 더 이상 줄지 않습니다. ` +
              `이미지를 불러오거나 저장할 수 없는 항목입니다. ` +
              `누적 ${totalProcessed} 성공 / ${totalFailed} 실패.`,
          );
          break;
        }
        previousRemaining = queue.remaining;

        // Pipeline: fetch all images in parallel, then embed sequentially (model
        // is single-stream), then save all in parallel. Fetch + save overlap
        // with the GPU work for the next/previous step.
        const batchStart = Date.now();
        const fetchPromises = queue.items.map(async (item) => {
          try {
            const res = await fetch(`/api/admin/embedding-image/${item.id}`, {
              cache: "no-store",
            });
            if (!res.ok) return null;
            return { id: item.id, blob: await res.blob() };
          } catch {
            return null;
          }
        });

        const savePromises: Promise<unknown>[] = [];

        // Flag an item that can't be fetched/embedded so the server queue stops
        // returning it. Without this, broken images loop forever.
        const markFailed = (productId: string, reason: string) =>
          savePromises.push(
            fetch("/api/admin/save-embedding", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ productId, failed: true, reason }),
            }).catch(() => {}),
          );

        for (let i = 0; i < queue.items.length; i += 1) {
          if (clipCancelRef.current) break;
          const fetched = await fetchPromises[i]!;
          if (!fetched) {
            totalFailed += 1;
            markFailed(queue.items[i]!.id, "image fetch failed");
            continue;
          }
          try {
            const embedding = await embedImageBlob(fetched.blob);
            savePromises.push(
              fetch("/api/admin/save-embedding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId: fetched.id, embedding }),
              })
                .then((r) => {
                  if (!r.ok) totalFailed += 1;
                  else totalProcessed += 1;
                })
                .catch(() => {
                  totalFailed += 1;
                }),
            );
          } catch {
            totalFailed += 1;
            markFailed(fetched.id, "embed failed");
          }

          // Update UI without waiting for save
          setClipProgress({
            processed: totalProcessed,
            remaining: Math.max(0, queue.remaining - i - 1),
          });
        }

        await Promise.all(savePromises);

        const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
        const speed = (queue.items.length / Math.max(0.1, Number(elapsed))).toFixed(
          1,
        );
        setClipMessage(
          `배치 ${queue.items.length}개 ${elapsed}초 (${speed}개/초). 누적 ${totalProcessed} 성공 / ${totalFailed} 실패. 남은 약 ${queue.remaining - queue.items.length}개.`,
        );
      }

      if (clipCancelRef.current) {
        setClipMessage(`중지했습니다. 누적 처리 ${totalProcessed}개`);
      }
    } catch (error) {
      setClipMessage(
        error instanceof Error
          ? `중단: ${error.message} (누적 ${totalProcessed}개) — 다시 누르면 이어서 진행됩니다.`
          : "중단되었습니다.",
      );
    } finally {
      setClipRunning(false);
      void refreshClipCompletion();
    }
  }, [clipRunning, refreshClipCompletion]);

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      const file = imageFileFromDataTransfer(event.clipboardData);

      if (!file) {
        return;
      }

      event.preventDefault();
      void storeImageFile(file, activeUploadSide);
    };

    window.addEventListener("paste", handler);

    return () => window.removeEventListener("paste", handler);
  }, [activeUploadSide, storeImageFile]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target) && event.key !== "Escape") {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setReplaceCandidate(null);
        setDeleteModal(null);
        clearUploadedImages();
        setMessage("이미지와 선택을 초기화했습니다.");
        return;
      }

      if (event.key === "Enter") {
        if (isNativeCommandTarget(event.target)) {
          return;
        }

        if (!selectedCandidate || imageProcessing) {
          return;
        }

        event.preventDefault();
        requestSaveCandidate(selectedCandidate);
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        const candidate = candidates[Number(event.key) - 1];

        if (!candidate) {
          return;
        }

        event.preventDefault();
        setSelectedCandidateId(candidate.cardId);
        setMessage(`${event.key}번 후보를 선택했습니다. Enter로 연결합니다.`);
      }
    };

    window.addEventListener("keydown", handler);

    return () => window.removeEventListener("keydown", handler);
  }, [candidates, selectedCandidate, requestSaveCandidate, clearUploadedImages, imageProcessing]);

  const fetchCandidates = useCallback(async (nextOffset: number) => {
    const params = buildPhotoCardFilterParams();
    params.set("limit", "50");
    params.set("offset", String(nextOffset));

    params.set("registrationStatus", registrationStatus);

    const response = await fetch(`/api/inventory/photo-card-candidates?${params}`);
    const data = (await response.json().catch(() => null)) as CandidateResponse | null;

    if (!response.ok || !data) {
      throw new Error(data?.error ?? "후보 조회에 실패했습니다.");
    }

    return data;
  }, [buildPhotoCardFilterParams, registrationStatus]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);

      try {
        const data = await fetchCandidates(0);

        if (!active) {
          return;
        }

        // Facets (dropdown options) always reflect the current filter.
        setFacets(data.facets);

        // Always show the text-filtered list immediately as the baseline — even
        // with a photo uploaded — so changing the member/filters narrows the
        // visible candidates right away instead of lingering on the previous
        // filter's cards. When a photo is present the auto image-match (longer
        // debounce, so it always lands after this) then re-ranks the same set by
        // visual similarity.
        setCandidates(data.candidates);
        setHasMore(data.paging.hasMore);
        setOffset(data.paging.limit);
        setIsImageResult(false);
        setSelectedCandidateId((current) =>
          current && data.candidates.some((candidate) => candidate.cardId === current)
            ? current
            : data.candidates[0]?.cardId ?? null,
        );
        // Don't wipe the image-match status line while a photo is uploaded.
        if (!frontImageUrlRef.current) {
          setMessage("");
        }
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : "후보 조회에 실패했습니다.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }, candidateFetchDebounceMs);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // Intentionally NOT depending on frontImageUrl: uploading/clearing a photo
    // must not re-fetch & re-sort the list (that made a just-connected card jump
    // to a new position right when the user wanted to tweak its stock). The list
    // refreshes on filter/reloadTick changes; the image-match re-ranks on its own.
  }, [fetchCandidates, reloadTick]);

  useEffect(() => {
    frontImageUrlRef.current = frontImageUrl;
  }, [frontImageUrl]);

  // Keep a ref to the latest suggestByImage so the auto-trigger effect can call
  // it without re-subscribing on every render.
  useEffect(() => {
    suggestByImageRef.current = suggestByImage;
  });

  // Auto image-match: once a photo is uploaded and at least one filter
  // (member/group/album/version) is set, run the real CLIP match automatically —
  // no button press — and re-run when the photo or filters change. A filter is
  // required so we never auto-trigger the slow full-catalog scan. Debounced; the
  // upload embedding is cached so re-runs across filter changes stay fast.
  useEffect(() => {
    if (!frontImageUrl) {
      return;
    }

    const hasFilter = Boolean(
      member.trim() || group.trim() || album.trim() || version.trim(),
    );
    if (!hasFilter) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (imageMatchBusyRef.current) {
        // A match is already running; mark a re-run with the latest inputs.
        imageMatchPendingRef.current = true;
        return;
      }
      suggestByImageRef.current?.();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [frontImageUrl, member, group, album, version]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setR2PendingLoading(true);
      setR2PendingError("");

      try {
        const count = await fetchR2PendingCount();

        if (!active) {
          return;
        }

        setR2PendingCount(count);
      } catch (error) {
        if (active) {
          setR2PendingError(
            error instanceof Error ? error.message : "R2 전송 대기 건수 조회에 실패했습니다.",
          );
        }
      } finally {
        if (active) {
          setR2PendingLoading(false);
        }
      }
    }, candidateFetchDebounceMs);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fetchR2PendingCount, reloadTick]);

  async function loadMore() {
    setLoading(true);

    try {
      const nextOffset = offset;
      const data = await fetchCandidates(nextOffset);
      setCandidates((current) => [...current, ...data.candidates]);
      setFacets(data.facets);
      setHasMore(data.paging.hasMore);
      setOffset(nextOffset + data.paging.limit);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "후보 조회에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleImageChange(
    event: React.ChangeEvent<HTMLInputElement>,
    side: UploadSide,
  ) {
    const file = event.currentTarget.files?.[0] ?? null;

    if (!file) {
      if (side === "front") {
        setFrontFile(null);
        setFrontImageUrl(null);
      } else {
        setBackImageUrl(null);
      }
      return;
    }

    await storeImageFile(file, side);
  }

  async function suggestByImage() {
    if (!frontFile && !frontImageUrl) {
      setMessage("앞면 이미지를 먼저 업로드해 주세요.");
      return;
    }

    imageMatchBusyRef.current = true;
    const requestFilters = {
      group: group.trim(),
      member: member.trim(),
      album: album.trim(),
      version: version.trim(),
    };
    const requestFilterSignature = JSON.stringify([
      normalizeCandidateMetadata(requestFilters.group),
      normalizeCandidateMetadata(requestFilters.member),
      normalizeCandidateMetadata(requestFilters.album),
      normalizeCandidateMetadata(requestFilters.version),
    ]);

    const uploadBlob = frontImageUrl
      ? dataUrlToBlob(frontImageUrl)
      : frontFile!;
    const uploadName = frontFile
      ? frontFile.name.replace(/\.[^.]+$/, "") + ".jpg"
      : "upload.jpg";

    setLoading(true);
    setMessage("이미지로 후보를 추천 중입니다.");

    // Compute the CLIP embedding for the uploaded image so it can be compared
    // against the candidates' embeddings. Load the model on demand (cached by
    // the browser after the first run) instead of skipping when it isn't ready —
    // otherwise search silently falls back to hashes and misses most cards.
    // Reuse a previously computed embedding for the same photo so re-running on
    // a filter change (auto-match) doesn't pay the embedding cost again.
    let clipEmbedding: number[] | null =
      frontImageUrl && frontClipCacheRef.current?.url === frontImageUrl
        ? frontClipCacheRef.current.embedding
        : null;
    let clipEmbeddingError: string | null = null;
    if (!clipEmbedding) {
      try {
        const { isClipReady, loadClip, embedImageBlob } = await import(
          "@/lib/clipBrowser"
        );
        if (!isClipReady()) {
          setMessage("AI 이미지 모델 준비 중... (최초 1회만 다운로드, 이후 즉시)");
          await loadClip();
        }
        clipEmbedding = await embedImageBlob(uploadBlob);
        if (clipEmbedding && frontImageUrl) {
          frontClipCacheRef.current = { url: frontImageUrl, embedding: clipEmbedding };
        }
        setMessage("이미지로 후보를 추천 중입니다.");
      } catch (error) {
        clipEmbeddingError =
          error instanceof Error ? error.message : "AI 이미지 모델을 불러오지 못했습니다.";
      }
    }

    const formData = new FormData();
    formData.set("uploaded_front_image", uploadBlob, uploadName);
    if (requestFilters.group) formData.set("group", requestFilters.group);
    if (requestFilters.member) formData.set("member", requestFilters.member);
    if (requestFilters.album) formData.set("album", requestFilters.album);
    if (requestFilters.version) formData.set("version", requestFilters.version);
    if (clipEmbedding) formData.set("clip_embedding", JSON.stringify(clipEmbedding));
    if (debugSku.trim()) formData.set("debug_sku", debugSku.trim());

    setDebugResult(null);

    try {
      const response = await fetch("/api/inventory/image-match", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => null)) as
        | {
            candidates?: ImageMatchCandidate[];
            error?: string;
            debug?: DebugDiagnosis | null;
            upload_has_clip?: boolean;
            blocked_reason?: string;
          }
        | null;

      if (!response.ok || !data) {
        throw new Error(data?.error ?? "이미지 후보 추천에 실패했습니다.");
      }

      if (imageFilterSignatureRef.current !== requestFilterSignature) {
        imageMatchPendingRef.current = true;
        return;
      }

      const clipActive = Boolean(data.upload_has_clip ?? clipEmbedding);

      if (data.debug) {
        setDebugResult(describeDebug(data.debug, clipActive));
      }

      if (data.blocked_reason === "clip_unavailable" || !clipActive) {
        setCandidates([]);
        setSelectedCandidateId(null);
        setHasMore(false);
        setIsImageResult(true);
        setImageVisibleCount(imageResultPageSize);
        setMessage(
          "AI 이미지 모델이 준비되지 않아 후보를 표시하지 않았습니다. " +
            "해시만으로는 오답이 많아서 차단했습니다. " +
            `모델 다운로드가 끝난 뒤 다시 누르세요${clipEmbeddingError ? ` (${clipEmbeddingError})` : ""}.`,
        );
        return;
      }

      const imageCandidates = (data.candidates ?? [])
        .map((item) => item.product)
        .filter((item): item is NonNullable<ImageMatchCandidate["product"]> =>
          Boolean(item),
        )
        .filter((item) => candidateMatchesSelectedMetadata(item, requestFilters))
        .map((item) => ({
          cardId: item.id,
          id: item.id,
          sku: item.sku,
          title: item.productName,
          groupName: item.brand,
          memberName: item.optionName,
          albumName: item.category,
          versionName: item.productName,
          existingImageUrl: item.imageUrl,
          currentImageUrl: item.imageUrl,
          sourceImageUrl: null,
          imageSource: null,
          userFrontImageUrl: null,
          userBackImageUrl: null,
          userFrontR2Key: null,
          userBackR2Key: null,
          stockQuantity: item.stockQuantity ?? null,
          salePrice: item.salePrice ?? null,
          ebayPrice: item.ebayPrice ?? null,
          featuredMembers: item.featuredMembers ?? null,
          userImageRegistered: false,
          hasBackImage: false,
          imageScore: item.finalScore ?? item.similarity ?? 0,
        }));

      setCandidates(imageCandidates);
      setSelectedCandidateId(imageCandidates[0]?.cardId ?? null);
      setHasMore(false);
      setIsImageResult(true);
      setImageVisibleCount(imageResultPageSize);
      setMessage(
        imageCandidates.length
          ? `이미지 후보 ${imageCandidates.length}개. AI 임베딩과 지문 검증을 함께 사용했습니다.`
          : requestFilters.group || requestFilters.member
            ? "선택한 그룹·멤버 안에서 일치 후보를 찾지 못했습니다. 정확한 그룹과 멤버를 확인해 주세요."
            : "신뢰할 수 있는 이미지 후보가 없습니다. 그룹과 멤버를 선택하면 해당 범위에서 더 정확히 찾습니다.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지 후보 추천에 실패했습니다.");
    } finally {
      setLoading(false);
      imageMatchBusyRef.current = false;
      // A filter changed while we were matching → run once more with the latest.
      if (imageMatchPendingRef.current) {
        imageMatchPendingRef.current = false;
        suggestByImageRef.current?.();
      }
    }
  }

  async function registerNewCard() {
    if (!frontImageUrl) {
      setMessage("앞면 이미지를 먼저 업로드해 주세요.");
      return;
    }

    // Product name follows the standard convention "그룹 앨범 멤버"; the 상품명
    // field is just an optional override when the auto-built name isn't enough.
    const productName = regName.trim() || composedRegName;
    if (!productName) {
      setMessage("그룹/앨범/멤버 중 하나 이상을 입력하거나 상품명을 직접 입력해 주세요.");
      return;
    }

    const trimmedPrice = regPrice.trim();
    if (trimmedPrice !== "") {
      const parsedPrice = Number(trimmedPrice);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        setMessage("달러 가격은 0 이상의 숫자여야 합니다.");
        return;
      }
    }

    setRegistering(true);
    setMessage("새 카드를 등록하는 중입니다...");

    try {
      const response = await fetch("/api/inventory/register-photo-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: regSku.trim() || null,
          productName,
          group: regGroup.trim() || null,
          member: regMember.trim() || null,
          album: regAlbum.trim() || null,
          ebayPrice: trimmedPrice || null,
          frontImageUrl,
          backImageUrl: backImageUrl ?? null,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { product?: { id: string; sku: string; stockQuantity: number }; error?: string }
        | null;

      if (!response.ok || !data?.product) {
        throw new Error(data?.error ?? "새 카드 등록에 실패했습니다.");
      }

      const newId = data.product.id;

      // Immediately compute and save the CLIP embedding for the new card so it's
      // searchable right away (reuse the model already loaded in the browser).
      try {
        const { loadClip, embedImageBlob } = await import("@/lib/clipBrowser");
        await loadClip();
        const embedding = await embedImageBlob(dataUrlToBlob(frontImageUrl));
        await fetch("/api/admin/save-embedding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: newId, embedding }),
        });
      } catch {
        // best-effort — the embedding batch will pick it up otherwise
      }

      setMessage(
        `✅ 새 카드 등록 완료: ${data.product.sku} (재고 ${data.product.stockQuantity}개)`,
      );
      setShowRegister(false);
      setRegSku("");
      setRegName("");
      setRegGroup("");
      setRegMember("");
      setRegAlbum("");
      setRegPrice("");
      void refreshClipCompletion();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "새 카드 등록에 실패했습니다.");
    } finally {
      setRegistering(false);
    }
  }

  function resetFilters() {
    setGroup("");
    setMember("");
    setAlbum("");
    setVersion("");
    setKeyword("");
    setRegistrationStatus("all");
    window.localStorage.removeItem(storageKey);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">촬영본 카드 연결</h1>
          <p className="mt-1 text-sm text-zinc-600">
            사진을 올리고 멤버/그룹을 고르면 닮은 카드를 자동으로 찾아 비슷한 순서로 정렬합니다. 맞는 카드를 골라 촬영본을 저장하세요.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/products"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            <ArrowLeft className="h-4 w-4" />
            상품으로
          </Link>
          <Link
            href={newProductHref}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" />새 카드 등록
          </Link>
        </div>
      </div>

      <section className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 lg:grid-cols-[220px_220px_1fr]">
        <ImageInput
          inputKey={`front-${uploadResetKey}`}
          label="앞면 이미지"
          side="front"
          active={activeUploadSide === "front"}
          dragging={dragSide === "front"}
          value={frontImageUrl}
          onFocusSide={setActiveUploadSide}
          onDragSide={setDragSide}
          onDropFile={(file) => storeImageFile(file, "front")}
          onChange={(event) => handleImageChange(event, "front")}
        />
        <ImageInput
          inputKey={`back-${uploadResetKey}`}
          label="뒷면 이미지"
          side="back"
          active={activeUploadSide === "back"}
          dragging={dragSide === "back"}
          value={backImageUrl}
          onFocusSide={setActiveUploadSide}
          onDragSide={setDragSide}
          onDropFile={(file) => storeImageFile(file, "back")}
          onChange={(event) => handleImageChange(event, "back")}
        />
        <div className="grid content-end gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={continuousMode}
              onChange={(event) => setContinuousMode(event.currentTarget.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            연속 등록
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={clearUploadedImages}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <Upload className="h-4 w-4" />
              다음 카드 업로드
            </button>
            <button
              type="button"
              onClick={suggestByImage}
              disabled={loading || imageProcessing || (!frontFile && !frontImageUrl)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              이미지로 후보 추천
            </button>
            <button
              type="button"
              onClick={() =>
                setShowRegister((current) => {
                  const next = !current;
                  // When opening, prefill the new-card fields from the current
                  // filter values so the common case stays one click.
                  if (next) {
                    setRegGroup((value) => value || group.trim());
                    setRegMember((value) => value || member.trim());
                    setRegAlbum((value) => value || album.trim());
                  }
                  return next;
                })
              }
              disabled={!frontImageUrl}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              이 사진으로 새 카드 등록
            </button>
          </div>
          {showRegister ? (
            <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-900">
                DB에 없는 카드면, 올린 사진 그대로 새 재고로 등록합니다 (재고 1, 자동 임베딩).
              </p>
              <input
                value={regSku}
                onChange={(event) => setRegSku(event.currentTarget.value)}
                placeholder="SKU (비워두면 다음 번호 자동 생성)"
                className="h-9 w-full rounded-md border border-emerald-300 px-2 text-sm outline-none focus:border-emerald-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={regGroup}
                  onChange={(event) => setRegGroup(event.currentTarget.value)}
                  placeholder="그룹명"
                  className="h-9 w-full rounded-md border border-emerald-300 px-2 text-sm outline-none focus:border-emerald-500"
                />
                <input
                  value={regAlbum}
                  onChange={(event) => setRegAlbum(event.currentTarget.value)}
                  placeholder="앨범명"
                  className="h-9 w-full rounded-md border border-emerald-300 px-2 text-sm outline-none focus:border-emerald-500"
                />
                <input
                  value={regMember}
                  onChange={(event) => setRegMember(event.currentTarget.value)}
                  placeholder="멤버"
                  className="h-9 w-full rounded-md border border-emerald-300 px-2 text-sm outline-none focus:border-emerald-500"
                />
                <input
                  value={regPrice}
                  onChange={(event) => setRegPrice(event.currentTarget.value)}
                  onBlur={() => setRegPrice((value) => normalizeDollarPrice(value))}
                  inputMode="decimal"
                  placeholder="달러 가격 (예: 6 → 6.49)"
                  className="h-9 w-full rounded-md border border-emerald-300 px-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <input
                value={regName}
                onChange={(event) => setRegName(event.currentTarget.value)}
                placeholder="상품명 (비워두면 eBay 제목 형식으로 자동 생성)"
                className="h-9 w-full rounded-md border border-emerald-300 px-2 text-sm outline-none focus:border-emerald-500"
              />
              <p className="text-xs text-emerald-800">
                상품명: {regName.trim() || composedRegName || "(그룹/앨범/멤버를 입력하세요)"}
              </p>
              <button
                type="button"
                onClick={() => void registerNewCard()}
                disabled={registering || (!regName.trim() && !composedRegName)}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {registering ? "등록 중..." : "등록하기"}
              </button>
            </div>
          ) : null}
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
            <label className="block text-xs font-semibold text-amber-900">
              🔎 진단용 SKU (정답 카드가 왜 안 뜨는지 확인)
            </label>
            <input
              value={debugSku}
              onChange={(event) => setDebugSku(event.currentTarget.value)}
              placeholder="정답 카드 SKU 입력 후 '이미지로 후보 추천' 클릭"
              className="mt-1 h-9 w-full rounded-md border border-amber-300 px-2 text-sm outline-none focus:border-amber-500"
            />
            {debugResult ? (
              <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-amber-950">
                {debugResult}
              </pre>
            ) : null}
          </div>
          {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <AutocompleteFilter
            id="photo-card-group"
            label="그룹"
            value={group}
            options={facets.groups}
            onChange={(value) => {
              setGroup(value);
              setMember("");
            }}
          />
          <AutocompleteFilter
            id="photo-card-member"
            label="멤버"
            value={member}
            options={facets.members}
            cacheKey={group}
            onChange={setMember}
          />
          <AutocompleteFilter
            id="photo-card-album"
            label="앨범"
            value={album}
            options={facets.albums}
            onChange={setAlbum}
          />
          <AutocompleteFilter
            id="photo-card-version"
            label="버전/특전처"
            value={version}
            options={facets.versions}
            onChange={setVersion}
          />
          <label className="block">
            <span className="text-sm font-medium text-zinc-800">키워드</span>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.currentTarget.value)}
                placeholder="SKU, 제목, 메모"
                className="h-11 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-base outline-none focus:border-zinc-900"
              />
            </div>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-md border border-zinc-300 bg-white p-1 text-sm">
            {([
              ["pending", "등록 전만"],
              ["all", "전체"],
              ["registered", "등록 완료만"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setRegistrationStatus(value)}
                aria-pressed={registrationStatus === value}
                className={`rounded px-3 py-1.5 font-medium transition-colors ${
                  registrationStatus === value
                    ? "bg-emerald-700 text-white"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            <RotateCcw className="h-4 w-4" />
            필터 초기화
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-sky-950">
              이미지 매칭 기본 지문 생성 (해시/색상/ORB)
            </p>
            <p className="text-sm text-sky-900">
              후보 이미지의 해시, 색상 히스토그램, ORB 유사 지문을 미리 채웁니다.
              먼저 이 작업을 끝낸 뒤 아래 AI 임베딩을 다시 돌리는 순서가 가장 안정적입니다.
            </p>
            <p className="text-sm text-sky-900">
              진행 상황:{" "}
              <span className="font-semibold">
                스캔 {fingerprintProgress.scanned.toLocaleString()}건 · 갱신{" "}
                {fingerprintProgress.updated.toLocaleString()}건 · 실패{" "}
                {fingerprintProgress.failed.toLocaleString()}건 · 건너뜀{" "}
                {fingerprintProgress.skipped.toLocaleString()}건
                {fingerprintProgress.remaining !== null
                  ? ` · 남음 ${fingerprintProgress.remaining.toLocaleString()}건`
                  : ""}
              </span>
            </p>
            {fingerprintProgress.clipFailed > 0 ? (
              <p className="text-sm text-sky-800">
                서버 CLIP 실패 {fingerprintProgress.clipFailed.toLocaleString()}건. 아래
                브라우저 AI 임베딩 배치가 다시 처리합니다.
              </p>
            ) : null}
            {fingerprintProgress.failed > 0 ? (
              <p className="text-sm text-sky-800">
                이미지 다운로드 또는 디코딩 실패 {fingerprintProgress.failed.toLocaleString()}건.
                깨진 이미지 URL을 수정한 뒤 실패 항목 재시도를 누르세요.
              </p>
            ) : null}
            {fingerprintMessage ? (
              <p className="text-sm text-sky-700">{fingerprintMessage}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startFingerprintRebuild()}
              disabled={fingerprintRunning}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {fingerprintRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {fingerprintRunning ? "처리 중..." : "기본 지문 만들기 시작"}
            </button>
            {fingerprintRunning ? (
              <button
                type="button"
                onClick={stopFingerprintRebuild}
                className="inline-flex h-10 items-center rounded-md border border-rose-300 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50"
              >
                중지
              </button>
            ) : null}
            {!fingerprintRunning && fingerprintProgress.failed > 0 ? (
              <button
                type="button"
                onClick={() => void retryFingerprintFailures()}
                className="inline-flex h-10 items-center rounded-md border border-sky-300 bg-white px-3 text-sm font-medium text-sky-800 hover:bg-sky-100"
              >
                실패 항목 재시도
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-violet-200 bg-violet-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-violet-950">
              이미지 매칭 정확도 향상 (CLIP 임베딩 일괄 생성)
            </p>
            <p className="text-sm text-violet-900">
              모든 상품 이미지에 AI 임베딩을 만들어 후보 추천 정확도를 크게 올립니다.
              <strong> GPU 가속</strong>이 가능한 브라우저면 3000개 기준 <strong>5~10분</strong>,
              CPU만 쓰면 30~60분 정도 걸립니다. 첫 실행 시 모델 100MB 다운로드 후 캐시됩니다.
            </p>
            {clipCompletion ? (
              <div className="rounded-md border border-violet-300 bg-white px-3 py-2 text-sm">
                <p className="font-semibold text-violet-950">
                  임베딩 완료 {clipCompletion.embedded.toLocaleString()} /{" "}
                  {clipCompletion.total.toLocaleString()}건
                  {clipCompletion.total > 0
                    ? ` (${Math.round(
                        (clipCompletion.embedded / clipCompletion.total) * 100,
                      )}%)`
                    : ""}
                </p>
                <p className="text-violet-800">
                  남은 {clipCompletion.remaining.toLocaleString()}건
                  {clipCompletion.failed > 0
                    ? ` · 실패 ${clipCompletion.failed.toLocaleString()}건`
                    : ""}
                  {clipCompletion.remaining === 0 && clipCompletion.failed === 0
                    ? " · ✅ 전부 완료"
                    : ""}
                </p>
              </div>
            ) : null}
            <p className="text-sm text-violet-900">
              진행 상황:{" "}
              <span className="font-semibold">
                처리 {clipProgress.processed}개
                {clipProgress.remaining !== null
                  ? ` · 남음 ${clipProgress.remaining}개`
                  : ""}
              </span>
            </p>
            {clipMessage ? (
              <p className="text-sm text-violet-700">{clipMessage}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startClipRebuild()}
              disabled={clipRunning}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {clipRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {clipRunning ? "처리 중..." : "AI 임베딩 만들기 시작"}
            </button>
            {clipRunning ? (
              <button
                type="button"
                onClick={stopClipRebuild}
                className="inline-flex h-10 items-center rounded-md border border-rose-300 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50"
              >
                중지
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-zinc-950">촬영본 R2 일괄 전송</p>
            <p className="text-sm text-zinc-600">
              필터 조건에 맞는 등록 촬영본 중 R2 키가 없는 건을 한 번에 업로드합니다.
            </p>
            <p className="text-sm text-zinc-700">
              대기:{" "}
              <span className="font-semibold text-zinc-950">
                {r2PendingCount ?? "-"}건
              </span>
            </p>
            {r2PendingError ? (
              <p className="text-xs text-rose-700">{r2PendingError}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refreshR2PendingCount()}
              disabled={r2PendingLoading || r2BulkUploading}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {r2PendingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              대기건수 새로고침
            </button>
            <button
              type="button"
              onClick={() => void startR2BulkUpload()}
              disabled={
                r2BulkUploading ||
                r2PendingLoading ||
                !r2PendingCount ||
                r2PendingCount <= 0
              }
              className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {r2BulkUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              촬영본을 R2로 전송하기
            </button>
            {r2BulkUploading ? (
              <button
                type="button"
                onClick={stopR2BulkUpload}
                className="inline-flex h-10 items-center rounded-md border border-rose-300 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50"
              >
                전송 중지
              </button>
            ) : null}
          </div>
        </div>

        {(r2BulkUploading || r2BulkProgress.processed > 0) && r2BulkProgress.total > 0 ? (
          <div className="mt-3 space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-zinc-900 transition-all"
                style={{ width: `${r2BulkProgressPercent}%` }}
              />
            </div>
            <p className="text-xs text-zinc-600">
              진행률 {r2BulkProgressPercent}% ({r2BulkProgress.processed}/
              {r2BulkProgress.total}) · 성공 {r2BulkProgress.success} · 실패{" "}
              {r2BulkProgress.failed} · 남은 {r2BulkProgress.remaining}
            </p>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-700">
            후보 {candidates.length}개
          </p>
          {loading ? (
            <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              조회 중
            </p>
          ) : null}
        </div>

        {candidates.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(isImageResult ? candidates.slice(0, imageVisibleCount) : candidates).map((candidate, index) => (
              <CandidateCard
                key={candidate.cardId}
                index={index}
                candidate={candidate}
                completedPreview={completedPreviews[candidate.cardId]}
                selected={selectedCandidateId === candidate.cardId}
                saving={savingId === candidate.cardId}
                canSave={Boolean(frontImageUrl) && savingId === null && !imageProcessing}
                deletingTarget={deletingTarget}
                stockAdjusting={stockAdjustingId === candidate.cardId}
                stockBusy={stockAdjustingId !== null}
                ebayPriceSaving={ebayPriceSavingId === candidate.cardId}
                isUnit={(candidate.memberName ?? "").trim().toLowerCase() === "unit"}
                memberOptions={groupMembers[(candidate.groupName ?? "").trim()] ?? []}
                featuredMembersSaving={featuredMembersSavingId === candidate.cardId}
                onSelect={() => setSelectedCandidateId(candidate.cardId)}
                onPreview={() => setPreviewCandidate(candidate)}
                onSave={() => requestSaveCandidate(candidate)}
                onStockCommit={(nextStock) => void commitStock(candidate, nextStock)}
                onEbayPriceSave={(value) => void saveEbayPrice(candidate, value)}
                onFeaturedMembersSave={(members) =>
                  void saveFeaturedMembers(candidate, members)
                }
                onDelete={(side) => requestDeleteR2Images(candidate, side)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <Camera className="mx-auto h-8 w-8 text-zinc-400" />
            <p className="mt-3 text-sm text-zinc-600">조건에 맞는 후보 카드가 없습니다.</p>
            <Link
              href={newProductHref}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              <Plus className="h-4 w-4" />
              새 카드로 등록
            </Link>
          </div>
        )}

        {isImageResult && candidates.length > imageVisibleCount ? (
          <button
            type="button"
            onClick={() => setImageVisibleCount((current) => current + imageResultPageSize)}
            className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            더 보기 ({imageVisibleCount}/{candidates.length})
          </button>
        ) : null}

        {!isImageResult && hasMore ? (
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            더 보기
          </button>
        ) : null}
      </section>

      {previewCandidate ? (
        <ImageCompareModal
          candidate={previewCandidate}
          frontImageUrl={frontImageUrl}
          onClose={() => setPreviewCandidate(null)}
        />
      ) : null}

      {deleteModal ? (
        <ConfirmDeleteR2Modal
          candidate={deleteModal.candidate}
          side={deleteModal.side}
          loading={deletingTarget === `${deleteModal.candidate.cardId}:${deleteModal.side}`}
          onCancel={() => setDeleteModal(null)}
          onConfirm={() => {
            const target = deleteModal;
            setDeleteModal(null);
            void deleteR2Images(target.candidate, target.side);
          }}
        />
      ) : null}

      {replaceCandidate ? (
        <ConfirmReplaceModal
          candidate={replaceCandidate}
          onCancel={() => setReplaceCandidate(null)}
          onConfirm={() => void saveCandidate(replaceCandidate)}
        />
      ) : null}
    </div>
  );
}

// Whole-number dollar inputs auto-fill the standard .49 ending: "3" → "3.49",
// "6" → "6.49". Anything already containing a decimal (or empty) is left as-is.
function normalizeDollarPrice(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return `${trimmed}.49`;
  }
  return trimmed;
}

function CandidateCard({
  index,
  candidate,
  completedPreview,
  selected,
  saving,
  canSave,
  deletingTarget,
  stockAdjusting,
  stockBusy,
  ebayPriceSaving,
  isUnit,
  memberOptions,
  featuredMembersSaving,
  onSelect,
  onPreview,
  onSave,
  onStockCommit,
  onEbayPriceSave,
  onFeaturedMembersSave,
  onDelete,
}: {
  index: number;
  candidate: Candidate;
  completedPreview?: CompletedPreview;
  selected: boolean;
  saving: boolean;
  canSave: boolean;
  deletingTarget: string | null;
  stockAdjusting: boolean;
  stockBusy: boolean;
  ebayPriceSaving: boolean;
  isUnit: boolean;
  memberOptions: string[];
  featuredMembersSaving: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onSave: () => void;
  onStockCommit: (nextStock: number) => void;
  onEbayPriceSave: (value: string) => void;
  onFeaturedMembersSave: (members: string[]) => void;
  onDelete: (side: DeleteSide) => void;
}) {
  const [priceInput, setPriceInput] = useState(
    candidate.ebayPrice != null ? String(candidate.ebayPrice) : "",
  );
  // Apply the .49 rule, reflect it in the field, and save — but only when the
  // value actually changed, so leaving the field (blur) doesn't re-PATCH a price
  // that's already saved.
  const commitPrice = () => {
    const normalized = normalizeDollarPrice(priceInput);
    if (normalized !== priceInput) {
      setPriceInput(normalized);
    }
    const currentSaved = candidate.ebayPrice != null ? String(candidate.ebayPrice) : "";
    if (normalized === currentSaved) {
      return;
    }
    onEbayPriceSave(normalized);
  };
  const currentStock = candidate.stockQuantity ?? 0;
  const [stockInput, setStockInput] = useState(String(currentStock));
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStockInput(String(candidate.stockQuantity ?? 0));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [candidate.stockQuantity]);
  const selectedMembers = (candidate.featuredMembers ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const registered = candidate.userImageRegistered || Boolean(completedPreview);
  const hasFrontR2 = Boolean(candidate.userFrontR2Key);
  const hasBackR2 = Boolean(candidate.userBackR2Key);
  const displayImageUrl = registered
    ? (completedPreview?.frontImageUrl ?? candidate.userFrontImageUrl ?? candidate.existingImageUrl)
    : candidate.existingImageUrl;

  return (
    <article
      onClick={onSelect}
      className={`cursor-pointer rounded-lg border bg-white p-3 transition ${
        selected
          ? "border-zinc-950 ring-2 ring-zinc-950/10"
          : "border-zinc-200 hover:border-zinc-400"
      }`}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onPreview();
        }}
        className="group relative block aspect-[3/4] w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
      >
        {displayImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayImageUrl}
            alt={candidate.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-400">
            <ImageIcon className="h-7 w-7" />
          </div>
        )}
        {index < 9 ? (
          <span className="absolute left-2 top-2 rounded-md bg-zinc-950 px-2 py-1 text-xs font-semibold text-white">
            {index + 1}
          </span>
        ) : null}
        {registered ? (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">
            <Camera className="h-3 w-3" />
            촬영본
          </span>
        ) : null}
        <span className="absolute bottom-2 right-2 rounded-md bg-white/90 p-1 text-zinc-700 opacity-0 shadow-sm transition group-hover:opacity-100">
          <Maximize2 className="h-4 w-4" />
        </span>
      </button>
      <div className="mt-3 space-y-1 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-zinc-950">{candidate.sku}</p>
          <StatusBadge candidate={candidate} completedPreview={completedPreview} />
        </div>
        {registered ? (
          <p className="text-xs font-semibold text-emerald-700">촬영본 연결 완료</p>
        ) : null}
        <p className="line-clamp-2 text-zinc-800">{candidate.title}</p>
        <p className="text-zinc-600">그룹: {candidate.groupName ?? "-"}</p>
        <p className="text-zinc-600">멤버: {candidate.memberName ?? "-"}</p>
        <p className="text-zinc-600">앨범: {candidate.albumName ?? "-"}</p>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-zinc-600">가격 기준</span>
          {candidate.salePrice != null ? (
            <span className="font-semibold text-violet-700">
              포카마켓 {candidate.salePrice.toLocaleString("ko-KR")}원
            </span>
          ) : candidate.ebayPrice != null ? (
            <span className="font-semibold text-emerald-700">
              수동 입력 ${candidate.ebayPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </span>
          ) : (
            <span className="font-medium text-amber-700">가격 없음</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="whitespace-nowrap text-zinc-600">재고</span>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStockCommit(currentStock - 1);
              }}
              disabled={stockBusy || currentStock <= 0}
              aria-label="재고 1 감소"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <input
              value={stockInput}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setStockInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onStockCommit(Number(stockInput));
                }
              }}
              onBlur={() => {
                if (stockInput.trim() !== "" && Number(stockInput) !== currentStock) {
                  onStockCommit(Number(stockInput));
                }
              }}
              type="number"
              min="0"
              disabled={stockBusy}
              aria-label="재고 수량"
              title="숫자를 입력하고 Enter로 현재고를 바로 변경합니다"
              className="h-7 w-14 rounded-md border border-zinc-300 px-2 text-center text-xs outline-none focus:border-zinc-900 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStockCommit(currentStock + 1);
              }}
              disabled={stockBusy}
              aria-label="재고 1 증가"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {stockAdjusting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="whitespace-nowrap text-zinc-600">달러 가격 $</span>
          <div className="inline-flex items-center gap-1">
            <input
              value={priceInput}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setPriceInput(event.currentTarget.value)}
              onBlur={commitPrice}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  // 버튼 없이 Enter만으로 저장. 정수면 .49 자동 부착.
                  // stopPropagation으로 전역 Enter 핸들러(후보 연결)와의 충돌도 차단.
                  event.preventDefault();
                  event.stopPropagation();
                  commitPrice();
                }
              }}
              type="number"
              min="0"
              step="0.01"
              placeholder="예: 6 → 6.49"
              title="숫자만 입력하면 자동으로 .49가 붙고, 칸을 벗어나면 저장됩니다 (예: 6 → 6.49)"
              className="h-7 w-24 rounded-md border border-zinc-300 px-2 text-xs outline-none focus:border-zinc-900"
            />
            {ebayPriceSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
            ) : null}
          </div>
        </div>
        {isUnit ? (
          <div
            onClick={(event) => event.stopPropagation()}
            className="rounded-md border border-amber-200 bg-amber-50 p-2"
          >
            <p className="mb-1 text-xs font-semibold text-amber-800">
              유닛 — 포함 멤버 지정
            </p>
            {selectedMembers.length ? (
              <div className="mb-1 flex flex-wrap gap-1">
                {selectedMembers.map((member) => (
                  <span
                    key={member}
                    className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-xs text-zinc-800 ring-1 ring-amber-200"
                  >
                    {member}
                    <button
                      type="button"
                      onClick={() =>
                        onFeaturedMembersSave(
                          selectedMembers.filter((name) => name !== member),
                        )
                      }
                      disabled={featuredMembersSaving}
                      aria-label={`${member} 제거`}
                      className="text-zinc-400 hover:text-rose-600 disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mb-1 text-xs text-amber-700">아직 지정된 멤버가 없습니다.</p>
            )}
            <div className="flex items-center gap-1">
              <select
                value=""
                onChange={(event) => {
                  const picked = event.currentTarget.value;
                  if (picked && !selectedMembers.includes(picked)) {
                    onFeaturedMembersSave([...selectedMembers, picked]);
                  }
                  event.currentTarget.value = "";
                }}
                disabled={featuredMembersSaving || memberOptions.length === 0}
                className="h-7 flex-1 rounded-md border border-amber-300 bg-white px-2 text-xs outline-none focus:border-amber-500 disabled:opacity-50"
              >
                <option value="">
                  {memberOptions.length ? "+ 멤버 추가" : "그룹 멤버 불러오는 중…"}
                </option>
                {memberOptions
                  .filter((member) => !selectedMembers.includes(member))
                  .map((member) => (
                    <option key={member} value={member}>
                      {member}
                    </option>
                  ))}
              </select>
              {featuredMembersSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
              ) : null}
            </div>
          </div>
        ) : null}
        <p className="text-xs text-zinc-500">
          R2 상태: front {hasFrontR2 ? "등록" : "없음"} / back{" "}
          {hasBackR2 ? "등록" : "없음"}
        </p>
        {candidate.imageScore !== undefined ? (
          <p className="text-xs text-zinc-500">
            이미지 참고 점수 {Math.round(candidate.imageScore * 100)}%
          </p>
        ) : null}
      </div>
      {completedPreview ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniPreview src={completedPreview.frontImageUrl} label="저장된 앞면" />
          <MiniPreview src={completedPreview.backImageUrl} label="저장된 뒷면" />
        </div>
      ) : null}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onSave();
        }}
        disabled={saving || !canSave}
        className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Check className="h-4 w-4" />
        {saving ? "저장 중" : registered ? "촬영본 교체" : "이 카드로 연결"}
      </button>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete("front");
          }}
          disabled={!hasFrontR2 || deletingTarget !== null}
          className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deletingTarget === `${candidate.cardId}:front` ? "삭제 중" : "앞면 삭제"}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete("back");
          }}
          disabled={!hasBackR2 || deletingTarget !== null}
          className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deletingTarget === `${candidate.cardId}:back` ? "삭제 중" : "뒷면 삭제"}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete("all");
          }}
          disabled={(!hasFrontR2 && !hasBackR2) || deletingTarget !== null}
          className="h-8 rounded-md border border-rose-300 bg-white px-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deletingTarget === `${candidate.cardId}:all` ? "삭제 중" : "전체 삭제"}
        </button>
      </div>
    </article>
  );
}

function StatusBadge({
  candidate,
  completedPreview,
}: {
  candidate: Candidate;
  completedPreview?: CompletedPreview;
}) {
  const registered = candidate.userImageRegistered || Boolean(completedPreview);
  const hasBack = candidate.hasBackImage || Boolean(completedPreview?.backImageUrl);

  if (!registered) {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-700">
        미등록
      </span>
    );
  }

  return (
    <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
      {hasBack ? "앞/뒤 등록 완료" : "앞면만 등록"}
    </span>
  );
}

function ImageCompareModal({
  candidate,
  frontImageUrl,
  onClose,
}: {
  candidate: Candidate;
  frontImageUrl: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="max-h-full w-full max-w-6xl overflow-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">{candidate.sku}</h2>
            <p className="mt-1 text-sm text-zinc-600">{candidate.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <LargePreview title="업로드한 앞면" src={frontImageUrl} />
          <LargePreview title="DB 후보 이미지" src={candidate.existingImageUrl} />
        </div>
      </div>
    </div>
  );
}

function LargePreview({ title, src }: { title: string; src: string | null }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-zinc-700">{title}</p>
      <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={title} className="max-h-[75vh] w-full object-contain" />
        ) : (
          <div className="text-sm text-zinc-400">이미지 없음</div>
        )}
      </div>
    </div>
  );
}

function deleteActionLabel(side: DeleteSide) {
  if (side === "front") {
    return "R2 앞면 파일";
  }

  if (side === "back") {
    return "R2 뒷면 파일";
  }

  return "R2 앞/뒷면 파일 전체";
}

function ConfirmDeleteR2Modal({
  candidate,
  side,
  loading,
  onCancel,
  onConfirm,
}: {
  candidate: Candidate;
  side: DeleteSide;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const actionLabel = deleteActionLabel(side);
  const previewItems =
    side === "front"
      ? [{ label: "앞면", src: candidate.userFrontImageUrl }]
      : side === "back"
        ? [{ label: "뒷면", src: candidate.userBackImageUrl }]
        : [
            { label: "앞면", src: candidate.userFrontImageUrl },
            { label: "뒷면", src: candidate.userBackImageUrl },
          ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-950">{actionLabel} 삭제</h2>
            <p className="text-sm text-zinc-600">
              {candidate.sku} 파일을 삭제합니다.
            </p>
            <p className="text-sm font-medium text-rose-700">
              R2 버킷의 실제 파일도 삭제됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {previewItems.map((item) => (
            <div key={item.label}>
              <p className="mb-1 text-xs font-medium text-zinc-500">{item.label}</p>
              <MiniPreview src={item.src} label={item.label} />
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            삭제 실행
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmReplaceModal({
  candidate,
  onCancel,
  onConfirm,
}: {
  candidate: Candidate;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <h2 className="text-base font-semibold text-zinc-950">촬영본 교체 확인</h2>
              <p className="mt-2 text-sm text-zinc-600">
                이미 촬영본이 연결된 카드입니다. {candidate.sku} 촬영본을 새 이미지로
                교체할까요?
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            교체 저장
          </button>
        </div>
      </div>
    </div>
  );
}

function AutocompleteFilter({
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

  useEffect(() => {
    if (draft === value) {
      return;
    }

    // Clearing a filter should immediately reveal the cached options. Waiting
    // for the normal typing debounce made switching members feel unresponsive.
    if (!draft.trim()) {
      onChange("");
      return;
    }

    const timer = window.setTimeout(() => onChange(draft), 300);
    return () => window.clearTimeout(timer);
  }, [draft, onChange, value]);

  // When the input still contains the currently selected option, opening the
  // combobox is a request to switch choices, so show the full list instead of
  // filtering it down to the one selected member.
  const selectedOptionIsDisplayed =
    draft === value && knownOptions.some((option) => option === value);
  const normalizedDraft = selectedOptionIsDisplayed
    ? ""
    : draft.trim().toLocaleLowerCase();
  const visibleOptions = knownOptions
    .filter((option) =>
      normalizedDraft ? option.toLocaleLowerCase().includes(normalizedDraft) : true,
    )
    .slice(0, 100);

  return (
    <div className="relative block">
      <label htmlFor={id} className="text-sm font-medium text-zinc-800">
        {label}
      </label>
      <input
        id={id}
        value={draft}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 100)}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setOpen(true);
        }}
        placeholder={`${label} 입력`}
        className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
      />
      {open && visibleOptions.length ? (
        <div className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg">
          {visibleOptions.map((option) => (
            <button
              key={option}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setDraft(option);
                onChange(option);
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ImageInput({
  inputKey,
  label,
  side,
  active,
  dragging,
  value,
  onFocusSide,
  onDragSide,
  onDropFile,
  onChange,
}: {
  inputKey: string;
  label: string;
  side: UploadSide;
  active: boolean;
  dragging: boolean;
  value: string | null;
  onFocusSide: (side: UploadSide) => void;
  onDragSide: (side: UploadSide | null) => void;
  onDropFile: (file: File) => void;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-800">{label}</span>
      <input
        key={inputKey}
        type="file"
        accept="image/*"
        onFocus={() => onFocusSide(side)}
        onClick={() => onFocusSide(side)}
        onChange={onChange}
        className="mt-2 block w-full text-sm text-zinc-700 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:text-sm file:font-semibold file:text-white"
      />
      <div
        tabIndex={0}
        onFocus={() => onFocusSide(side)}
        onClick={() => onFocusSide(side)}
        onDragEnter={(event) => {
          event.preventDefault();
          onDragSide(side);
          onFocusSide(side);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          onDragSide(side);
        }}
        onDragLeave={() => onDragSide(null)}
        onDrop={(event) => {
          event.preventDefault();
          onDragSide(null);
          onFocusSide(side);
          const file = imageFileFromDataTransfer(event.dataTransfer);

          if (file) {
            onDropFile(file);
          }
        }}
        className={`mt-3 aspect-[3/4] overflow-hidden rounded-md border bg-zinc-50 outline-none ${
          active ? "border-zinc-950 ring-2 ring-zinc-950/10" : "border-zinc-200"
        } ${dragging ? "bg-emerald-50" : ""}`}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-zinc-400">
            <Upload className="h-5 w-5" />
            <span>업로드 / 드롭 / Ctrl+V</span>
          </div>
        )}
      </div>
    </label>
  );
}

function MiniPreview({ src, label }: { src: string | null; label: string }) {
  return (
    <div className="aspect-[3/4] overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-zinc-400">
          {label}
        </div>
      )}
    </div>
  );
}

function imageFileFromDataTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return null;
  }

  const file = Array.from(dataTransfer.files).find((entry) =>
    entry.type.startsWith("image/"),
  );

  if (file) {
    return file;
  }

  return (
    Array.from(dataTransfer.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .find((entry): entry is File => Boolean(entry?.type.startsWith("image/"))) ??
    null
  );
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  return target instanceof HTMLInputElement && target.type !== "file";
}

function isNativeCommandTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && ["BUTTON", "A"].includes(target.tagName);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",", 2);

  if (!header || !data) {
    return new Blob();
  }

  const mime = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const rawDataUrl = String(reader.result);

      try {
        const image = await loadImage(rawDataUrl);
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
          resolve(rawDataUrl);
          return;
        }

        canvas.width = width;
        canvas.height = height;
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      } catch {
        resolve(rawDataUrl);
      }
    };
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    image.src = src;
  });
}
