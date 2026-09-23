"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, RefreshCw } from "lucide-react";

import { LiveVariationWatermarkCanvas } from "@/components/LiveVariationWatermarkCanvas";
import { singleWatermarkSettingLimits, variationWatermarkSettingLimits, watermarkSettingLimits } from "@/lib/watermark-setting-limits";

type Settings = {
  logoUrl: string | null;
  watermarkEnabled: boolean;
  watermarkOpacity: number;
  watermarkLogoSize: number;
  watermarkGap: number;
  variationWatermarkOpacity: number;
  variationWatermarkLogoSize: number;
  variationWatermarkGap: number;
  imageExposure: number;
  imageContrast: number;
  imageSaturation: number;
  imageRotation: number;
  imageZoom: number;
  imageFlipHorizontal: boolean;
  backgroundEnabled: boolean;
  backgroundUrl: string | null;
  backgroundPadding: number;
  backgroundColor: string;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
};

type PreviewSample = {
  sku: string;
  sampleId: string | null;
  sourceUrl?: string;
  backgroundEligible?: boolean;
};
type PreviewSamples = { imageWork: PreviewSample[]; photographed: PreviewSample[] };
type VariationPreviewGroup = { key: string; title: string; products: Array<{ id: string }>; imageWorkCount: number };

export function WatermarkSettingsPanel({ defaultOpen = false, standalone = false }: { defaultOpen?: boolean; standalone?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sku, setSku] = useState("101214");
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [backgroundEligible, setBackgroundEligible] = useState<boolean | null>(null);
  const [, setSourceUrl] = useState("");
  const [sampleSkus, setSampleSkus] = useState<{ imageWork: string | null; photographed: string | null }>({ imageWork: null, photographed: null });
  const [sampleItems, setSampleItems] = useState<PreviewSamples>({ imageWork: [], photographed: [] });
  const [selectedSample, setSelectedSample] = useState<"imageWork" | "photographed" | null>(null);
  const [sampleHistoryId, setSampleHistoryId] = useState<string | null>(null);
  const [previewSignature, setPreviewSignature] = useState("");
  const [previewMode, setPreviewMode] = useState<"single" | "variation">("single");
  const [variationGroups, setVariationGroups] = useState<VariationPreviewGroup[]>([]);
  const [variationGroupKey, setVariationGroupKey] = useState("");
  const [variationPreviewUrl, setVariationPreviewUrl] = useState("");
  const [variationWatermarkTileUrl, setVariationWatermarkTileUrl] = useState<string | null>(null);
  const [variationBusy, setVariationBusy] = useState(false);
  const [variationMessage, setVariationMessage] = useState("");
  const [message, setMessage] = useState("");
  const previewObjectUrlRef = useRef("");
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const variationWatermarkSignature = settings ? JSON.stringify({
    enabled: settings.watermarkEnabled,
    opacity: settings.variationWatermarkOpacity,
    logoSize: settings.variationWatermarkLogoSize,
    gap: settings.variationWatermarkGap,
  }) : "";
  const variationBaseRequest = settings && variationGroupKey ? JSON.stringify({ groupKey: variationGroupKey, settings: {
    imageExposure: settings.imageExposure, imageContrast: settings.imageContrast, imageSaturation: settings.imageSaturation,
    imageRotation: settings.imageRotation, imageZoom: settings.imageZoom, imageFlipHorizontal: settings.imageFlipHorizontal,
    backgroundEnabled: settings.backgroundEnabled, backgroundPadding: settings.backgroundPadding, backgroundColor: settings.backgroundColor,
    paddingTop: settings.paddingTop, paddingRight: settings.paddingRight, paddingBottom: settings.paddingBottom, paddingLeft: settings.paddingLeft,
  } }) : "";

  useEffect(() => {
    void fetch("/api/channel-publishing/image-settings", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "워터마크 설정을 불러오지 못했습니다.");
        setSettings(body.settings);
        setSampleSkus(body.sampleSkus ?? { imageWork: null, photographed: null });
        const fallbackItems: PreviewSamples = {
          imageWork: (body.sampleSkuLists?.imageWork ?? []).map((sampleSku: string) => ({ sku: sampleSku, sampleId: null })),
          photographed: (body.sampleSkuLists?.photographed ?? []).map((sampleSku: string) => ({ sku: sampleSku, sampleId: null })),
        };
        const nextItems: PreviewSamples = body.sampleItems ?? fallbackItems;
        setSampleItems(nextItems);
        if (nextItems.imageWork[0]) {
          const sample = nextItems.imageWork[0];
          setSku(sample.sku); setSampleHistoryId(sample.sampleId); setSelectedSample("imageWork");
          setSourceUrl(sample.sourceUrl ?? ""); setBackgroundEligible(sample.sourceUrl ? Boolean(sample.backgroundEligible) : null);
        } else if (nextItems.photographed[0]) {
          const sample = nextItems.photographed[0];
          setSku(sample.sku); setSampleHistoryId(sample.sampleId); setSelectedSample("photographed");
          setSourceUrl(sample.sourceUrl ?? ""); setBackgroundEligible(sample.sourceUrl ? Boolean(sample.backgroundEligible) : null);
        } else if (body.suggestedSku) setSku(body.suggestedSku);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    const selectedItem = selectedSample ? sampleItems[selectedSample].find((sample) => sample.sku === sku && sample.sampleId === sampleHistoryId) : null;
    if (selectedItem?.sourceUrl) return;
    if (!open || !sku.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/channel-publishing/image-settings?mode=source", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sku: sku.trim(), sampleHistoryId: sampleHistoryId ?? undefined }),
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json() as { sourceUrl?: string; backgroundEligible?: boolean; error?: string };
        if (!response.ok || !body.sourceUrl) throw new Error(body.error ?? "미리보기 원본을 불러오지 못했습니다.");
        setSourceUrl(body.sourceUrl);
        setBackgroundEligible(Boolean(body.backgroundEligible));
      } catch (error) {
        if (!controller.signal.aborted) setLiveMessage(error instanceof Error ? error.message : String(error));
      }
    }, 120);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, sku, sampleHistoryId, selectedSample, sampleItems]);

  useEffect(() => {
    if (!open || !settings || !sku.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const requestSignature = JSON.stringify({ sku: sku.trim(), sampleHistoryId, settings });
      setLiveBusy(true);
      setLiveMessage("");
      try {
        const response = await fetch("/api/channel-publishing/image-settings?mode=live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...settings, sku: sku.trim(), sampleHistoryId: sampleHistoryId ?? undefined }),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? "실시간 미리보기를 만들지 못했습니다.");
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const objectUrl = URL.createObjectURL(blob);
        if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = objectUrl;
        setPreviewUrl(objectUrl);
        setPreviewSignature(requestSignature);
        setBackgroundEligible(response.headers.get("x-background-eligible") === "true");
      } catch (error) {
        if (!controller.signal.aborted) setLiveMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!controller.signal.aborted) setLiveBusy(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, settings, sku, sampleHistoryId]);

  useEffect(() => {
    if (!open || previewMode !== "variation" || !variationBaseRequest) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setVariationBusy(true); setVariationMessage("");
      try {
        const response = await fetch("/api/listing-upload/variation-groups/preview", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: variationBaseRequest,
        });
        const body = await response.json() as { dataUrl?: string; imageUrl?: string; error?: string };
        const previewUrl = body.dataUrl ?? body.imageUrl;
        if (!response.ok || !previewUrl) throw new Error(body.error ?? "묶음옵션 미리보기를 만들지 못했습니다.");
        if (controller.signal.aborted) return;
        setVariationPreviewUrl(previewUrl);
      } catch (error) {
        if (!controller.signal.aborted) setVariationMessage(error instanceof Error ? error.message : String(error));
      } finally { if (!controller.signal.aborted) setVariationBusy(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, previewMode, variationBaseRequest]);

  useEffect(() => {
    if (!open || previewMode !== "variation" || !settings) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/listing-upload/variation-groups/preview/watermark", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: variationWatermarkSignature,
        });
        const body = await response.json() as { tileDataUrl?: string | null; error?: string };
        if (!response.ok) throw new Error(body.error ?? "워터마크 타일을 만들지 못했습니다.");
        if (controller.signal.aborted) return;
        setVariationWatermarkTileUrl(body.tileDataUrl ?? null);
      } catch (error) {
        if (!controller.signal.aborted) setVariationMessage(error instanceof Error ? error.message : String(error));
      }
    }, 80);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, previewMode, settings, variationWatermarkSignature]);

  const currentPreviewSignature = settings ? JSON.stringify({ sku: sku.trim(), sampleHistoryId, settings }) : "";
  const finalPreviewReady = Boolean(previewUrl && previewSignature === currentPreviewSignature);
  const uniformImageScale = settings
    ? Math.max(40, Math.min(100, Math.round(100 - ((settings.paddingTop + settings.paddingRight + settings.paddingBottom + settings.paddingLeft) / 4) / 5)))
    : 84;
  const watermarkFootprint = settings ? Math.round(settings.watermarkLogoSize * 1.25) : 63;
  const repeatPitch = settings ? Math.max(40, watermarkFootprint + settings.watermarkGap) : 88;

  function showNextSample() {
    const kind = selectedSample ?? (sampleItems.imageWork.length ? "imageWork" : "photographed");
    const choices = sampleItems[kind];
    if (!choices.length) return;
    const currentIndex = choices.findIndex((choice) => choice.sku === sku && choice.sampleId === sampleHistoryId);
    const nextSample = choices[(currentIndex + 1 + choices.length) % choices.length];
    applyPreviewSample(kind, nextSample);
  }

  async function selectPreviewMode(mode: "single" | "variation") {
    setPreviewMode(mode);
    if (mode !== "variation" || variationGroups.length) return;
    setVariationBusy(true); setVariationMessage("");
    try {
      const response = await fetch("/api/listing-upload/variation-groups", { cache: "no-store" });
      const body = await response.json() as { groups?: VariationPreviewGroup[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "묶음옵션 목록을 불러오지 못했습니다.");
      const groups = (body.groups ?? []).filter((group) => group.products.length >= 2);
      setVariationGroups(groups);
      setVariationPreviewUrl("");
      if (groups[0]) setVariationGroupKey(groups[0].key);
      else setVariationMessage("미리볼 수 있는 묶음옵션이 없습니다.");
    } catch (error) { setVariationMessage(error instanceof Error ? error.message : String(error)); }
    finally { setVariationBusy(false); }
  }

  function showNextVariationGroup() {
    if (!variationGroups.length) return;
    const index = variationGroups.findIndex((group) => group.key === variationGroupKey);
    setVariationPreviewUrl("");
    setVariationGroupKey(variationGroups[(index + 1 + variationGroups.length) % variationGroups.length].key);
  }

  function selectSampleKind(kind: "imageWork" | "photographed") {
    const sample = sampleItems[kind][0];
    if (!sample) return;
    applyPreviewSample(kind, sample);
  }

  function applyPreviewSample(kind: "imageWork" | "photographed", sample: PreviewSample) {
    setPreviewUrl("");
    setPreviewSignature("");
    setLiveMessage("");
    setSku(sample.sku);
    setSampleHistoryId(sample.sampleId);
    setSelectedSample(kind);
    if (sample.sourceUrl) {
      setSourceUrl(sample.sourceUrl);
      setBackgroundEligible(Boolean(sample.backgroundEligible));
    } else {
      setSourceUrl("");
      setBackgroundEligible(null);
    }
  }

  const selectedSampleChoices = selectedSample ? sampleItems[selectedSample] : [];
  const selectedSampleIndex = selectedSampleChoices.findIndex((choice) => choice.sku === sku && choice.sampleId === sampleHistoryId);
  const selectedVariationIndex = variationGroups.findIndex((group) => group.key === variationGroupKey);
  const selectedVariation = variationGroups[selectedVariationIndex] ?? null;

  useEffect(() => () => {
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
  }, []);

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.type !== "image/png" || file.size > 2_000_000) {
      setMessage("로고는 2MB 이하 PNG 파일을 사용해 주세요.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("로고 파일을 읽지 못했습니다."));
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/listing-upload/variation-thumbnail/logo", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl, fileName: file.name }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "로고를 저장하지 못했습니다.");
      setSettings((current) => current ? { ...current, logoUrl: body.logoUrl } : current);
      setPreviewUrl(""); setMessage("워터마크 로고를 저장했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function uploadBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!(["image/png", "image/jpeg", "image/webp"].includes(file.type)) || file.size > 10_000_000) {
      setMessage("배경은 10MB 이하 PNG, JPG, WebP 파일을 사용해 주세요.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("배경 파일을 읽지 못했습니다."));
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/channel-publishing/background", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl, fileName: file.name }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "배경을 저장하지 못했습니다.");
      setSettings((current) => current ? { ...current, backgroundUrl: body.backgroundUrl, backgroundEnabled: true } : current);
      setPreviewUrl(""); setMessage("공용 배경 이미지를 저장했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); event.currentTarget.value = ""; }
  }

  async function save() {
    if (!settings) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/channel-publishing/image-settings", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "워터마크 설정을 저장하지 못했습니다.");
      setSettings(body.settings); setPreviewUrl("");
      setMessage("저장했습니다. eBay·Shopify·옵션 대표 썸네일에 함께 적용됩니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function resetImageTreatment() {
    if (!settings) return;
    setSettings({
      ...settings,
      imageExposure: 1,
      imageContrast: 1,
      imageSaturation: 1,
      imageRotation: 0,
      imageZoom: 0,
      imageFlipHorizontal: false,
      backgroundColor: "#FFFFFF",
      paddingTop: 80,
      paddingRight: 80,
      paddingBottom: 80,
      paddingLeft: 80,
    });
  }

  return <div className={`${standalone ? "" : "mt-3"} rounded-md border border-violet-300 bg-white p-3`}>
    {!standalone ? <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between text-left text-sm font-semibold text-violet-950">
      <span>워터마크 설정</span><span className="text-xs text-violet-700">{open ? "접기" : "열기"}</span>
    </button> : null}
    {open && settings ? <div className="mt-3 grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
      <div className="space-y-3">
        <SettingsSection title="워터마크">
          <label className="block text-xs font-semibold">공용 PNG 로고<input type="file" accept="image/png" onChange={(event) => void uploadLogo(event)} disabled={busy} className="mt-1 block w-full text-xs" /></label>
          {settings.logoUrl ? <img src={settings.logoUrl} alt="저장된 워터마크 로고" className="mt-2 max-h-20 rounded border bg-zinc-100 p-2" /> : <p className="mt-2 text-xs text-amber-700">저장된 로고가 없습니다.</p>}
          <label className="mt-2 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={settings.watermarkEnabled} onChange={(e) => setSettings({ ...settings, watermarkEnabled: e.currentTarget.checked })} />워터마크 사용</label>
          <RangeNumber label="투명도" value={settings.watermarkOpacity} min={watermarkSettingLimits.opacity.min} max={watermarkSettingLimits.opacity.max} step={watermarkSettingLimits.opacity.step} display={`${Math.round(settings.watermarkOpacity * 100)}%`} onChange={(value) => setSettings({ ...settings, watermarkOpacity: value })} />
          <RangeNumber label="로고 크기" value={settings.watermarkLogoSize} min={singleWatermarkSettingLimits.logoSize.min} max={singleWatermarkSettingLimits.logoSize.max} step={singleWatermarkSettingLimits.logoSize.step} suffix="px" onChange={(value) => {
            const nextFootprint = Math.round(value * 1.25);
            setSettings({ ...settings, watermarkLogoSize: value, watermarkGap: Math.max(watermarkSettingLimits.gap.min, Math.min(watermarkSettingLimits.gap.max, repeatPitch - nextFootprint)) });
          }} />
          <RangeNumber label="반복 중심 간격" value={repeatPitch} min={singleWatermarkSettingLimits.centerDistance.min} max={singleWatermarkSettingLimits.centerDistance.max} step={singleWatermarkSettingLimits.centerDistance.step} suffix="px" onChange={(value) => setSettings({ ...settings, watermarkGap: Math.max(watermarkSettingLimits.gap.min, Math.min(watermarkSettingLimits.gap.max, value - watermarkFootprint)) })} />
          <p className="mt-1 text-[11px] text-zinc-500">로고 중심과 다음 로고 중심 사이 거리입니다. 로고 크기를 바꿔도 이 간격과 이미지 중앙 기준점은 유지됩니다.</p>
        </SettingsSection>

        <SettingsSection title="묶음옵션 썸네일 워터마크">
          <p className="text-[11px] text-zinc-500">공용 PNG 로고와 사용 여부만 단일 카드와 공유하며, 아래 값은 묶음옵션 썸네일에만 적용됩니다.</p>
          <div className="mb-2 mt-2 grid grid-cols-3 gap-1">
            <button type="button" className="h-8 rounded border bg-white text-[11px] font-semibold hover:border-violet-400" onClick={() => setSettings({ ...settings, variationWatermarkLogoSize: 70, variationWatermarkGap: 12 })}>촘촘하게</button>
            <button type="button" className="h-8 rounded border bg-white text-[11px] font-semibold hover:border-violet-400" onClick={() => setSettings({ ...settings, variationWatermarkLogoSize: 110, variationWatermarkGap: 22 })}>균형</button>
            <button type="button" className="h-8 rounded border bg-white text-[11px] font-semibold hover:border-violet-400" onClick={() => setSettings({ ...settings, variationWatermarkLogoSize: 160, variationWatermarkGap: 36 })}>넓게</button>
          </div>
          <RangeNumber label="투명도" value={settings.variationWatermarkOpacity} min={watermarkSettingLimits.opacity.min} max={watermarkSettingLimits.opacity.max} step={watermarkSettingLimits.opacity.step} display={`${Math.round(settings.variationWatermarkOpacity * 100)}%`} onChange={(value) => setSettings({ ...settings, variationWatermarkOpacity: value })} />
          <RangeNumber label="로고 크기" value={settings.variationWatermarkLogoSize / 10} min={variationWatermarkSettingLimits.logoSize.min / 10} max={variationWatermarkSettingLimits.logoSize.max / 10} step={variationWatermarkSettingLimits.logoSize.step / 10} suffix="%" onChange={(value) => setSettings({ ...settings, variationWatermarkLogoSize: Math.round(value * 10) })} />
          <RangeNumber label="반복 중심 간격" value={settings.variationWatermarkGap} min={variationWatermarkSettingLimits.repeatDistance.min} max={variationWatermarkSettingLimits.repeatDistance.max} step={variationWatermarkSettingLimits.repeatDistance.step} suffix="%" onChange={(value) => setSettings({ ...settings, variationWatermarkGap: value })} />
          <p className="mt-1 text-[11px] text-zinc-500">두 값 모두 썸네일 대비 비율입니다. 반복 중심은 중앙 기준 고정 격자이며, 로고 크기를 바꾸면 각 중심에서 로고만 커집니다. 중심 간격을 로고 크기보다 작게 하면 서로 겹칩니다.</p>
          <p className="mt-1 text-[11px] text-zinc-500">단일 카드 설정과 독립적으로 저장됩니다.</p>
        </SettingsSection>

        <SettingsSection title="기본 변형">
          <RangeNumber label="회전" value={settings.imageRotation} min={-180} max={180} step={1} suffix="°" onChange={(value) => setSettings({ ...settings, imageRotation: value })} />
          <RangeNumber label="여백 내 확대" value={settings.imageZoom} min={0} max={100} step={1} suffix="%" onChange={(value) => setSettings({ ...settings, imageZoom: value })} />
          <label className="mt-2 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={settings.imageFlipHorizontal} onChange={(event) => setSettings({ ...settings, imageFlipHorizontal: event.currentTarget.checked })} />좌우 반전</label>
        </SettingsSection>

        <SettingsSection title="노출·대비·채도">
          <p className="text-[11px] text-zinc-500">1.0이 원본입니다. 슬라이더와 숫자 입력 모두 실시간 반영됩니다.</p>
          <RangeNumber label="노출" value={settings.imageExposure} min={0.1} max={2} step={0.05} onChange={(value) => setSettings({ ...settings, imageExposure: value })} />
          <RangeNumber label="대비" value={settings.imageContrast} min={0.1} max={2} step={0.05} onChange={(value) => setSettings({ ...settings, imageContrast: value })} />
          <RangeNumber label="채도" value={settings.imageSaturation} min={0} max={2} step={0.05} onChange={(value) => setSettings({ ...settings, imageSaturation: value })} />
        </SettingsSection>

        <SettingsSection title="이미지가공 이미지 전용: 배경·크기">
          <input ref={backgroundInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadBackground(event)} disabled={busy} className="sr-only" aria-label="배경 이미지 파일" />
          <button type="button" onClick={() => backgroundInputRef.current?.click()} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-300 bg-white px-3 text-xs font-bold text-violet-800 hover:bg-violet-50 disabled:bg-zinc-100"><ImagePlus className="h-4 w-4" />배경 이미지 선택</button>
          {settings.backgroundUrl ? <img src={settings.backgroundUrl} alt="저장된 상품 배경" className="mt-2 h-24 w-full rounded border object-cover" /> : <p className="mt-2 text-xs text-zinc-500">이미지를 불러오지 않으면 아래 배경색을 사용합니다.</p>}
          <label className="mt-2 flex items-center gap-2 text-xs font-semibold">배경색<input type="color" value={settings.backgroundColor} onChange={(event) => setSettings({ ...settings, backgroundColor: event.currentTarget.value.toUpperCase() })} className="h-8 w-12 rounded border" /></label>
          <RangeNumber label="이미지 크기" value={uniformImageScale} min={40} max={100} step={1} suffix="%" onChange={(value) => {
            const padding = Math.round((100 - value) * 5);
            setSettings({ ...settings, paddingTop: padding, paddingRight: padding, paddingBottom: padding, paddingLeft: padding });
          }} />
          <p className="mt-1 text-[11px] text-zinc-500">이미지가공 결과를 배경 안에서 균일하게 축소합니다. 100%는 배경 여백이 없습니다.</p>
          <p className="mt-2 text-[11px] text-zinc-500">양수는 여백, 음수는 해당 방향으로 확대합니다.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField label="위" value={settings.paddingTop} min={0} max={300} onChange={(value) => setSettings({ ...settings, paddingTop: value })} />
            <NumberField label="오른쪽" value={settings.paddingRight} min={0} max={300} onChange={(value) => setSettings({ ...settings, paddingRight: value })} />
            <NumberField label="아래" value={settings.paddingBottom} min={0} max={300} onChange={(value) => setSettings({ ...settings, paddingBottom: value })} />
            <NumberField label="왼쪽" value={settings.paddingLeft} min={0} max={300} onChange={(value) => setSettings({ ...settings, paddingLeft: value })} />
          </div>
          <p className="mt-2 text-[11px] text-amber-700">촬영본도 같은 여백과 높이로 배치하며, 배경 사진 대신 흰색을 사용합니다.</p>
        </SettingsSection>

        <div className="grid grid-cols-2 gap-2"><button type="button" onClick={resetImageTreatment} disabled={busy} className="h-9 rounded border border-zinc-300 text-xs font-bold">이미지가공 초기화</button><button type="button" onClick={() => void save()} disabled={busy} className="h-9 rounded bg-violet-700 text-xs font-bold text-white disabled:bg-zinc-300">{busy ? "저장 중…" : "설정 저장"}</button></div>
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold text-zinc-900">미리보기</p><div className="flex items-center gap-2"><span className="font-mono text-[11px] text-zinc-500">{previewMode === "variation" ? (selectedVariationIndex >= 0 ? `${selectedVariationIndex + 1}/${variationGroups.length}` : `0/${variationGroups.length}`) : (selectedSampleIndex >= 0 ? `${selectedSampleIndex + 1}/${selectedSampleChoices.length}` : `0/${selectedSampleChoices.length}`)}</span><button type="button" onClick={previewMode === "variation" ? showNextVariationGroup : showNextSample} disabled={previewMode === "variation" ? variationGroups.length < 2 : !selectedSample || selectedSampleChoices.length < 2} aria-label="다른 미리보기 보기" title="다음 미리보기" className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 bg-white text-violet-700 hover:border-violet-400 hover:bg-violet-50 disabled:text-zinc-300"><RefreshCw className="h-4 w-4" /></button></div></div>
        <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => void selectPreviewMode("single")} className={`rounded-md border px-3 py-2 text-left text-xs font-bold ${previewMode === "single" ? "border-violet-600 bg-violet-600 text-white" : "border-zinc-300 bg-white text-zinc-800"}`}>단일 카드 이미지</button><button type="button" onClick={() => void selectPreviewMode("variation")} className={`rounded-md border px-3 py-2 text-left text-xs font-bold ${previewMode === "variation" ? "border-violet-600 bg-violet-600 text-white" : "border-zinc-300 bg-white text-zinc-800"}`}>묶음옵션 썸네일</button></div>
        {previewMode === "single" ? <><div className="mt-2 grid grid-cols-2 gap-2">
          <SampleButton active={selectedSample === "imageWork"} disabled={!sampleItems.imageWork.length} label="이미지가공 이미지" sku={selectedSample === "imageWork" ? sku : sampleSkus.imageWork} onClick={() => selectSampleKind("imageWork")} />
          <SampleButton active={selectedSample === "photographed"} disabled={!sampleItems.photographed.length} label="촬영본 이미지" sku={selectedSample === "photographed" ? sku : sampleSkus.photographed} onClick={() => selectSampleKind("photographed")} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2"><input value={sku} onChange={(e) => { setSku(e.currentTarget.value.slice(0, 100)); setSampleHistoryId(null); setSelectedSample(null); setSourceUrl(""); setBackgroundEligible(null); setPreviewUrl(""); setPreviewSignature(""); }} aria-label="워터마크 미리보기 SKU" className="h-9 w-40 rounded border px-2 text-sm" /><span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-800">{liveBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{liveBusy ? "미리보기 확정 중…" : "미리보기 준비 완료"}</span></div>
        <p className="mt-2 text-xs text-zinc-600">단일 카드는 즉시 표시됩니다. 묶음은 카드 배치를 처음 한 번 준비한 뒤, 워터마크 크기·간격·투명도는 즉시 반영됩니다.</p></> : <>{variationGroups.length ? <select aria-label="묶음옵션 미리보기 선택" value={variationGroupKey} onChange={(event) => { setVariationPreviewUrl(""); setVariationGroupKey(event.currentTarget.value); }} className="mt-2 h-9 w-full rounded border px-2 text-xs"><option value="" disabled>묶음옵션을 선택하세요</option>{variationGroups.map((group) => <option key={group.key} value={group.key}>{group.title} · {group.products.length}장 · 이미지가공 {group.imageWorkCount}장 / 촬영본 {group.products.length - group.imageWorkCount}장</option>)}</select> : null}<p className="mt-2 text-xs text-zinc-600">{selectedVariation ? `${selectedVariation.title} · ${selectedVariation.products.length}개 카드 · 이미지가공 ${selectedVariation.imageWorkCount}장 / 촬영본 ${selectedVariation.products.length - selectedVariation.imageWorkCount}장` : "묶음옵션 샘플을 불러오는 중입니다."} 이미지작업 카드는 배경·크기 적용, 촬영본 카드는 원본 비율 그대로 합성합니다.</p></>}
        {previewMode === "single" && backgroundEligible !== null ? <p className={`mt-1 text-xs font-semibold ${backgroundEligible ? "text-emerald-700" : "text-amber-700"}`}>{backgroundEligible ? "이미지작업 결과: 배경·패딩 적용 대상" : "촬영본: 흰 여백에 원본 비율로 전체 배치"}</p> : null}
        {previewMode === "single" && liveMessage ? <p className="mt-2 text-xs font-semibold text-rose-700">{liveMessage}</p> : null}{previewMode === "variation" && variationMessage ? <p className="mt-2 text-xs font-semibold text-rose-700">{variationMessage}</p> : null}
        <p className="mt-3 text-xs text-zinc-600">업로드 이미지는 960×1200으로 통일합니다. 가로형은 세로로 돌려 같은 높이로 배치합니다. 원본 비율을 보존하며, 확대는 여백 안에서만 적용됩니다. 둥근 모서리를 적용하고 묶음에서도 전체 카드를 포함합니다.</p><p className="mt-3 text-xs font-bold text-zinc-900">미리보기</p>
        <div className="relative mt-1 flex min-h-80 items-center justify-center overflow-hidden rounded border bg-zinc-100">
          {previewMode === "variation" ? variationPreviewUrl ? <LiveVariationWatermarkCanvas baseUrl={variationPreviewUrl} tileUrl={variationWatermarkTileUrl} repeatDistancePercent={settings.variationWatermarkGap} alt={`${selectedVariation?.title ?? "묶음옵션"} 썸네일 미리보기`} /> : <span className="text-sm text-zinc-500">묶음옵션 카드 배치를 준비하고 있습니다.</span> : finalPreviewReady ? <a href={previewUrl} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center"><img src={previewUrl} alt={`${sku} 업로드 이미지 미리보기`} className="max-h-[680px] w-full object-contain" /></a> : <div className="relative flex min-h-64 w-full items-center justify-center" aria-busy="true">{previewUrl ? <img src={previewUrl} alt="직전 서버 미리보기 · 변경 설정 계산 중" className="max-h-[680px] w-full object-contain opacity-60" /> : null}<span className="absolute rounded bg-white/95 px-4 py-3 text-sm text-zinc-700">변경한 설정으로 업로드 이미지를 제작 중입니다.{previewUrl ? " 표시된 이미지는 직전 결과입니다." : ""}</span></div>}
          {(previewMode === "variation" ? variationBusy : liveBusy && !finalPreviewReady) ? <span className="absolute right-2 top-2 rounded-full bg-zinc-950/75 px-2 py-1 text-[11px] font-semibold text-white">{previewMode === "variation" ? "카드 배치 준비 중" : "업로드 이미지 확정 중"}</span> : null}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">저장 후 eBay·Shopify·옵션 대표 썸네일이 같은 설정과 공용 R2 결과를 사용합니다.</p>
      </div>
    </div> : null}
    {message ? <p className="mt-2 text-xs font-medium text-violet-900">{message}</p> : null}
  </div>;
}

function SampleButton({ active, disabled, label, sku, onClick }: { active: boolean; disabled: boolean; label: string; sku: string | null; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-md border px-3 py-2 text-left text-xs font-bold ${active ? "border-violet-600 bg-violet-600 text-white" : "border-zinc-300 bg-white text-zinc-800 hover:border-violet-400"} disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400`}><span className="block">{label}</span><span className={`mt-0.5 block font-mono text-[10px] ${active ? "text-violet-100" : "text-zinc-500"}`}>{sku ?? "사용 가능한 샘플 없음"}</span></button>;
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3"><h3 className="mb-2 text-xs font-bold text-zinc-900">{title}</h3>{children}</section>;
}

function RangeNumber({ label, value, min, max, step, suffix = "", display, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; display?: string; onChange: (value: number) => void }) {
  return <label className="mt-2 block text-xs font-semibold"><span className="flex items-center justify-between"><span>{label}</span><span className="font-mono text-violet-800">{display ?? `${Number(value.toFixed(2))}${suffix}`}</span></span><span className="mt-1 flex items-center gap-2"><input className="min-w-0 flex-1" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} /><input aria-label={`${label} 수치`} type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} className="h-8 w-20 rounded border px-2 text-right font-mono text-xs" /></span></label>;
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="text-[11px] font-semibold text-zinc-600">{label}<input type="number" min={min} max={max} step="1" value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} className="mt-1 h-8 w-full rounded border bg-white px-2 text-right font-mono text-xs text-zinc-900" /></label>;
}

