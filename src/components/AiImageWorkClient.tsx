"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocalAiStatusBadge } from "@/components/LocalAiStatusBadge";
import { fetchWithTimeout } from "@/lib/client-fetch-timeout";
type Item = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  sourceUrl: string;
  previewUrl: string | null;
  status: string;
  error: string | null;
  previewVersion: string;
};
type Claimed = { id: string; productId: string; sourceUrl: string };
type WorkSettings = {
  watermarkStrength?: number;
  localAiEnabled?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  sharpness?: number;
};
const AI_OUTPUT_WIDTH = 540;
const AI_OUTPUT_HEIGHT = 860;

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("JPEG 이미지를 만들지 못했습니다."));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("JPEG 이미지를 읽지 못했습니다."));
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

function blendWatermarkRegion(
  source: HTMLCanvasElement,
  restored: HTMLImageElement,
  mask: HTMLImageElement,
) {
  const result = document.createElement("canvas");
  result.width = AI_OUTPUT_WIDTH;
  result.height = AI_OUTPUT_HEIGHT;
  const context = result.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("AI 합성 화면을 만들지 못했습니다.");
  context.drawImage(source, 0, 0);
  const sourcePixels = context.getImageData(0, 0, AI_OUTPUT_WIDTH, AI_OUTPUT_HEIGHT);

  const restoredCanvas = document.createElement("canvas");
  restoredCanvas.width = AI_OUTPUT_WIDTH;
  restoredCanvas.height = AI_OUTPUT_HEIGHT;
  const restoredContext = restoredCanvas.getContext("2d", { willReadFrequently: true });
  if (!restoredContext) throw new Error("AI 복원 결과를 읽지 못했습니다.");
  restoredContext.drawImage(restored, 0, 0, AI_OUTPUT_WIDTH, AI_OUTPUT_HEIGHT);
  const restoredPixels = restoredContext.getImageData(0, 0, AI_OUTPUT_WIDTH, AI_OUTPUT_HEIGHT);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = AI_OUTPUT_WIDTH;
  maskCanvas.height = AI_OUTPUT_HEIGHT;
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskContext) throw new Error("워터마크 영역을 읽지 못했습니다.");
  maskContext.filter = "blur(1.5px)";
  maskContext.drawImage(mask, 0, 0, AI_OUTPUT_WIDTH, AI_OUTPUT_HEIGHT);
  const maskPixels = maskContext.getImageData(0, 0, AI_OUTPUT_WIDTH, AI_OUTPUT_HEIGHT);

  for (let offset = 0; offset < sourcePixels.data.length; offset += 4) {
    const maskValue = maskPixels.data[offset];
    if (maskValue < 2) continue;
    const alpha = Math.min(1, maskValue / 42);
    for (let channel = 0; channel < 3; channel += 1) {
      sourcePixels.data[offset + channel] = Math.round(
        sourcePixels.data[offset + channel] * (1 - alpha) +
          restoredPixels.data[offset + channel] * alpha,
      );
    }
  }
  context.putImageData(sourcePixels, 0, 0);
  return result;
}

