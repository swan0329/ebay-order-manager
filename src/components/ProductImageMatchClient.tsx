"use client";

import {
  ArrowLeft,
  Check,
  ExternalLink,
  Image as ImageIcon,
  Search,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type UploadedImages = {
  frontImageUrl: string;
  backImageUrl: string | null;
};

type Candidate = {
  id: string;
  sku: string;
  productName: string;
  optionName: string | null;
  category: string | null;
  brand: string | null;
  imageUrl: string | null;
  finalScore: number;
  hashDistance: number;
  orbMatchCount: number;
  homographyInliers: number;
};

type SearchResponse = {
  upload: UploadedImages;
  candidates: Candidate[];
  confidentCandidate?: boolean;
  error?: string;
};

type ConfirmResponse = {
  product?: {
    id: string;
    sku: string;
    productName: string;
    optionName: string | null;
  };
  error?: string;
};

const googleLensUrl = "https://lens.google.com/";

export function ProductImageMatchClient() {
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] = useState<UploadedImages | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  function resetResults() {
    setUploadedImages(null);
    setCandidates([]);
    setMessage("");
  }

  function handlePreviewChange(
    event: React.ChangeEvent<HTMLInputElement>,
    setter: (value: string | null) => void,
  ) {
    const file = event.currentTarget.files?.[0];
    setter(file ? URL.createObjectURL(file) : null);
    resetResults();
  }

  async function searchCandidates(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const frontImage = formData.get("frontImage");

    if (!(frontImage instanceof File) || frontImage.size === 0) {
      setMessage("앞면 이미지를 선택해 주세요.");
      return;
    }

    setSearching(true);
    setMessage("해시와 특징점으로 DB 이미지를 비교 중입니다.");

    try {
      const response = await fetch("/api/inventory/image-match", {
        method: "POST",
        body: formData,
      });
      const raw = (await response.json().catch(() => null)) as
        | (SearchResponse & {
            candidates?: Array<Candidate | { product?: Candidate }>;
          })
        | null;

      if (!response.ok || !raw) {
        throw new Error(raw?.error ?? "이미지 매칭에 실패했습니다.");
      }

      const normalizedCandidates = (raw.candidates ?? []).map((candidate) =>
        "product" in candidate && candidate.product ? candidate.product : candidate,
      ) as Candidate[];

      setUploadedImages(raw.upload);
      setCandidates(normalizedCandidates);
      setMessage(
        normalizedCandidates.length
          ? raw.confidentCandidate === false
            ? "후보는 찾았지만 확실한 후보는 없습니다. 점수를 보고 직접 선택해 주세요."
            : `후보 ${normalizedCandidates.length}개를 찾았습니다.`
          : "확실한 후보가 없습니다.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지 매칭에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  }

  async function confirmCandidate(candidate: Candidate) {
    if (!uploadedImages) {
      setMessage("먼저 이미지를 검색해 주세요.");
      return;
    }

    setConfirmingId(candidate.id);
    setMessage("선택한 상품에 이미지를 연결 중입니다.");

    try {
      const response = await fetch("/api/inventory/confirm-image-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_id: candidate.id,
          uploaded_front_image_url: uploadedImages.frontImageUrl,
          uploaded_back_image_url: uploadedImages.backImageUrl,
          matchConfidence: candidate.finalScore,
        }),
      });
      const data = (await response.json().catch(() => null)) as ConfirmResponse | null;

      if (!response.ok || !data?.product) {
        throw new Error(data?.error ?? "이미지 연결에 실패했습니다.");
      }

      setMessage(`${data.product.sku} 상품 이미지가 저장되었습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지 연결에 실패했습니다.");
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">포토카드 이미지 매칭</h1>
          <p className="mt-1 text-sm text-zinc-600">
            pHash, dHash, aHash로 후보를 줄이고 특징점 매칭 점수로 같은 카드를 찾습니다.
          </p>
        </div>
        <Link
          href="/products"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
        >
          <ArrowLeft className="h-4 w-4" />
          상품으로
        </Link>
      </div>

      <form
        onSubmit={searchCandidates}
        className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 lg:grid-cols-[280px_280px_1fr]"
      >
        <label className="block">
          <span className="text-sm font-medium text-zinc-800">앞면 이미지</span>
          <input
            name="frontImage"
            type="file"
            accept="image/*"
            onChange={(event) => handlePreviewChange(event, setFrontPreview)}
            className="mt-2 block w-full text-sm text-zinc-700 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:text-sm file:font-semibold file:text-white"
          />
          <PreviewImage src={frontPreview} label="앞면 미리보기" />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-zinc-800">뒷면 이미지</span>
          <input
            name="backImage"
            type="file"
            accept="image/*"
            onChange={(event) => handlePreviewChange(event, setBackPreview)}
            className="mt-2 block w-full text-sm text-zinc-700 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:text-sm file:font-semibold file:text-white"
          />
          <PreviewImage src={backPreview} label="뒷면 미리보기" />
        </label>

        <div className="flex flex-col justify-end gap-3">
          <button
            type="submit"
            disabled={searching}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Search className="h-4 w-4" />
            {searching ? "검색 중" : "DB에서 찾기"}
          </button>
          <a
            href={googleLensUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            <ExternalLink className="h-4 w-4" />
            Google Lens
          </a>
          {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
        </div>
      </form>

      {candidates.length ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {candidates.map((candidate) => (
            <article
              key={candidate.id}
              className="rounded-lg border border-zinc-200 bg-white p-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <PreviewImage src={uploadedImages?.frontImageUrl ?? frontPreview} label="업로드" />
                <PreviewImage src={candidate.imageUrl} label="DB 이미지" />
              </div>
              <div className="mt-4 space-y-1 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-zinc-950">{candidate.sku}</p>
                  <p className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">
                    {formatScore(candidate.finalScore)}
                  </p>
                </div>
                <p className="line-clamp-2 text-zinc-800">{candidate.productName}</p>
                <p className="text-zinc-600">그룹: {candidate.brand ?? "-"}</p>
                <p className="text-zinc-600">멤버/옵션: {candidate.optionName ?? "-"}</p>
                <p className="text-zinc-600">앨범/분류: {candidate.category ?? "-"}</p>
                <p className="text-xs text-zinc-500">
                  hash {candidate.hashDistance.toFixed(1)} · ORB{" "}
                  {candidate.orbMatchCount} · inlier {candidate.homographyInliers}
                </p>
              </div>
              <button
                type="button"
                onClick={() => confirmCandidate(candidate)}
                disabled={Boolean(confirmingId)}
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                {confirmingId === candidate.id ? "저장 중" : "이 상품에 저장"}
              </button>
            </article>
          ))}
        </section>
      ) : (
        <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
          <ImageIcon className="mx-auto h-8 w-8 text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-600">이미지를 올리면 후보 상품이 여기에 표시됩니다.</p>
        </section>
      )}
    </div>
  );
}

function PreviewImage({ src, label }: { src: string | null | undefined; label: string }) {
  return (
    <div className="mt-3 aspect-[3/4] overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-zinc-400">
          <Upload className="mr-2 h-4 w-4" />
          {label}
        </div>
      )}
    </div>
  );
}

function formatScore(value: number) {
  return `${Math.round(value * 100)}%`;
}
