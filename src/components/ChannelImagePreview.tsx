"use client";

import Image from "next/image";
import { Eye, Loader2 } from "lucide-react";
import { useState } from "react";

export function ChannelImagePreview() {
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [registration, setRegistration] = useState<{ EBAY: boolean; SHOPIFY: boolean } | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/channel-publishing/image-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku }),
      });
      const body = await response.json() as { imageUrls?: string[]; source?: string; error?: string; registration?: { EBAY: boolean; SHOPIFY: boolean } };
      if (!response.ok || !body.imageUrls?.length) throw new Error(body.error ?? "등록 이미지를 확인하지 못했습니다.");
      setImages(body.imageUrls);
      setSource(body.source ?? "");
      setRegistration(body.registration ?? null);
    } catch (caught) {
      setImages([]);
      setRegistration(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-emerald-300 bg-white p-3">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between text-left text-sm font-semibold text-emerald-950">
        <span>상품 이미지·등록 상태 확인</span><span className="text-xs text-emerald-700">{open ? "접기" : "열기"}</span>
      </button>
      {open ? <div className="mt-3">
        <p className="mb-2 text-xs text-zinc-600">조회한 SKU가 시험등록 대상으로 선택되는 것은 아닙니다. 실제 미등록 대상은 등록 버튼을 누르면 확인할 수 있습니다.</p>
        <div className="flex flex-wrap gap-2">
          <input value={sku} onChange={(event) => setSku(event.currentTarget.value.slice(0, 100))} aria-label="등록 이미지 확인 SKU" placeholder="SKU" className="h-10 w-44 rounded-md border px-3 text-sm" />
          <button type="button" onClick={() => void load()} disabled={loading || !sku.trim()} className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-900 px-3 text-sm font-bold text-white disabled:bg-zinc-300">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}이미지 불러오기</button>
        </div>
        {registration ? <p className="mt-2 text-sm font-semibold">eBay: {registration.EBAY ? "이미 등록 완료" : "미등록"} · Shopify: {registration.SHOPIFY ? "이미 등록 완료" : "미등록"}</p> : null}
        {source ? <p className="mt-2 text-xs font-medium text-emerald-800">eBay와 Shopify가 공동으로 사용하는 중앙 워터마크 이미지입니다. 같은 원본·설정이면 기존 URL을 재사용합니다.</p> : null}
        {error ? <p className="mt-2 text-xs font-medium text-red-700">{error}</p> : null}
        {images.length ? <div className="mt-3 flex gap-3 overflow-x-auto">{images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0"><Image src={url} alt={`${sku} 등록 이미지 ${index + 1}`} width={280} height={400} unoptimized className="h-80 w-auto rounded-md border object-contain" /></a>)}</div> : null}
      </div> : null}
    </div>
  );
}