async function inferenceConcurrency() {
  try {
    const response = await fetchWithTimeout(
      "http://127.0.0.1:5177/__watermark-ai/status",
      {},
      2_000,
    );
    const body = (await response.json()) as {
      pipeline?: { environment?: { device?: string } };
    };
    const device = body.pipeline?.environment?.device?.toLowerCase() ?? "";
    return device.includes("cuda") || device.includes("gpu") ? 3 : 1;
  } catch {
    return 1;
  }
}
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}
function sharpen(canvas: HTMLCanvasElement, value: number) {
  if (value <= 0) return;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const blurred = document.createElement("canvas");
  blurred.width = canvas.width;
  blurred.height = canvas.height;
  const bc = blurred.getContext("2d", { willReadFrequently: true });
  if (!bc) return;
  bc.filter = "blur(1px)";
  bc.drawImage(canvas, 0, 0);
  const original = context.getImageData(0, 0, canvas.width, canvas.height),
    soft = bc.getImageData(0, 0, canvas.width, canvas.height),
    amount = Math.min(0.9, value / 34);
  for (let o = 0; o < original.data.length; o += 4)
    for (let c = 0; c < 3; c++)
      original.data[o + c] = Math.max(
        0,
        Math.min(
          255,
          Math.round(
            original.data[o + c] +
              amount * (original.data[o + c] - soft.data[o + c]),
          ),
        ),
      );
  context.putImageData(original, 0, 0);
}
async function removeWithManualEngine(job: Claimed, settings: WorkSettings) {
  const [source, mask] = await Promise.all([
    loadImage(
      `/api/products/${job.productId}/image-workbench?url=${encodeURIComponent(job.sourceUrl)}&t=${Date.now()}`,
    ),
    loadImage("/pocamarket-watermark-mask-v4.png"),
  ]);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = source.naturalWidth;
  sourceCanvas.height = source.naturalHeight;
  const sourceContext = sourceCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = mask.naturalWidth;
  maskCanvas.height = mask.naturalHeight;
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext || !maskContext)
    throw new Error("이미지 처리 화면을 준비하지 못했습니다.");
  sourceContext.drawImage(source, 0, 0);
  maskContext.drawImage(mask, 0, 0);
  const result = await new Promise<ImageData>((resolve, reject) => {
      const worker = new Worker("/opencv-card-worker.js?v=20260728-17-rollback");
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("워터마크 제거 시간이 초과되었습니다."));
    }, 35000);
    worker.onmessage = (
      event: MessageEvent<{
        ok: boolean;
        imageData?: ImageData;
        error?: string;
      }>,
    ) => {
      window.clearTimeout(timer);
      worker.terminate();
      if (event.data.ok && event.data.imageData) resolve(event.data.imageData);
      else reject(new Error(event.data.error || "워터마크 제거 실패"));
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(new Error("워터마크 제거 엔진 오류"));
    };
    const imageData = sourceContext.getImageData(
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    const maskData = maskContext.getImageData(
      0,
      0,
      maskCanvas.width,
      maskCanvas.height,
    );
    worker.postMessage(
      {
        task: "removeWatermark",
        imageData,
        maskData,
        // Use the exact same saved strength as the manual image workbench.
        strength: Math.min(settings.watermarkStrength ?? 110, 110),
      },
      [imageData.data.buffer, maskData.data.buffer],
    );
  });
  const restored = document.createElement("canvas");
  restored.width = result.width;
  restored.height = result.height;
  restored.getContext("2d")?.putImageData(result, 0, 0);
  // Keep the adjustment canvas opaque. Sharpening after a rounded clip pulls
  // transparent black pixels into the edge and leaves a dark line at the top.
  const enhanced = document.createElement("canvas");
  enhanced.width = 540;
  enhanced.height = 860;
  const ec = enhanced.getContext("2d");
  if (!ec) throw new Error("카드 결과 화면을 만들지 못했습니다.");
  ec.filter = `brightness(${1 + (settings.brightness ?? 8) / 100}) contrast(${1 + (settings.contrast ?? 3) / 100}) saturate(${1 + (settings.saturation ?? 5) / 100})`;
  // Exclude the repeatable scan/resampling seam present in the outermost
  // source pixels before scaling it into the finished card.
  const edgeCrop = Math.max(
    2,
    Math.round(Math.min(restored.width, restored.height) * 0.008),
  );
  ec.drawImage(
    restored,
    edgeCrop,
    edgeCrop,
    Math.max(1, restored.width - edgeCrop * 2),
    Math.max(1, restored.height - edgeCrop * 2),
    0,
    0,
    540,
    860,
  );
  sharpen(enhanced, settings.sharpness ?? 12);
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = 540;
  finalCanvas.height = 860;
  const fc = finalCanvas.getContext("2d");
  if (!fc) throw new Error("JPG 결과 화면을 만들지 못했습니다.");
  fc.fillStyle = "#fff";
  fc.fillRect(0, 0, 540, 860);
  fc.save();
  fc.beginPath();
  fc.roundRect(0, 0, 540, 860, 25);
  fc.clip();
  fc.drawImage(enhanced, 0, 0);
  fc.restore();
  return finalCanvas.toDataURL("image/jpeg", 0.88);
}

