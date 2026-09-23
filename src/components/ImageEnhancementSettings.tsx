"use client";

import { useEffect, useState } from "react";

type Settings = {
  brightness: number; contrast: number; saturation: number; sharpness: number;
  watermarkStrength: number; localAiEnabled: boolean; enhancementEnabled: boolean;
  enhancementModel: "RealESRGAN_x2plus" | "RealESRGAN_x4plus" | "4x-UltraSharp";
  enhancementScale: 2 | 4; enhancementStrength: number;
};

export function ImageEnhancementSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { void fetch("/api/products/image-workbench/settings").then(async r => {
    const body = await r.json(); if (!r.ok) throw new Error(body.error); setSettings(body as Settings);
  }).catch(e => setMessage(e instanceof Error ? e.message : "설정을 불러오지 못했습니다.")); }, []);
  async function save() {
    if (!settings) return;
    setMessage("저장 중…");
    const response = await fetch("/api/products/image-workbench/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
    const body = await response.json();
    setMessage(response.ok ? "저장했습니다. 새 워터마크 제거 작업부터 적용됩니다." : (body.error ?? "저장에 실패했습니다."));
  }
  if (!settings) return <p className="rounded-xl border bg-white p-5">{message || "설정을 불러오는 중…"}</p>;
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(current => current ? { ...current, [key]: value } : current);
  return <section className="max-w-2xl rounded-2xl border bg-white p-5 shadow-sm">
    <h2 className="text-lg font-bold">로컬 화질 개선</h2>
    <p className="mt-1 text-sm text-zinc-600">워터마크 제거 후 이 PC의 RTX GPU에서만 실행됩니다. 얼굴 복원은 사용하지 않으며, 새 작업마다 이 값을 저장해 재시도에도 같은 설정을 사용합니다.</p>
    <label className="mt-5 flex items-center gap-2 font-semibold"><input type="checkbox" checked={settings.enhancementEnabled} onChange={e => update("enhancementEnabled", e.target.checked)} /> 화질 개선 사용</label>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">모델<select value={settings.enhancementModel} onChange={e => { const model=e.target.value as Settings["enhancementModel"]; update("enhancementModel", model); if (model === "RealESRGAN_x2plus") update("enhancementScale", 2); }} className="mt-1 block w-full rounded border p-2 font-normal"><option value="RealESRGAN_x2plus">RealESRGAN x2plus (추천)</option><option value="RealESRGAN_x4plus">RealESRGAN x4plus</option><option value="4x-UltraSharp">4x-UltraSharp</option></select></label>
      <label className="text-sm font-semibold">배율<select value={settings.enhancementScale} disabled={settings.enhancementModel === "RealESRGAN_x2plus"} onChange={e => update("enhancementScale", Number(e.target.value) as 2 | 4)} className="mt-1 block w-full rounded border p-2 font-normal disabled:bg-zinc-100"><option value={2}>2배 (추천)</option><option value={4}>4배</option></select></label>
    </div>
    <label className="mt-5 block text-sm font-semibold">AI 보정 강도 · {settings.enhancementStrength}%<input type="range" min="0" max="100" value={settings.enhancementStrength} onChange={e => update("enhancementStrength", Number(e.target.value))} className="mt-2 block w-full" /></label>
    <p className="mt-1 text-xs text-zinc-500">기본 45%: AI 결과와 원본 업스케일을 섞어 과도한 샤픈·플라스틱 피부를 줄입니다. 포토카드는 35~55%를 권장합니다.</p>
    <button onClick={save} className="mt-5 rounded bg-zinc-900 px-4 py-2 font-bold text-white">저장</button>{message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
