"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, RotateCcw } from "lucide-react";

const base = "http://127.0.0.1:5177/__watermark-ai";

type Model = {
  runId: string;
  parentRunId?: string | null;
  warmStarted?: boolean;
  requiresVisualApproval?: boolean;
  visualApproved?: boolean;
  comparisonFiles?: string[];
  metrics: {
    psnr: number;
    mae: number;
    roiMae?: number;
    boundaryMae?: number;
    outsideMae?: number;
    baselineRoiMae?: number;
    repairCoverage?: number;
  };
};

type Status = {
  config: { datasetDir: string; autoTrain: boolean; minimumNewPairs: number };
  processRunning: boolean;
  pipeline: {
    manifest: {
      counts: {
        valid: number;
        train: number;
        validation: number;
        visual?: number;
        unmatched: number;
        invalid: number;
      };
    };
    runtime: { progress?: number; epoch?: number; epochs?: number; warmStarted?: boolean };
    registry: {
      champion?: string | null;
      candidate?: string | null;
      previousChampion?: string | null;
      models: Model[];
    };
    environment: { device: string; torch: string };
  };
};

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `로컬 학습기 오류 (${response.status})`);
  return body;
}

export function AiImageTrainingClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [comparisons, setComparisons] = useState<Array<{ fileName: string; image: string }>>([]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<Status>("/status"));
      setError("");
    } catch {
      setError("로컬 학습기에 연결할 수 없습니다. PC에서 학습 서버를 실행해 주세요.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!status?.processRunning) return;
    const id = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(id);
  }, [refresh, status?.processRunning]);

  async function action(name: string, path: string, body: object = {}) {
    setBusy(name);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  const candidate = status?.pipeline.registry.models.find(
    (model) => model.runId === status.pipeline.registry.candidate,
  );
  const champion = status?.pipeline.registry.models.find(
    (model) => model.runId === status.pipeline.registry.champion,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!candidate?.comparisonFiles?.length) {
        setComparisons([]);
        return;
      }
      void api<{ images: Array<{ fileName: string; image: string }> }>(
        `/comparisons?runId=${encodeURIComponent(candidate.runId)}`,
      ).then((result) => setComparisons(result.images)).catch(() => setComparisons([]));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [candidate?.runId, candidate?.comparisonFiles?.length]);

  if (!status) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <b className="text-amber-900">로컬 학습기 연결 필요</b>
        <p className="mt-2 text-sm text-amber-800">{error || "연결 확인 중…"}</p>
        <button onClick={() => void refresh()} className="mt-4 rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white">
          다시 연결
        </button>
      </div>
    );
  }

  const counts = status.pipeline.manifest.counts;
  const registry = status.pipeline.registry;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["유효 샘플", counts.valid],
          ["학습용", counts.train],
          ["검증/육안", counts.validation + (counts.visual ?? 0)],
          ["누락/오류", counts.unmatched + counts.invalid],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">{label}</p>
            <p className="mt-1 text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex justify-between">
            <h2 className="font-bold">자동 감시</h2>
            <button onClick={() => void refresh()} aria-label="새로고침"><RefreshCw className="h-5 w-5" /></button>
          </div>
          <p className="mt-3 break-all text-sm text-zinc-600">{status.config.datasetDir}</p>
          <p className="mt-2 text-sm">
            자동 학습: <b>{status.config.autoTrain ? "켜짐" : "꺼짐"}</b> · 최소 {status.config.minimumNewPairs}쌍
          </p>
          <p className="mt-2 text-sm">장치: {status.pipeline.environment.device}</p>
          <p className="mt-2 text-xs text-zinc-500">
            새 U-Net 후보는 고정 학습 50장·수치 검증 10장·육안 비교 7장을 사용하며 자동 적용되지 않습니다.
          </p>
          <button
            disabled={status.processRunning || counts.valid < 10}
            onClick={() => void action("train", "/train")}
            className="mt-5 w-full rounded-lg bg-violet-600 px-4 py-2.5 font-semibold text-white disabled:opacity-40"
          >
            {status.processRunning ? (
              <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />학습 중 {status.pipeline.runtime.progress ?? 0}%</>
            ) : "지금 정식 학습"}
          </button>
        </section>

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-bold">모델 적용</h2>
          <ModelMetrics label="운영 모델" model={champion} />
          <ModelMetrics label="후보 모델" model={candidate} />
          <div className="mt-5 flex gap-2">
            <button
              disabled={!candidate || Boolean(busy) || Boolean(candidate.requiresVisualApproval && !candidate.visualApproved)}
              onClick={() => candidate && void action("promote", "/promote", { runId: candidate.runId })}
              className="flex-1 rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              <CheckCircle2 className="mr-1 inline h-4 w-4" />후보 적용
            </button>
            <button
              disabled={!registry.previousChampion || Boolean(busy)}
              onClick={() => void action("rollback", "/rollback")}
              className="flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              <RotateCcw className="mr-1 inline h-4 w-4" />되돌리기
            </button>
          </div>
          {candidate?.requiresVisualApproval && !candidate.visualApproved && (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-amber-700">
                INPUT · 기존 운영 · 새 후보 · 정답 순서입니다. 얼굴과 무늬를 확인한 뒤 승인하세요.
              </p>
              {comparisons.map((item) => (
                // Local trainer returns a generated comparison sheet.
                // eslint-disable-next-line @next/next/no-img-element
                <img key={item.fileName} src={item.image} alt={`후보 비교 ${item.fileName}`} className="w-full rounded-lg border" />
              ))}
              <button
                disabled={!comparisons.length || Boolean(busy)}
                onClick={() => void action("approve", "/approve", { runId: candidate.runId })}
                className="w-full rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40"
              >
                비교 이미지 확인 완료
              </button>
            </div>
          )}
        </section>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {counts.valid < 10 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          현재 {counts.valid}쌍입니다. 정식 자동 학습은 10쌍부터, 안정적인 검증은 50쌍 이상을 권장합니다.
        </p>
      )}
    </div>
  );
}

function ModelMetrics({ label, model }: { label: string; model?: Model }) {
  if (!model) return <p className="mt-3 text-sm text-zinc-600">{label}: 없음</p>;
  return (
    <div className="mt-3 rounded-lg border p-3 text-sm text-zinc-600">
      <p><b>{label}</b>: {model.runId}</p>
      <p className="mt-1">
        PSNR {model.metrics.psnr.toFixed(2)}
        {model.metrics.roiMae !== undefined ? ` · 워터마크 오차 ${model.metrics.roiMae.toFixed(4)}` : ""}
        {model.metrics.boundaryMae !== undefined ? ` · 경계 ${model.metrics.boundaryMae.toFixed(4)}` : ""}
      </p>
      {model.metrics.repairCoverage !== undefined && (
        <p className="mt-1">실제 복원량 {(model.metrics.repairCoverage * 100).toFixed(0)}%</p>
      )}
      {model.warmStarted && model.parentRunId && <p className="mt-1 text-xs">운영 모델 {model.parentRunId}에서 이어 학습</p>}
    </div>
  );
}
