"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  Image as ImageIcon,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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

type CompletedPreview = {
  frontImageUrl: string;
  backImageUrl: string | null;
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
  const [group, setGroup] = useState("");
  const [member, setMember] = useState("");
  const [album, setAlbum] = useState("");
  const [version, setVersion] = useState("");
  const [keyword, setKeyword] = useState("");
  const [facets, setFacets] = useState<Facets>(emptyFacets);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [continuousMode, setContinuousMode] = useState(true);
  const [uploadResetKey, setUploadResetKey] = useState(0);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [completedPreviews, setCompletedPreviews] = useState<
    Record<string, CompletedPreview>
  >({});
  const [replaceCandidate, setReplaceCandidate] = useState<Candidate | null>(null);
  const [message, setMessage] = useState("");

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
    if (!filtersLoaded) {
      return;
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ group, member, album, version }),
    );
  }, [filtersLoaded, group, member, album, version]);

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

    const response = await fetch(`/api/inventory/photo-card-candidates?${params}`);
    const data = (await response.json().catch(() => null)) as CandidateResponse | null;

    if (!response.ok || !data) {
      throw new Error(data?.error ?? "후보 조회에 실패했습니다.");
    }

    return data;
  }, [group, member, album, version, keyword]);

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
    side: "front" | "back",
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

    const dataUrl = await fileToDataUrl(file);

    if (side === "front") {
      setFrontFile(file);
      setFrontImageUrl(dataUrl);
    } else {
      setBackImageUrl(dataUrl);
    }
  }

  function requestSaveCandidate(candidate: Candidate) {
    if (candidate.userImageRegistered) {
      setReplaceCandidate(candidate);
      return;
    }

    void saveCandidate(candidate);
  }

  async function saveCandidate(candidate: Candidate) {
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
        | { product?: { sku: string }; error?: string }
        | null;

      if (!response.ok || !data?.product) {
        throw new Error(data?.error ?? "촬영본 저장에 실패했습니다.");
      }

      setCandidates((current) =>
        current.map((item) =>
          item.cardId === candidate.cardId
            ? {
                ...item,
                userImageRegistered: true,
                hasBackImage: Boolean(savedBackImageUrl),
                currentImageUrl: savedFrontImageUrl,
              }
            : item,
        ),
      );
      setCompletedPreviews((current) => ({
        ...current,
        [candidate.cardId]: {
          frontImageUrl: savedFrontImageUrl,
          backImageUrl: savedBackImageUrl,
        },
      }));
      setMessage(`${data.product.sku} 촬영본 연결 완료`);

      if (continuousMode) {
        clearUploadedImages();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "촬영본 저장에 실패했습니다.");
    } finally {
      setSavingId(null);
    }
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
          stockQuantity: null,
          userImageRegistered: false,
          hasBackImage: false,
          imageScore: item.finalScore ?? item.similarity ?? 0,
        }));

      setCandidates(imageCandidates);
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

  function clearUploadedImages() {
    setFrontFile(null);
    setFrontImageUrl(null);
    setBackImageUrl(null);
    setUploadResetKey((current) => current + 1);
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
            href="/products/new"
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
          value={frontImageUrl}
          onChange={(event) => handleImageChange(event, "front")}
        />
        <ImageInput
          inputKey={`back-${uploadResetKey}`}
          label="뒷면 이미지"
          value={backImageUrl}
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
        <div className="mt-3 flex justify-end">
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
            {candidates.map((candidate) => (
              <CandidateCard
                key={candidate.cardId}
                candidate={candidate}
                completedPreview={completedPreviews[candidate.cardId]}
                saving={savingId === candidate.cardId}
                canSave={Boolean(frontImageUrl) && savingId === null}
                onSave={() => requestSaveCandidate(candidate)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <Camera className="mx-auto h-8 w-8 text-zinc-400" />
            <p className="mt-3 text-sm text-zinc-600">필터를 입력하면 후보 카드가 표시됩니다.</p>
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
  candidate,
  completedPreview,
  saving,
  canSave,
  onSave,
}: {
  candidate: Candidate;
  completedPreview?: CompletedPreview;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
}) {
  const registered = candidate.userImageRegistered || Boolean(completedPreview);

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="aspect-[3/4] overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
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
      </div>
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
        onClick={onSave}
        disabled={saving || !canSave}
        className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Check className="h-4 w-4" />
        {saving ? "저장 중" : registered ? "촬영본 교체" : "이 카드로 연결"}
      </button>
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
  value,
  onChange,
}: {
  inputKey: string;
  label: string;
  value: string | null;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-800">{label}</span>
      <input
        key={inputKey}
        type="file"
        accept="image/*"
        onChange={onChange}
        className="mt-2 block w-full text-sm text-zinc-700 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:text-sm file:font-semibold file:text-white"
      />
      <div className="mt-3 aspect-[3/4] overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">
            <Upload className="mr-2 h-4 w-4" />
            업로드
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

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}
