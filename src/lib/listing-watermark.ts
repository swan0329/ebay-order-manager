import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";
import { getExistingR2PublicUrl, uploadBufferToR2 } from "@/lib/r2";
import { getListingWatermarkSettings, type ListingWatermarkSettings } from "@/lib/variation-thumbnail-settings";
import { createWatermarkOverlay } from "@/lib/listing-watermark-renderer";

export type ResolvedWatermark = ListingWatermarkSettings & { logo: Buffer | null; signature: string };

export function listingWatermarkSignature(settings: Omit<ListingWatermarkSettings, "logoKey">) {
  return createHash("sha256").update(JSON.stringify({
    logoUrl: settings.logoUrl,
    watermarkText: settings.watermarkText,
    watermarkOpacity: settings.watermarkOpacity,
    watermarkLogoSize: settings.watermarkLogoSize,
    watermarkGap: settings.watermarkGap,
    applyToIndividualCards: settings.applyToIndividualCards,
  })).digest("hex").slice(0, 24);
}

async function loadLogo(url: string | null) {
  if (!url) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("저장된 워터마크 로고를 불러오지 못했습니다.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2_000_000) throw new Error("저장된 워터마크 로고가 너무 큽니다.");
  return Buffer.from(bytes);
}

export async function resolveListingWatermark(userId: string): Promise<ResolvedWatermark> {
  const settings = await getListingWatermarkSettings(userId);
  const logo = await loadLogo(settings.logoUrl);
  const signature = listingWatermarkSignature(settings);
  return { ...settings, logo, signature };
}

/**
 * Never alters the approved source image. It writes a deterministic sales-only
 * copy to R2, so a changed logo/size/text automatically gets a new URL.
 */
export async function createWatermarkedImageBuffer(sourceUrl: string, settings: ResolvedWatermark) {
  // 개별 카드 적용 여부는 관리자가 저장한 선택값을 반드시 따른다.
  if (!settings.applyToIndividualCards || (!settings.logo && !settings.watermarkText?.trim())) {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`개별 카드 이미지를 불러오지 못했습니다. (${response.status})`);
    return { buffer: Buffer.from(await response.arrayBuffer()), applied: false };
  }
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`개별 카드 이미지를 불러오지 못했습니다. (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 15 * 1024 * 1024) throw new Error("개별 카드 이미지가 너무 큽니다.");
  const source = Buffer.from(bytes);
  const metadata = await sharp(source, { failOn: "none" }).rotate().metadata();
  if (!metadata.width || !metadata.height) throw new Error("개별 카드 이미지 형식을 확인할 수 없습니다.");
  const overlay = await createWatermarkOverlay(metadata.width, metadata.height, settings);
  if (!overlay) return { buffer: source, applied: false };
  const buffer = await sharp(source, { failOn: "none" }).rotate().ensureAlpha().composite([{ input: overlay }]).jpeg({ quality: 93, chromaSubsampling: "4:4:4" }).toBuffer();
  return { buffer, applied: true };
}

export async function createWatermarkedListingImage(sourceUrl: string, settings: ResolvedWatermark) {
  const shouldApply = settings.applyToIndividualCards && Boolean(settings.logo || settings.watermarkText?.trim());
  // 워터마크를 쓰지 않는 설정에서는 원본 URL을 그대로 사용한다. 이전에는 결과를
  // 버리면서도 매 작업마다 원본 이미지를 전부 내려받아 대량등록을 지연시켰다.
  if (!shouldApply) return { url: sourceUrl, signature: settings.signature, applied: false };
  const keyHash = createHash("sha256").update(`${sourceUrl}\u0000${settings.signature}`).digest("hex").slice(0, 32);
  const key = `products/listing-watermarks/${keyHash}.jpg`;
  const existingUrl = await getExistingR2PublicUrl(key);
  if (existingUrl) return { url: existingUrl, signature: settings.signature, applied: true };
  const rendered = await createWatermarkedImageBuffer(sourceUrl, settings);
  const uploaded = await uploadBufferToR2({ buffer: rendered.buffer, key, contentType: "image/jpeg" });
  return { url: uploaded.url, signature: settings.signature, applied: true };
}
