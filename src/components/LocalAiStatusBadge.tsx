"use client";

import { useCallback, useEffect, useState } from "react";

type LocalAiState = "checking" | "connected" | "disconnected";
type Settings = {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  watermarkStrength: number;
  localAiEnabled: boolean;
};

export function LocalAiStatusBadge({
  onEnabledChange,
}: {
  onEnabledChange?: (enabled: boolean) => void;
} = {}) {
  const [state, setState] = useState<LocalAiState>("checking");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingError, setSettingError] = useState(false);

  const check = useCallback(async () => {
    try {
      const response = await fetch("/api/ai-image-work", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "workerStatus" }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Local AI unavailable");
      const body = (await response.json()) as { connected?: boolean };
      setState(body.connected ? "connected" : "disconnected");
    } catch {
      setState("disconnected");
    }
  }, []);

  useEffect(() => {
    void fetch("/api/products/image-workbench/settings", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: Settings) => {
        setSettings(body);
        onEnabledChange?.(body.localAiEnabled);
      })
      .catch(() => undefined);
    const initial = window.setTimeout(() => void check(), 0);
    const timer = window.setInterval(() => void check(), 15_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  const connected = state === "connected";
  const enabled = settings?.localAiEnabled ?? false;
  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setSettingError(false);
    let current = settings;
    if (!current) {
      try {
        const response = await fetch(
          "/api/products/image-workbench/settings",
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("설정 조회 실패");
        current = (await response.json()) as Settings;
        setSettings(current);
      } catch {
        setSettingError(true);
        setSaving(false);
        return;
      }
    }
    const next = { ...current, localAiEnabled: !current.localAiEnabled };
    setSettings(next);
    onEnabledChange?.(next.localAiEnabled);
    try {
      const response = await fetch("/api/products/image-workbench/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("설정 저장 실패");
    } catch {
      setSettings(current);
      onEnabledChange?.(current.localAiEnabled);
      setSettingError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
        !enabled
          ? "border-zinc-300 bg-zinc-100 text-zinc-700"
          : connected
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : state === "checking"
            ? "border-zinc-300 bg-zinc-50 text-zinc-600"
            : "border-red-300 bg-red-50 text-red-800"
      }`}
      title="클릭하면 로컬 AI 사용 여부를 전환합니다. 꺼짐 상태에서는 OpenCV만 사용합니다."
    >
      <span
        className={`h-2 w-2 rounded-full ${
          !enabled
            ? "bg-zinc-500"
            : connected
            ? "bg-emerald-500"
            : state === "checking"
              ? "animate-pulse bg-zinc-400"
              : "bg-red-500"
        }`}
      />
      {saving
        ? "엔진 설정 저장 중…"
        : settingError
          ? "엔진 설정 실패 · 다시 클릭"
        : !enabled
          ? "로컬 AI 꺼짐 · OpenCV 사용"
          : connected
        ? "로컬 AI 연결됨"
        : state === "checking"
          ? "로컬 AI 확인 중"
          : "로컬 AI 연결 허용/재시도"}
    </button>
  );
}
