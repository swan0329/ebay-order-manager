import sharp from "sharp";

const CF_MODEL = "@cf/openai/clip-vit-base-patch32";
const requestTimeoutMs = 30_000;
const maxRetries = 2;
const retryBaseDelayMs = 1_000;

export const clipEmbeddingDim = 512;

type ClipDebugInfo = {
  attempts: number;
  lastStatus?: number;
  lastBodySnippet?: string;
  payloadShape?: string;
  endpoint?: string;
};

export function isClipConfigured(): boolean {
  return Boolean(
    sanitizeToken(process.env.CF_ACCOUNT_ID) &&
      sanitizeToken(process.env.CF_API_TOKEN),
  );
}

function sanitizeToken(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/^[﻿​‎‏\s"']+/, "")
    .replace(/[﻿​‎‏\s"']+$/, "");
  return cleaned || undefined;
}

async function normalizeForClip(buffer: Buffer | Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(buffer), { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
}

function parseEmbedding(payload: unknown): number[] | null {
  if (Array.isArray(payload) && payload.length > 0 && typeof payload[0] === "number") {
    return payload as number[];
  }

  if (
    Array.isArray(payload) &&
    payload.length > 0 &&
    Array.isArray(payload[0]) &&
    (payload[0] as unknown[]).length > 0 &&
    typeof (payload[0] as unknown[])[0] === "number"
  ) {
    return payload[0] as number[];
  }

  return null;
}

function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const cause = (error as { cause?: unknown }).cause;
  let causeText = "";
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    causeText = ` | cause: ${cause.name}: ${cause.message}${code ? ` (${code})` : ""}`;
  } else if (cause && typeof cause === "object") {
    try {
      causeText = ` | cause: ${JSON.stringify(cause).slice(0, 200)}`;
    } catch {
      causeText = " | cause: [unserializable]";
    }
  } else if (cause) {
    causeText = ` | cause: ${String(cause)}`;
  }
  return `${error.name}: ${error.message}${causeText}`.slice(0, 400);
}

function describePayload(payload: unknown): string {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return "empty array";
    if (typeof payload[0] === "number") return `1D number[${payload.length}]`;
    if (Array.isArray(payload[0])) {
      return `2D [${payload.length}, ${(payload[0] as unknown[]).length}]`;
    }
    return `array of ${typeof payload[0]}`;
  }
  if (payload && typeof payload === "object") {
    return `object keys=${Object.keys(payload as Record<string, unknown>).slice(0, 5).join(",")}`;
  }
  return typeof payload;
}

export async function embedImageWithClipDetailed(
  buffer: Buffer | Uint8Array,
): Promise<{ embedding: number[] | null; debug: ClipDebugInfo }> {
  const debug: ClipDebugInfo = { attempts: 0 };
  const accountId = sanitizeToken(process.env.CF_ACCOUNT_ID);
  const token = sanitizeToken(process.env.CF_API_TOKEN);

  if (!accountId || !token) {
    debug.lastBodySnippet =
      "CF_ACCOUNT_ID 또는 CF_API_TOKEN이 설정되지 않았습니다.";
    return { embedding: null, debug };
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODEL}`;
  debug.endpoint = endpoint;

  const normalized = await normalizeForClip(buffer).catch(() => null);

  if (!normalized) {
    debug.lastBodySnippet = "이미지 정규화 실패";
    return { embedding: null, debug };
  }

  const imageBytes = Array.from(new Uint8Array(normalized));

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    debug.attempts += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ image: imageBytes }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      debug.lastStatus = response.status;

      if (response.status === 429 || response.status === 503) {
        const delay = retryBaseDelayMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        debug.lastBodySnippet = text.slice(0, 300);
        return { embedding: null, debug };
      }

      const json = (await response.json()) as {
        success?: boolean;
        result?: { data?: unknown; shape?: number[] };
        errors?: unknown;
        messages?: unknown;
      };

      if (!json.success) {
        debug.lastBodySnippet = `success=false errors=${JSON.stringify(json.errors ?? json.messages ?? json).slice(0, 250)}`;
        return { embedding: null, debug };
      }

      const data = json.result?.data;
      debug.payloadShape = describePayload(data);
      const embedding = parseEmbedding(data);

      if (!embedding || embedding.length !== clipEmbeddingDim) {
        debug.lastBodySnippet = `unexpected shape: ${debug.payloadShape} (expected ${clipEmbeddingDim}-dim)`;
        return { embedding: null, debug };
      }

      return { embedding: normalizeVector(embedding), debug };
    } catch (error) {
      clearTimeout(timeout);
      debug.lastBodySnippet = describeFetchError(error);
      if (attempt === maxRetries - 1) {
        return { embedding: null, debug };
      }
      await new Promise((resolve) =>
        setTimeout(resolve, retryBaseDelayMs * (attempt + 1)),
      );
    }
  }

  return { embedding: null, debug };
}

export async function embedImageWithClip(
  buffer: Buffer | Uint8Array,
): Promise<number[] | null> {
  const { embedding } = await embedImageWithClipDetailed(buffer);
  return embedding;
}

function normalizeVector(values: number[]): number[] {
  let sumSquares = 0;

  for (const value of values) {
    sumSquares += value * value;
  }

  const norm = Math.sqrt(sumSquares);

  if (norm === 0) {
    return values.slice();
  }

  const out = new Array<number>(values.length);

  for (let i = 0; i < values.length; i += 1) {
    out[i] = (values[i] ?? 0) / norm;
  }

  return out;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;

  let dot = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }

  return Math.max(-1, Math.min(1, dot));
}
