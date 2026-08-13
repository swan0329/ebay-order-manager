"use client";

import {
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
  type Tensor,
  env,
} from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/clip-vit-base-patch32";

type CLIPModel = Awaited<ReturnType<typeof CLIPVisionModelWithProjection.from_pretrained>>;
type CLIPProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;

let modelPromise: Promise<{ model: CLIPModel; processor: CLIPProcessor }> | null = null;

export function isClipReady(): boolean {
  return modelPromise !== null;
}

let activeDevice: "webgpu" | "wasm" = "wasm";

export function getActiveDevice() {
  return activeDevice;
}

async function detectWebGPU(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
    const adapter = await (navigator as unknown as {
      gpu: { requestAdapter: () => Promise<unknown> };
    }).gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

export async function loadClip(
  onProgress?: (info: { status: string; progress?: number; file?: string }) => void,
) {
  if (!modelPromise) {
    modelPromise = (async () => {
      const useWebGPU = await detectWebGPU();
      activeDevice = useWebGPU ? "webgpu" : "wasm";

      const modelOptions = useWebGPU
        ? { device: "webgpu" as const, dtype: "fp16" as const }
        : {};

      const [model, processor] = await Promise.all([
        CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
          ...modelOptions,
          progress_callback: (raw: unknown) => {
            const data = raw as { status?: string; progress?: number; file?: string };
            onProgress?.({
              status: data.status ?? "",
              progress: data.progress,
              file: data.file,
            });
          },
        }),
        AutoProcessor.from_pretrained(MODEL_ID),
      ]);
      return { model, processor };
    })().catch((error) => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

export async function embedImageBlob(blob: Blob): Promise<number[]> {
  const { model, processor } = await loadClip();
  const image = await RawImage.fromBlob(blob);
  const inputs = await processor(image);
  const output = await model(inputs);
  const tensor = output.image_embeds as Tensor;
  const data = tensor.data as Float32Array;
  return Array.from(data);
}

export async function embedImageUrl(url: string): Promise<number[]> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`이미지 로드 실패 (${response.status})`);
  const blob = await response.blob();
  return embedImageBlob(blob);
}
