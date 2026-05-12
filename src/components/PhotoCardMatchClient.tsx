"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
    userFrontImageUrl: string | null;
    userBackImageUrl: string | null;
    userFrontR2Key: string | null;
    userBackR2Key: string | null;
    hasBackImage: boolean;
    ebayImageUrls: string[];
  };
  error?: string;
};

type CompletedPreview = {
  frontImageUrl: string;
  backImageUrl: string | null;
};

type UploadSide = "front" | "back";

type ImageMatchCandidate = {
  product?: {
    id: string;
    sku: string;
    productName: string;
    optionName: string | null;
    category: string | null;
    brand: string | null;
    imageUrl: string | null;
    finalScore?: number;
    similarity?: number;
  };
};

const emptyFacets: Facets = {
  groups: [],
  members: [],
  albums: [],
  versions: [],
};

const storageKey = "photo-card-match.recent-filters.v1";

export function PhotoCardMatchClient() {
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [frontImageUrl, setFrontImageUrl] = useState<string | null>(null);
  const [backImageUrl, setBackImageUrl] = useState<string | null>(null);
  const [activeUploadSide, setActiveUploadSide] = useState<UploadSide>("front");
  const [dragSide, setDragSide] = useState<UploadSide | null>(null);
  const [group, setGroup] = useState("");
  const [member, setMember] = useState("");
  const [album, setAlbum] = useState("");
  const [version, setVersion] = useState("");
  const [keyword, setKeyword] = useState("");
  const [includeRegistered, setIncludeRegistered] = useState(false);
  const [facets, setFacets] = useState<Facets>(emptyFacets);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [previewCandidate, setPreviewCandidate] = useState<Candidate | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
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
  const [message, setMessage] = useState("");
  const autoNextTimer = useRef<number | null>(null);

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

  const storeImageFile = useCallback(async (file: File, side: UploadSide) => {
    if (!file.type.startsWith("image/")) {
      setMessage("이미지 파일만 업로드할 수 있습니다.");
      return;
    }

    cancelAutoNext();
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
  }, [cancelAutoNext]);

  const clearUploadedImages = useCallback(() => {
    cancelAutoNext();
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
              userFrontImageUrl: string | null;
              userBackImageUrl: string | null;
              userFrontR2Key: string | null;
              userBackR2Key: string | null;
              hasBackImage: boolean;
              ebayImageUrls: string[];
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
                imageSource: savedProduct.userFrontR2Key ? "r2_user_uploaded" : "pocamarket",
                userFrontImageUrl: savedProduct.userFrontImageUrl,
                userBackImageUrl: savedProduct.userBackImageUrl,
                userFrontR2Key: savedProduct.userFrontR2Key,
                userBackR2Key: savedProduct.userBackR2Key,
              }
            : item,
        ),
      );
      setCompletedPreviews((current) => ({
        ...current,
        [candidate.cardId]: {
          frontImageUrl: savedProduct.userFrontImageUrl ?? savedFrontImageUrl,
          backImageUrl: savedProduct.userBackImageUrl ?? savedBackImageUrl,
        },
      }));
      setMessage(`${data.product.sku} 촬영본 연결 완료`);

      if (continuousMode) {
        if (autoNextTimer.current) {
          window.clearTimeout(autoNextTimer.current);
        }

        autoNextTimer.current = window.setTimeout(() => {
          autoNextTimer.current = null;
          if (!includeRegistered) {
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
  }, [frontImageUrl, backImageUrl, continuousMode, includeRegistered, clearUploadedImages]);

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

  const deleteR2Images = useCallback(
    async (candidate: Candidate, side: "front" | "back" | "all") => {
      const actionLabel =
        side === "front"
          ? "R2 앞면 파일"
          : side === "back"
            ? "R2 뒷면 파일"
            : "R2 앞/뒷면 파일 전체";

      if (
        !window.confirm(
          `${candidate.sku}\n\n${actionLabel}을(를) 삭제할까요?\nCloudflare R2 버킷의 실제 파일이 삭제됩니다.`,
        )
      ) {
        return;
      }

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
                  imageSource: data.product?.userFrontR2Key
                    ? "r2_user_uploaded"
                    : "pocamarket",
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
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "R2 이미지 삭제에 실패했습니다.");
      } finally {
        setDeletingTarget(null);
      }
    },
    [],
  );

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
        clearUploadedImages();
        setMessage("이미지와 선택을 초기화했습니다.");
        return;
      }

      if (event.key === "Enter") {
        if (isNativeCommandTarget(event.target)) {
          return;
        }

        if (!selectedCandidate) {
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
  }, [candidates, selectedCandidate, requestSaveCandidate, clearUploadedImages]);

  const fetchCandidates = useCallback(async (nextOffset: number) => {
    const params = new URLSearchParams({
      limit: "50",
      offset: String(nextOffset),
    });

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

    if (includeRegistered) {
      params.set("includeRegistered", "1");
    }

    const response = await fetch(`/api/inventory/photo-card-candidates?${params}`);
    const data = (await response.json().catch(() => null)) as CandidateResponse | null;

    if (!response.ok || !data) {
      throw new Error(data?.error ?? "후보 조회에 실패했습니다.");
    }

    return data;
  }, [group, member, album, version, keyword, includeRegistered]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);

      try {
        const data = await fetchCandidates(0);

        if (!active) {
          return;
        }

        setCandidates(data.candidates);
        setFacets(data.facets);
        setHasMore(data.paging.hasMore);
        setOffset(data.paging.limit);
        setSelectedCandidateId((current) =>
          current && data.candidates.some((candidate) => candidate.cardId === current)
            ? current
            : data.candidates[0]?.cardId ?? null,
        );
        setMessage("");
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : "후보 조회에 실패했습니다.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fetchCandidates]);

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
    if (!frontFile) {
      setMessage("앞면 이미지를 먼저 업로드해 주세요.");
      return;
    }

    const formData = new FormData();
    formData.set("uploaded_front_image", frontFile);
    setLoading(true);
    setMessage("이미지로 후보를 추천 중입니다.");

    try {
      const response = await fetch("/api/inventory/image-match", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => null)) as
        | { candidates?: ImageMatchCandidate[]; error?: string }
        | null;

      if (!response.ok || !data) {
        throw new Error(data?.error ?? "이미지 후보 추천에 실패했습니다.");
      }

      const imageCandidates = (data.candidates ?? [])
        .map((item) => item.product)
        .filter((item): item is NonNullable<ImageMatchCandidate["product"]> =>
          Boolean(item),
        )
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
          stockQuantity: null,
          userImageRegistered: false,
          hasBackImage: false,
          imageScore: item.finalScore ?? item.similarity ?? 0,
        }));

      setCandidates(imageCandidates);
      setSelectedCandidateId(imageCandidates[0]?.cardId ?? null);
      setHasMore(false);
      setMessage(
        imageCandidates.length
          ? "이미지 후보를 불러왔습니다. 점수는 참고용입니다."
          : "이미지로 찾은 후보가 없습니다.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지 후보 추천에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    setGroup("");
    setMember("");
    setAlbum("");
    setVersion("");
    setKeyword("");
    window.localStorage.removeItem(storageKey);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">촬영본 카드 연결</h1>
          <p className="mt-1 text-sm text-zinc-600">
            필터로 DB 카드를 찾고, 업로드한 앞면/뒷면 촬영본을 선택한 카드에 저장합니다.
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
              disabled={loading || !frontFile}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              이미지로 후보 추천
            </button>
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
                className="h-10 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-sm outline-none focus:border-zinc-900"
              />
            </div>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={includeRegistered}
              onChange={(event) => setIncludeRegistered(event.currentTarget.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            등록완료 카드도 보기
          </label>
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
            {candidates.map((candidate, index) => (
              <CandidateCard
                key={candidate.cardId}
                index={index}
                candidate={candidate}
                completedPreview={completedPreviews[candidate.cardId]}
                selected={selectedCandidateId === candidate.cardId}
                saving={savingId === candidate.cardId}
                canSave={Boolean(frontImageUrl) && savingId === null}
                deletingTarget={deletingTarget}
                onSelect={() => setSelectedCandidateId(candidate.cardId)}
                onPreview={() => setPreviewCandidate(candidate)}
                onSave={() => requestSaveCandidate(candidate)}
                onDelete={(side) => void deleteR2Images(candidate, side)}
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

        {hasMore ? (
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

function CandidateCard({
  index,
  candidate,
  completedPreview,
  selected,
  saving,
  canSave,
  deletingTarget,
  onSelect,
  onPreview,
  onSave,
  onDelete,
}: {
  index: number;
  candidate: Candidate;
  completedPreview?: CompletedPreview;
  selected: boolean;
  saving: boolean;
  canSave: boolean;
  deletingTarget: string | null;
  onSelect: () => void;
  onPreview: () => void;
  onSave: () => void;
  onDelete: (side: "front" | "back" | "all") => void;
}) {
  const registered = candidate.userImageRegistered || Boolean(completedPreview);
  const hasFrontR2 = Boolean(candidate.userFrontR2Key);
  const hasBackR2 = Boolean(candidate.userBackR2Key);

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
        {candidate.existingImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={candidate.existingImageUrl}
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
        <p className="text-zinc-600">재고: {candidate.stockQuantity ?? "-"}</p>
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
      <div className="mt-2 grid grid-cols-3 gap-2">
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
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-800">{label}</span>
      <input
        value={value}
        list={`${id}-options`}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={`${label} 입력`}
        className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
      />
      <datalist id={`${id}-options`}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </label>
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
