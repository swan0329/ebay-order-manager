"use client";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
type Group = {
  key: string;
  groupName: string;
  albumName: string;
  versionName: string;
  count: number;
  productIds: string[];
  previewUrls: string[];
  truncated: boolean;
};
type Result = { key: string; name: string; url: string };
export function VariationThumbnailBuilder() {
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [logo, setLogo] = useState("");
  const [logoName, setLogoName] = useState("");
  const [logoSaving, setLogoSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [watermarkText, setWatermarkText] = useState("");
  const [opacity, setOpacity] = useState(0.06);
  const [logoSize, setLogoSize] = useState(50);
  const [watermarkGap, setWatermarkGap] = useState(25);
  const [applyToIndividualCards, setApplyToIndividualCards] = useState(true);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewZoomed, setPreviewZoomed] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(async () => {
      const r = await fetch(
        `/api/listing-upload/variation-thumbnail?mode=groups&q=${encodeURIComponent(q)}`,
      );
      const b = await r.json();
      if (r.ok) setGroups(b.groups ?? []);
      else setError(b.error || "앨범 묶음을 불러오지 못했습니다.");
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    void fetch("/api/listing-upload/variation-thumbnail/logo")
      .then((r) => r.json())
      .then((b) => {
        if (b.logoUrl) {
          setLogo(b.logoUrl);
          setLogoName("저장된 계정 로고");
        }
        setWatermarkText(b.watermarkText ?? "");
        setOpacity(Number(b.watermarkOpacity ?? 0.06));
        setLogoSize(Number(b.watermarkLogoSize ?? 50));
        setWatermarkGap(Number(b.watermarkGap ?? 25));
        setApplyToIndividualCards(b.applyToIndividualCards ?? true);
      })
      .catch(() => {});
  }, []);
  const chosen = useMemo(
    () => groups.filter((g) => selected.includes(g.key)),
    [groups, selected],
  );
  useEffect(() => {
    const group = chosen[0];
    if (!group || (!logo && !watermarkText.trim())) {
      const clearTimer = setTimeout(() => setPreview(null), 0);
      return () => clearTimeout(clearTimer);
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const r = await fetch("/api/listing-upload/variation-thumbnail", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            groupName: group.groupName,
            albumName: `${group.albumName} · ${group.versionName}`,
            productIds: group.productIds,
            watermarkText,
            watermarkLogoDataUrl: logo.startsWith("data:") ? logo : undefined,
            watermarkOpacity: opacity,
            watermarkLogoSize: logoSize,
            watermarkGap,
            previewOnly: true,
          }),
        });
        const b = await r.json();
        if (r.ok) setPreview(b.dataUrl);
        else setError(b.error || "미리보기 생성 실패");
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError"))
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPreviewing(false);
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [chosen, logo, watermarkText, opacity, logoSize, watermarkGap]);
  function toggle(key: string) {
    setSelected([key]);
    setPreview(null);
    setResults([]);
    setError(null);
  }
  function readLogo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== "image/png" || f.size > 2_000_000) {
      setError("로고는 2MB 이하 PNG 파일을 사용해 주세요.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setLogoSaving(true);
      setError(null);
      try {
        const dataUrl = String(reader.result ?? "");
        const r = await fetch("/api/listing-upload/variation-thumbnail/logo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dataUrl, fileName: f.name }),
        });
        const b = await r.json();
        if (!r.ok) throw new Error(b.error || "로고 저장 실패");
        setLogo(b.logoUrl);
        setLogoName(f.name);
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        setLogoSaving(false);
      }
    };
    reader.readAsDataURL(f);
  }
  async function saveSettings() {
    setSettingsSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/listing-upload/variation-thumbnail/logo", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          watermarkText: watermarkText.trim() || null,
          watermarkOpacity: opacity,
          watermarkLogoSize: logoSize,
          watermarkGap,
          applyToIndividualCards,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "워터마크 설정 저장 실패");
      setWatermarkText(b.watermarkText ?? "");
      setOpacity(Number(b.watermarkOpacity));
      setLogoSize(Number(b.watermarkLogoSize));
      setWatermarkGap(Number(b.watermarkGap));
      setApplyToIndividualCards(Boolean(b.applyToIndividualCards));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettingsSaving(false);
    }
  }
  async function generate() {
    if (!chosen.length) return;
    setLoading(true);
    setError(null);
    setResults([]);
    const made: Result[] = [];
    try {
      for (const g of chosen) {
        const r = await fetch("/api/listing-upload/variation-thumbnail", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            groupName: g.groupName,
            albumName: `${g.albumName} · ${g.versionName}`,
            productIds: g.productIds,
            watermarkText,
            watermarkLogoDataUrl: logo.startsWith("data:") ? logo : undefined,
            watermarkOpacity: opacity,
            watermarkLogoSize: logoSize,
            watermarkGap,
          }),
        });
        const b = await r.json();
        if (!r.ok)
          throw new Error(
            `${g.groupName} / ${g.albumName}: ${b.error || "생성 실패"}`,
          );
        made.push({
          key: g.key,
          name: `${g.groupName} · ${g.albumName} · ${g.versionName}`,
          url: b.url,
        });
        setResults([...made]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[.65fr_1.35fr]">
      <section className="rounded-xl border bg-white p-4">
        <div>
          <h2 className="font-semibold">자동 분류된 그룹·앨범 버전</h2>
          <p className="text-xs text-zinc-500">
            그룹명, 앨범명, 앨범 버전이 같은 카드를 하나로 묶고 멤버는 구분하지
            않습니다.
          </p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="그룹명, 앨범명, 버전 검색"
          className="mt-3 h-10 w-full rounded-md border px-3 text-sm"
        />
        <div className="mt-3 max-h-[720px] space-y-2 overflow-y-auto">
          {groups.map((g) => (
            <button
              key={g.key}
              onClick={() => toggle(g.key)}
              className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left ${selected.includes(g.key) ? "border-violet-600 bg-violet-50 ring-1 ring-violet-200" : "border-zinc-200"}`}
            >
              <span className="grid w-32 shrink-0 grid-cols-4 gap-0.5">
                {g.previewUrls.slice(0, 4).map((url, i) => (
                  <span
                    key={i}
                    className="aspect-[2/3] overflow-hidden bg-zinc-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </span>
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm">
                  {g.groupName}
                </strong>
                <span className="block truncate text-xs text-zinc-700">
                  {g.albumName}
                </span>
                <span className="block truncate text-xs text-zinc-500">
                  버전: {g.versionName} · 멤버는 함께 묶음
                </span>
              </span>
              <span className="text-xs font-semibold text-zinc-500">
                {g.count}장
                {g.truncated && (
                  <>
                    <br />
                    <em className="not-italic text-amber-600">앞 40장</em>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">로고와 생성 설정</h2>
        <p className="mt-1 text-xs text-zinc-500">
          선택한 {chosen.length}개 앨범의 제목과 카드가 자동 입력됩니다.
        </p>
        <div className="mt-4">
          <p className="text-xs font-medium">
            쇼핑몰 PNG 로고 · 계정에 자동 저장
          </p>
          <label className="mt-2 flex h-11 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-violet-300 bg-violet-50 text-sm font-semibold text-violet-800 hover:bg-violet-100">
            {logoSaving ? "로고 저장 중…" : "PNG 로고 선택 또는 교체"}
            <input
              type="file"
              accept="image/png"
              onChange={readLogo}
              disabled={logoSaving}
              className="sr-only"
            />
          </label>
        </div>
        {logo ? (
          <div className="mt-3 rounded-lg border border-violet-200 bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:16px_16px] p-3">
            <p className="mb-2 rounded bg-white/80 px-2 py-1 text-[11px] text-emerald-700">
              계정에 저장됨 · {logoName}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logo}
              alt="워터마크 로고 미리보기"
              className="mx-auto max-h-28 max-w-full object-contain"
            />
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-zinc-500">
            투명 배경 PNG를 권장합니다. 한 번 저장하면 다음 접속부터 자동으로
            불러옵니다.
          </p>
        )}
        <label className="mt-3 block text-xs font-medium">
          로고가 없을 때 워터마크 문구
          <input
            value={watermarkText}
            onChange={(e) => setWatermarkText(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
            placeholder="쇼핑몰 이름"
          />
        </label>
        <label className="mt-3 block text-xs font-medium">
          투명도 {Math.round(opacity * 100)}%
          <input
            type="range"
            min=".03"
            max=".3"
            step=".01"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </label>
        <label className="mt-3 block text-xs font-medium">
          반복 로고 크기 {logoSize}px
          <input
            type="range"
            min="35"
            max="180"
            step="5"
            value={logoSize}
            onChange={(e) => setLogoSize(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </label>
        <label className="mt-3 block text-xs font-medium">
          로고 사이 간격 {watermarkGap}px
          <input
            type="range"
          min="0"
          max="180"
            step="5"
            value={watermarkGap}
            onChange={(e) => setWatermarkGap(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </label>
        <label className="mt-3 flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950">
          <input
            type="checkbox"
            checked={applyToIndividualCards}
            onChange={(e) => setApplyToIndividualCards(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <b>개별 카드 판매 사진에도 워터마크 적용</b>
            <br />
            원본 사진은 보존되고 Shopify에 전송하는 판매용 복사본에만
            적용됩니다.
          </span>
        </label>
        <button
          type="button"
          disabled={settingsSaving}
          onClick={() => void saveSettings()}
          className="mt-3 h-10 w-full rounded-md border border-violet-700 bg-white text-sm font-semibold text-violet-800 disabled:opacity-50"
        >
          {settingsSaving
            ? "자동 적용 설정 저장 중…"
            : "이 설정을 자동 등록·이미지 교체에 저장"}
        </button>
        <p className="mt-1 text-[11px] text-zinc-500">
          저장 후 Shopify ‘이미지·썸네일 교체’ 목록에 나타난 항목을 전송하면
          기존 사진도 새 워터마크로 바뀝니다.
        </p>
        <div className="mt-4 overflow-auto rounded-lg border bg-zinc-50 p-3">
          <div className="mb-2 flex min-w-[1000px] items-center justify-between gap-2">
            <p className="text-xs font-semibold">
              자동 미리보기{" "}
              {chosen[0]
                ? `· ${chosen[0].groupName} / ${chosen[0].albumName} / ${chosen[0].versionName}`
                : ""}
            </p>
            {preview && (
              <button
                type="button"
                onClick={() => setPreviewZoomed(true)}
                className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white"
              >
                크게 보기
              </button>
            )}
          </div>
          {previewing ? (
            <div className="flex h-[1000px] w-[1000px] items-center justify-center text-sm text-zinc-500">
              미리보기 만드는 중…
            </div>
          ) : preview ? (
            /* eslint-disable-next-line @next/next/no-img-element */ <img
              src={preview}
              onClick={() => setPreviewZoomed(true)}
              alt="자동 썸네일 미리보기"
              className="h-[1000px] w-[1000px] max-w-none cursor-zoom-in rounded border object-contain shadow-sm"
            />
          ) : (
            <div className="flex h-[1000px] w-[1000px] items-center justify-center px-6 text-center text-sm text-zinc-400">
              앨범 묶음과 PNG 로고를 선택하면 자동으로 표시됩니다.
            </div>
          )}
        </div>
        {error && (
          <p className="mt-3 rounded bg-red-50 p-3 text-xs text-red-700">
            {error}
          </p>
        )}
        <button
          disabled={
            loading || !chosen.length || (!logo && !watermarkText.trim())
          }
          onClick={generate}
          className="mt-4 h-11 w-full rounded-md bg-violet-600 text-sm font-semibold text-white disabled:bg-zinc-300"
        >
          {loading ? "R2 저장 중…" : "현재 앨범 버전 썸네일 R2에 저장"}
        </button>
        <div className="mt-4 space-y-4">
          {results.map((r) => (
            <div key={r.key}>
              <p className="mb-1 text-xs font-semibold">{r.name}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.url}
                alt={r.name}
                className="w-full rounded-lg border"
              />
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-violet-700 underline"
              >
                1000×1000 원본 열기
              </a>
            </div>
          ))}
        </div>
      </section>
      {previewZoomed && preview && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewZoomed(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-full max-w-full flex-col rounded-xl bg-white p-3 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setPreviewZoomed(false)}
              className="absolute right-5 top-5 z-10 rounded-full bg-black/75 px-4 py-2 text-sm font-semibold text-white"
            >
              닫기
            </button>
            <div className="max-h-[calc(100vh-5rem)] overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="1000×1000 확대 미리보기"
                className="h-auto w-[min(1000px,90vw)] max-w-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