async function removeWithLearnedEngine(job: Claimed, settings: WorkSettings) {
  const source = await loadImage(
    `/api/products/${job.productId}/image-workbench?url=${encodeURIComponent(job.sourceUrl)}&t=${Date.now()}`,
  );
  const input = document.createElement("canvas");
  input.width = AI_OUTPUT_WIDTH;
  input.height = AI_OUTPUT_HEIGHT;
  input
    .getContext("2d")
    ?.drawImage(source, 0, 0, AI_OUTPUT_WIDTH, AI_OUTPUT_HEIGHT);
  const response = await fetchWithTimeout("http://127.0.0.1:5177/__watermark-ai/infer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image: await canvasToJpegDataUrl(input, 0.92) }),
  }, 45_000);
  const body = (await response.json().catch(() => ({}))) as {
    image?: string;
    error?: string;
    quality?: {
      darkArtifactFraction?: number;
    };
  };
  if (!response.ok || !body.image)
    throw new Error(body.error || "학습된 로컬 AI 모델을 사용할 수 없습니다.");
  if ((body.quality?.darkArtifactFraction ?? 0) > 0.002)
    throw new Error("AI 결과에서 비정상적으로 어두운 영역이 감지됐습니다.");
  const restored = await loadImage(body.image);
  const adjusted = document.createElement("canvas");
  adjusted.width = AI_OUTPUT_WIDTH;
  adjusted.height = AI_OUTPUT_HEIGHT;
  const context = adjusted.getContext("2d");
  if (!context) throw new Error("AI 결과 화면을 만들 수 없습니다.");
  context.filter = `brightness(${1 + (settings.brightness ?? 8) / 100}) contrast(${1 + (settings.contrast ?? 3) / 100}) saturate(${1 + (settings.saturation ?? 5) / 100})`;
  // The local model already changes only the expanded watermark region.
  // Re-blending with the source here would restore faint watermark pixels.
  context.drawImage(restored, 0, 0, AI_OUTPUT_WIDTH, AI_OUTPUT_HEIGHT);
  sharpen(adjusted, settings.sharpness ?? 12);
  const output = document.createElement("canvas");
  output.width = 540;
  output.height = 860;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("JPG 결과 화면을 만들 수 없습니다.");
  outputContext.fillStyle = "#fff";
  outputContext.fillRect(0, 0, 540, 860);
  outputContext.save();
  outputContext.beginPath();
  outputContext.roundRect(0, 0, 540, 860, 25);
  outputContext.clip();
  outputContext.drawImage(adjusted, 0, 0);
  outputContext.restore();
  return canvasToJpegDataUrl(output, 0.9);
}
function duration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "계산 중";
  const value = Math.ceil(seconds);
  return value < 60
    ? `약 ${value}초`
    : `약 ${Math.floor(value / 60)}분 ${value % 60}초`;
}
export function AiImageWorkClient({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [flash, setFlash] = useState("");
  const [localItems, setLocalItems] = useState(items);
  const [autoCount, setAutoCount] = useState(25);
  const [reworkCount, setReworkCount] = useState(5);
  const [upload, setUpload] = useState<{
    done: number;
    total: number;
    started: number;
    updated: number;
  } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setLocalItems(items), 0);
    return () => window.clearTimeout(timer);
  }, [items]);
  async function call(body: object) {
    const r = await fetch("/api/ai-image-work", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error || "처리에 실패했습니다.");
    return b;
  }
  async function enqueue() {
    setBusy(true);
    setMsg("");
    try {
      const b = await call({ action: "enqueue", limit: 100 });
      setMsg(`${b.created}개를 대기열에 추가했습니다.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function processClaimed(job: Claimed, settings: WorkSettings) {
    try {
      let image: string;
      let engineVersion = "alpha-v4-20260722-14";
      try {
        if (settings.localAiEnabled === false)
          throw new Error("Local AI disabled");
        image = await removeWithLearnedEngine(job, settings);
        engineVersion = "local-ai-v5";
      } catch {
        // Until a validated local model is promoted, preserve the current
        // production behavior instead of failing queued image work.
        image = await removeWithManualEngine(job, settings);
      }
      const completed = await call({
        action: "complete",
        id: job.id,
        image,
        engineVersion,
      });
      return { ok: true as const, url: completed.url as string };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await call({
        action: "fail",
        id: job.id,
        error,
      });
      return { ok: false as const, error };
    }
  }
  async function runOne(settings: WorkSettings) {
    const claimed = await call({ action: "claim" });
    const job = claimed.job as Claimed | null;
    if (!job) return false;
    await processClaimed(job, settings);
    return true;
  }
  async function run() {
    const target = Math.max(1, Math.min(200, autoCount));
    setBusy(true);
    setMsg(`처리 엔진 설정을 확인하는 중…`);
    try {
      const settings = (await fetch(
        "/api/products/image-workbench/settings",
        { cache: "no-store" },
      ).then((response) => response.json())) as WorkSettings;
      if (settings.localAiEnabled === false) {
        setMsg(`OpenCV 엔진으로 ${target}개 작업을 처리하는 중…`);
        let count = 0;
        let done = false;
        while (count < target && !done) {
          const batch = Math.min(2, target - count);
          const results = await Promise.all(
            Array.from({ length: batch }, () => runOne(settings)),
          );
          const made = results.filter(Boolean).length;
          count += made;
          done = made < batch;
          setMsg(`${count}/${target}개 OpenCV 처리 완료…`);
        }
        setMsg(`${count}개 OpenCV 자동 처리를 마쳤습니다.`);
        router.refresh();
        return;
      }
      const before = (await call({ action: "workerStatus" })) as {
        connected?: boolean;
        completedTotal?: number;
        failedTotal?: number;
      };
      if (!before.connected)
        throw new Error("로컬 AI 작업기가 운영 서버에 연결되어 있지 않습니다.");
      const started = (await call({
        action: "startWorkerBatch",
        limit: target,
      })) as { accepted?: number };
      const accepted = started.accepted ?? 0;
      if (!accepted) {
        setMsg("처리 대기 중인 이미지가 없습니다.");
        return;
      }
      const initialTotal =
        (before.completedTotal ?? 0) + (before.failedTotal ?? 0);
      const deadline = Date.now() + Math.max(180_000, accepted * 120_000);
      let processed = 0;
      while (processed < accepted && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        const status = (await call({ action: "workerStatus" })) as {
          connected?: boolean;
          completedTotal?: number;
          failedTotal?: number;
        };
        if (!status.connected)
          throw new Error("처리 중 로컬 AI 작업기 연결이 끊겼습니다.");
        processed = Math.min(
          accepted,
          (status.completedTotal ?? 0) +
            (status.failedTotal ?? 0) -
            initialTotal,
        );
        setMsg(`${processed}/${accepted}개 로컬 AI 처리 완료…`);
      }
      if (processed < accepted)
        throw new Error("로컬 AI 처리 제한 시간을 초과했습니다.");
      setMsg(`${processed}개 로컬 AI 자동 처리를 마쳤습니다.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function reprocess() {
    setBusy(true);
    setMsg("");
    try {
      const b = await call({ action: "reprocess" });
      setLocalItems((current) =>
        current.map((item) =>
          ["review", "held", "pass_ready", "processing"].includes(item.status)
            ? { ...item, status: "queued", previewUrl: null }
            : item,
        ),
      );
      setMsg(`기존 결과 ${b.count}개를 개선 재처리 대기열로 옮겼습니다.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function choose(action: "pass" | "hold" | "rework", id: string) {
    const previous = localItems;
    setLocalItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status:
                action === "pass"
                  ? "pass_ready"
                  : action === "hold"
                    ? "held"
                    : "rework",
            }
          : item,
      ),
    );
    setFlash(
      action === "pass"
        ? "✓ 통과 완료 · 다음 카드"
        : action === "hold"
          ? "⏸ 보류 완료 · 다음 카드"
          : "✕ 미통과 · 재작업 목록으로 이동",
    );
    window.setTimeout(() => setFlash(""), 900);
    try {
      await call({ action, id });
    } catch (e) {
      setLocalItems(previous);
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }
  async function resumeHeld() {
    const previous = localItems;
    setLocalItems((current) =>
      current.map((item) =>
        item.status === "held" ? { ...item, status: "review" } : item,
      ),
    );
    setFlash("보류 카드를 다시 검수합니다.");
    window.setTimeout(() => setFlash(""), 900);
    try {
      await call({ action: "resumeHeld" });
    } catch (e) {
      setLocalItems(previous);
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }
  async function retry(id: string) {
    try {
      await call({ action: "retry", id });
      setLocalItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "queued", error: null } : item,
        ),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }
  async function reprocessOne(item: Item) {
    if (busy) return;
    setBusy(true);
    setMsg(`${item.sku} 미통과 이미지를 다시 처리하는 중…`);
    try {
      const claimed = await call({ action: "claimRework", id: item.id });
      const job = claimed.job as Claimed | null;
      if (!job) throw new Error("이미 재처리 중이거나 미통과 상태가 아닙니다.");
      setLocalItems((current) =>
        current.map((target) =>
          target.id === item.id ? { ...target, status: "processing" } : target,
        ),
      );
      const settings = (await fetch(
        "/api/products/image-workbench/settings",
      ).then((response) => response.json())) as WorkSettings;
      const result = await processClaimed(job, settings);
      setLocalItems((current) =>
        current.map((target) =>
          target.id === item.id
            ? result.ok
              ? {
                  ...target,
                  status: "review",
                  previewUrl: result.url,
                  previewVersion: Date.now().toString(),
                  error: null,
                }
              : { ...target, status: "failed", error: result.error }
            : target,
        ),
      );
      setMsg(
        result.ok
          ? `${item.sku} 재처리가 끝났습니다. 다시 검수해 주세요.`
          : `${item.sku} 재처리에 실패했습니다: ${result.error}`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function reprocessAllRework() {
    const available = localItems.filter((item) => item.status === "rework");
    const targetCount = Math.max(
      1,
      Math.min(available.length, reworkCount),
    );
    const targets = available.slice(0, targetCount);
    if (!targets.length || busy) return;
    setBusy(true);
    let done = 0;
    try {
      const settings = (await fetch(
        "/api/products/image-workbench/settings",
      ).then((response) => response.json())) as WorkSettings;
      const concurrency = await inferenceConcurrency();
      for (let index = 0; index < targets.length; index += concurrency) {
        const batch = targets.slice(index, index + concurrency);
        await Promise.all(
          batch.map(async (item) => {
            const claimed = await call({ action: "claimRework", id: item.id });
            const job = claimed.job as Claimed | null;
            if (!job) return;
            setLocalItems((current) =>
              current.map((target) =>
                target.id === item.id
                  ? { ...target, status: "processing" }
                  : target,
              ),
            );
            const result = await processClaimed(job, settings);
            setLocalItems((current) =>
              current.map((target) =>
                target.id === item.id
                  ? result.ok
                    ? {
                        ...target,
                        status: "review",
                        previewUrl: result.url,
                        previewVersion: Date.now().toString(),
                        error: null,
                      }
                    : { ...target, status: "failed", error: result.error }
                  : target,
              ),
            );
          }),
        );
        done += batch.length;
        setMsg(`미통과 이미지 ${done}/${targets.length}개 재처리 완료…`);
      }
      setMsg(
        `미통과 이미지 ${done}개를 다시 처리했습니다. 다시 검수해 주세요.`,
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function bulkUpload() {
    const targets = localItems.filter((i) => i.status === "pass_ready");
    if (!targets.length) return;
    setBusy(true);
    const started = Date.now();
    setUpload({ done: 0, total: targets.length, started, updated: started });
    let done = 0;
    try {
      for (let index = 0; index < targets.length; index += 3) {
        const batch = targets.slice(index, index + 3);
        await Promise.all(
          batch.map((item) =>
            call({ action: "finalUpload", id: item.id, confirmed: true }),
          ),
        );
        done += batch.length;
        setUpload({
          done,
          total: targets.length,
          started,
          updated: Date.now(),
        });
        setLocalItems((current) =>
          current.filter(
            (item) => !batch.some((uploaded) => uploaded.id === item.id),
          ),
        );
      }
      setMsg(`${done}개 최종 업로드를 완료했습니다.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUpload(null);
      setBusy(false);
    }
  }
  const review = localItems.filter((i) => i.status === "review"),
    held = localItems.filter((i) => i.status === "held"),
    ready = localItems.filter((i) => i.status === "pass_ready"),
    queued = localItems.filter((i) =>
      ["queued", "processing"].includes(i.status),
    ),
    failed = localItems.filter((i) => i.status === "failed"),
    rework = localItems.filter((i) => i.status === "rework"),
    current = review[0] ?? null;
  const elapsed = upload ? (upload.updated - upload.started) / 1000 : 0;
  const eta =
    upload && upload.done > 0
      ? (elapsed / upload.done) * (upload.total - upload.done)
      : NaN;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!current || busy || upload) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "1" || event.key === "Enter") {
        event.preventDefault();
        void choose("pass", current.id);
      } else if (event.key === "2" || event.key.toLowerCase() === "h") {
        event.preventDefault();
        void choose("hold", current.id);
      } else if (event.key === "3") {
        event.preventDefault();
        void choose("rework", current.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, busy, upload, localItems]);
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <LocalAiStatusBadge />
      </div>
      {upload && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold">통과 이미지 최종 업로드 중</h2>
            <p className="mt-2 text-sm text-zinc-600">
              {upload.done}/{upload.total}개 완료 · 예상 남은 시간{" "}
              {duration(eta)}
            </p>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-200">
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{
                  width: `${upload.total ? (upload.done / upload.total) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              업로드가 끝날 때까지 이 화면을 닫지 마세요.
            </p>
          </div>
        </div>
      )}
      {flash && (
        <div className="fixed left-1/2 top-20 z-[110] -translate-x-1/2 rounded-full bg-zinc-950 px-6 py-3 text-base font-bold text-white shadow-xl">
          {flash}
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          disabled={busy}
          onClick={enqueue}
          className="cursor-pointer rounded bg-violet-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          미작업 100개 추가
        </button>
        <label className="flex items-center gap-2 rounded border bg-white px-3 py-2 text-sm font-semibold">
          자동 처리 수
          <input
            type="number"
            min="1"
            max="200"
            value={autoCount}
            onChange={(e) =>
              setAutoCount(
                Math.max(1, Math.min(200, Number(e.target.value) || 1)),
              )
            }
            className="w-20 rounded border px-2 py-1 text-right"
          />
          개
        </label>
        <button
          disabled={busy || !queued.length}
          onClick={run}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          설정 수량 자동 처리
        </button>
        <button
          disabled={busy || !ready.length}
          onClick={bulkUpload}
          className="cursor-pointer rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          통과 {ready.length}개 일괄 업로드
        </button>
        <button
          disabled={busy || !held.length}
          onClick={resumeHeld}
          className="cursor-pointer rounded bg-amber-500 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          보류 {held.length}개 다시 검수
        </button>
        <button
          disabled={busy || (!review.length && !ready.length && !held.length)}
          onClick={reprocess}
          className="cursor-pointer rounded border border-amber-500 bg-amber-50 px-4 py-2 font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          기존 검수 결과 개선 재처리
        </button>
        <span className="px-3 py-2 text-sm text-zinc-600">
          대기 {queued.length} · 검수 {review.length} · 보류 {held.length} ·
          업로드 대기 {ready.length} · 미통과 {rework.length} · 실패{" "}
          {failed.length}
        </span>
      </div>
      {msg && <p className="mb-4 rounded border bg-white p-3 text-sm">{msg}</p>}
      {ready.length > 0 && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
          통과 선택 {ready.length}개가 최종 업로드를 기다리고 있습니다.
        </div>
      )}
      <div>
        {current ? (
          <article key={current.id} className="rounded-xl border bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <strong>{current.sku}</strong>
                <span className="ml-2 text-sm text-zinc-500">
                  {current.productName}
                </span>
              </div>
              <span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-bold text-violet-800">
                남은 검수 {review.length}개
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-sm font-semibold">포카마켓 원본</p>
                <img
                  src={current.sourceUrl}
                  alt="원본"
                  className="h-[min(62vh,620px)] w-full rounded bg-zinc-100 object-contain"
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold">AI 자동 처리 결과</p>
                <img
                  src={
                    current.previewUrl
                      ? `${current.previewUrl}${current.previewUrl.includes("?") ? "&" : "?"}v=${current.previewVersion}`
                      : ""
                  }
                  alt="결과"
                  className="h-[min(62vh,620px)] w-full rounded bg-zinc-100 object-contain"
                />
              </div>
            </div>
            <div className="sticky bottom-3 z-20 mt-3 flex items-center justify-center gap-3 rounded-xl border bg-white/95 p-3 shadow-xl backdrop-blur">
              <button
                onClick={() => choose("pass", current.id)}
                className="min-w-36 cursor-pointer rounded-lg bg-emerald-700 px-7 py-3 text-lg font-bold text-white hover:bg-emerald-600"
              >
                통과 <span className="text-xs opacity-75">1 / Enter</span>
              </button>
              <button
                onClick={() => choose("hold", current.id)}
                className="min-w-36 cursor-pointer rounded-lg bg-amber-500 px-7 py-3 text-lg font-bold text-white hover:bg-amber-400"
              >
                보류 <span className="text-xs opacity-75">2 / H</span>
              </button>
              <button
                onClick={() => choose("rework", current.id)}
                className="min-w-36 cursor-pointer rounded-lg bg-rose-700 px-7 py-3 text-lg font-bold text-white hover:bg-rose-600"
              >
                미통과 <span className="text-xs opacity-75">3</span>
              </button>
              <a
                href={`/products/image-workbench?id=${current.productId}`}
                className="cursor-pointer rounded-lg border px-5 py-3 font-semibold hover:bg-zinc-50"
              >
                수동 작업
              </a>
            </div>
          </article>
        ) : (
          <div className="rounded border bg-white p-10 text-center text-zinc-500">
            검수 대기 결과가 없습니다.
            {held.length > 0 && (
              <button
                onClick={resumeHeld}
                className="mx-auto mt-4 block cursor-pointer rounded bg-amber-500 px-5 py-2 font-bold text-white"
              >
                보류 {held.length}개 다시 검수
              </button>
            )}
          </div>
        )}
      </div>
      {rework.length > 0 && (
        <details className="mt-5 rounded border border-rose-200 bg-white p-4">
          <summary className="cursor-pointer font-semibold text-rose-800">
            미통과·재작업 {rework.length}개
          </summary>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-rose-50 p-3">
            <span className="text-sm text-rose-900">
              미통과 항목을 새 엔진으로 처리한 뒤 다시 검수 대기에 올립니다.
            </span>
            <label className="ml-auto flex items-center gap-1 text-sm font-semibold text-rose-900">
              재작업
              <input
                type="number"
                min="1"
                max={rework.length}
                value={Math.min(reworkCount, rework.length)}
                onChange={(event) =>
                  setReworkCount(
                    Math.max(
                      1,
                      Math.min(rework.length, Number(event.target.value) || 1),
                    ),
                  )
                }
                className="w-20 rounded border border-rose-300 bg-white px-2 py-1.5 text-right"
              />
              개
            </label>
            <button
              disabled={busy}
              onClick={reprocessAllRework}
              className="cursor-pointer rounded bg-rose-700 px-4 py-2 font-bold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? "재처리 중…"
                : `${Math.min(reworkCount, rework.length)}개 자동 재처리`}
            </button>
          </div>
          {rework.map((item) => (
            <div
              key={item.id}
              className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
            >
              <span>
                {item.sku} · {item.productName}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => reprocessOne(item)}
                  className="cursor-pointer rounded border px-3 py-1.5 font-semibold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  즉시 자동 재처리
                </button>
                <a
                  href={`/products/image-workbench?id=${item.productId}`}
                  className="cursor-pointer rounded bg-zinc-900 px-3 py-1.5 font-semibold text-white"
                >
                  수동 작업
                </a>
              </div>
            </div>
          ))}
        </details>
      )}
      {failed.length > 0 && (
        <details className="mt-5 rounded border bg-white p-4">
          <summary className="cursor-pointer font-semibold">
            처리 실패 {failed.length}개
          </summary>
          {failed.map((i) => (
            <div
              key={i.id}
              className="mt-2 flex justify-between border-t pt-2 text-sm"
            >
              <span>
                {i.sku} · {i.error}
              </span>
              <button
                onClick={() => retry(i.id)}
                className="cursor-pointer font-semibold text-violet-700"
              >
                재시도
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
