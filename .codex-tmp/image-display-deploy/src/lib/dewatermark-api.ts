import sharp from "sharp";

const API_BASE_URL = "https://platform.dewatermark.ai";

type DewatermarkResponse = {
  edited_image?: {
    image?: string;
  };
};

export type DewatermarkApiMode = "STANDARD" | "PRO";

export async function getDewatermarkCreditBalance() {
  const apiKey = process.env.DEWATERMARK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("DEWATERMARK_API_KEY가 설정되지 않았습니다.");
  }
  const response = await fetch(`${API_BASE_URL}/api/creditInfo`, {
    headers: { "X-API-KEY": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: { available_credit?: number };
    message?: string;
    error?: string;
  };
  if (!response.ok) {
    const reason = body.message ?? body.error ?? `HTTP ${response.status}`;
    throw new Error(`Dewatermark 크레딧 조회 실패: ${String(reason).slice(0, 200)}`);
  }
  const available = Number(body.data?.available_credit);
  if (!Number.isFinite(available)) {
    throw new Error("Dewatermark 크레딧 응답을 확인할 수 없습니다.");
  }
  return Math.max(0, available);
}

function decodeResultImage(value: string) {
  const encoded = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new Error("Dewatermark API 결과 이미지가 비어 있습니다.");
  return buffer;
}

export async function removeWatermarkWithDewatermark(
  input: Buffer,
  mode: DewatermarkApiMode = "STANDARD",
) {
  const apiKey = process.env.DEWATERMARK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("DEWATERMARK_API_KEY가 설정되지 않았습니다.");
  }

  const jpeg = await sharp(input)
    .rotate()
    .resize({
      width: 6000,
      height: 6000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "white" })
    .jpeg({ quality: 95 })
    .toBuffer();
  const form = new FormData();
  const jpegArrayBuffer = jpeg.buffer.slice(
    jpeg.byteOffset,
    jpeg.byteOffset + jpeg.byteLength,
  ) as ArrayBuffer;
  form.append(
    "original_preview_image",
    new Blob([jpegArrayBuffer], { type: "image/jpeg" }),
    "photo-card.jpg",
  );

  const endpoint =
    mode === "PRO"
      ? "/api/object_removal/v1/erase_watermark_pro"
      : "/api/object_removal/v3/erase_watermark";
  if (mode === "STANDARD") {
    form.append("predict_mode", "4.0");
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "X-API-KEY": apiKey },
    body: form,
    // Vercel functions have a 60-second ceiling. Leave enough time to record
    // the failure and continue the batch instead of being terminated mid-job.
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await response.json().catch(() => ({}))) as DewatermarkResponse & {
    message?: string;
    error?: string;
  };
  if (!response.ok) {
    const reason = body.message ?? body.error ?? `HTTP ${response.status}`;
    throw new Error(`Dewatermark API 처리 실패: ${String(reason).slice(0, 300)}`);
  }
  const result = body.edited_image?.image;
  if (!result) throw new Error("Dewatermark API 응답에 결과 이미지가 없습니다.");
  return {
    buffer: decodeResultImage(result),
    mode,
  };
}
