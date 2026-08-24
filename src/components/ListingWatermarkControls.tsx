"use client";

import { type ChangeEvent, useEffect, useState } from "react";

export function ListingWatermarkControls() {
  const [text, setText] = useState("");
  const [opacity, setOpacity] = useState(0.06);
  const [size, setSize] = useState(50);
  const [gap, setGap] = useState(25);
  const [individual, setIndividual] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [preview, setPreview] = useState<{
    single?: { title: string; dataUrl: string };
    collection?: { title: string; count: number; dataUrl: string };
  }>({});
  const [message, setMessage] = useState("");
  useEffect(() => {
    void fetch("/api/listing-upload/variation-thumbnail/logo")
      .then((r) => r.json())
      .then((data) => {
        setLogoUrl(data.logoUrl ?? "");
        setText(data.watermarkText ?? "");
        setOpacity(Number(data.watermarkOpacity ?? 0.06));
        setSize(Number(data.watermarkLogoSize ?? 50));
        setGap(Number(data.watermarkGap ?? 25));
        setIndividual(data.applyToIndividualCards ?? true);
      })
      .catch(() => setMessage("저장된 워터마크 설정을 불러오지 못했습니다."));
  }, []);
  function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "image/png" || file.size > 2_000_000) {
      setMessage("로고는 2MB 이하 PNG 파일만 가능합니다.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setLogoSaving(true);
      try {
        const response = await fetch(
          "/api/listing-upload/variation-thumbnail/logo",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              dataUrl: String(reader.result),
              fileName: file.name,
            }),
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "로고 저장 실패");
        setLogoUrl(data.logoUrl);
        setMessage("로고를 저장했습니다. 아래 설정도 저장해 주세요.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setLogoSaving(false);
      }
    };
    reader.readAsDataURL(file);
  }
  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        "/api/listing-upload/variation-thumbnail/logo",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            watermarkText: text.trim() || null,
            watermarkOpacity: opacity,
            watermarkLogoSize: size,
            watermarkGap: gap,
            applyToIndividualCards: individual,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "저장 실패");
      setMessage(
        "저장했습니다. 기존 Shopify 상품은 ‘변동·품단종 관리 → 이미지·썸네일 교체’에서 전송하면 새 설정으로 교체됩니다.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
  async function makePreview() {
    setPreviewing(true);
    setMessage("");
    try {
      const response = await fetch("/api/listing-upload/watermark-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          watermarkText: text.trim() || null,
          watermarkOpacity: opacity,
          watermarkLogoSize: size,
          watermarkGap: gap,
          applyToIndividualCards: individual,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "미리보기 생성 실패");
      setPreview(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewing(false);
    }
  }
  return (
    <section className="mb-5 rounded-2xl border border-violet-200 bg-violet-50 p-4">
      <h2 className="font-bold text-violet-950">판매용 워터마크 설정</h2>
      <p className="mt-1 text-xs text-violet-900">
        묶음 대표 썸네일과 Shopify 개별 카드 판매 사진에 함께 적용됩니다. 원본
        이미지는 바꾸지 않습니다.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <label className="rounded border border-violet-300 bg-white px-3 py-2 text-xs font-bold text-violet-800">
          {logoSaving ? "PNG 로고 저장 중…" : "PNG 로고 선택"}
          <input
            type="file"
            accept="image/png"
            disabled={logoSaving}
            onChange={uploadLogo}
            className="sr-only"
          />
        </label>
        {logoUrl && (
          <span className="text-xs text-emerald-700">로고 저장됨</span>
        )}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <label className="text-xs font-medium">
          문구(로고 없을 때)
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={80}
            className="mt-1 h-10 w-full rounded border bg-white px-2 text-sm"
            placeholder="쇼핑몰 이름"
          />
        </label>
        <label className="text-xs font-medium">
          투명도 {Math.round(opacity * 100)}%
          <input
            type="range"
            min=".03"
            max=".3"
            step=".01"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="mt-3 w-full"
          />
        </label>
        <label className="text-xs font-medium">
          반복 크기 {size}px
          <input
            type="range"
            min="35"
            max="220"
            step="5"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="mt-3 w-full"
          />
        </label>
        <label className="text-xs font-medium">
          반복 간격 {gap}px
          <input
            type="range"
            min="0"
            max="180"
            step="5"
            value={gap}
            onChange={(e) => setGap(Number(e.target.value))}
            className="mt-3 w-full"
          />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm font-medium text-violet-950">
        <input
          type="checkbox"
          checked={individual}
          onChange={(e) => setIndividual(e.target.checked)}
        />
        개별 카드 사진에도 워터마크 적용
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={previewing}
          onClick={() => void makePreview()}
          className="rounded-lg border border-violet-700 bg-white px-4 py-2 text-sm font-bold text-violet-800 disabled:opacity-50"
        >
          {previewing ? "샘플 생성 중…" : "현재 설정 미리보기"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "저장 중…" : "자동 적용 설정 저장"}
        </button>
        {message && <p className="text-xs text-violet-900">{message}</p>}
      </div>
      {(preview.collection || preview.single) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border bg-white p-3">
            <b className="text-sm">묶음상품 대표 이미지 샘플</b>
            {preview.collection ? (
              <>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {preview.collection.title} · {preview.collection.count}장
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.collection.dataUrl}
                  alt="묶음상품 워터마크 미리보기"
                  className="mt-2 aspect-square w-full rounded border object-contain"
                />
              </>
            ) : (
              <p className="mt-2 text-xs text-amber-700">
                2장 이상인 묶음 샘플을 찾지 못했습니다.
              </p>
            )}
          </div>
          <div className="rounded-lg border bg-white p-3">
            <b className="text-sm">개별상품 사진 샘플</b>
            {preview.single && (
              <>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {preview.single.title}
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.single.dataUrl}
                  alt="개별상품 워터마크 미리보기"
                  className="mt-2 h-auto w-full rounded border"
                />
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
