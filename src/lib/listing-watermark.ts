import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";
import { uploadBufferToR2 } from "@/lib/r2";
import { getListingWatermarkSettings, type ListingWatermarkSettings } from "@/lib/variation-thumbnail-settings";

type ResolvedWatermark = ListingWatermarkSettings & { logo: Buffer | null; signature: string };

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

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
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

async function watermarkTile(settings: ResolvedWatermark) {
  const opacity = Math.max(0.03, Math.min(0.3, settings.watermarkOpacity));
  if (settings.logo?.length) {
    const size = Math.max(35, Math.min(220, settings.watermarkLogoSize));
    return sharp(settings.logo, { failOn: "none" })
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .greyscale().ensureAlpha().linear([1, opacity], [0, 0])
      .rotate(-18, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  }
  if (!settings.watermarkText?.trim()) return null;
  return Buffer.from(`<svg width="190" height="90" xmlns="http://www.w3.org/2000/svg"><text x="95" y="52" text-anchor="middle" transform="rotate(-18 95 45)" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#111" fill-opacity="${opacity}">${escapeXml(settings.watermarkText.trim())}</text></svg>`);
}

async function watermarkOverlay(width: number, height: number, settings: ResolvedWatermark) {
  const tile = await watermarkTile(settings);
  if (!tile) return null;
  const metadata = await sharp(tile).metadata();
  const tileWidth = metadata.width ?? 150;
  const tileHeight = metadata.height ?? 80;
  const gap = Math.max(10, Math.min(180, settings.watermarkGap));
  const placements: sharp.OverlayOptions[] = [];
  let row = 0;
  for (let y = 0; y < height; y += tileHeight + gap) {
    const offset = row % 2 === 0 ? 0 : -Math.round((tileWidth + gap) / 2);
    for (let x = offset; x < width; x += tileWidth + gap) {
      if (x + tileWidth > 0) placements.push({ input: tile, left: Math.max(0, x), top: y });
    }
    row += 1;
  }
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(placements).png().toBuffer();
}

/**
 * Never alters the approved source image. It writes a deterministic sales-only
 * copy to R2, so a changed logo/size/text automatically gets a new URL.
 */
export async function createWatermarkedListingImage(sourceUrl: string, settings: ResolvedWatermark) {
  if (!settings.applyToIndividualCards || (!settings.logo && !settings.watermarkText?.trim())) {
    return { url: sourceUrl, signature: settings.signature, applied: false };
  }
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`개별 카드 이미지를 불러오지 못했습니다. (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 15 * 1024 * 1024) throw new Error("개별 카드 이미지가 너무 큽니다.");
  const source = Buffer.from(bytes);
  const metadata = await sharp(source, { failOn: "none" }).rotate().metadata();
  if (!metadata.width || !metadata.height) throw new Error("개별 카드 이미지 형식을 확인할 수 없습니다.");
  const overlay = await watermarkOverlay(metadata.width, metadata.height, settings);
  if (!overlay) return { url: sourceUrl, signature: settings.signature, applied: false };
  const keyHash = createHash("sha256").update(`${sourceUrl}\u0000${settings.signature}`).digest("hex").slice(0, 32);
  const buffer = await sharp(source, { failOn: "none" }).rotate().ensureAlpha().composite([{ input: overlay }]).jpeg({ quality: 93, chromaSubsampling: "4:4:4" }).toBuffer();
  const uploaded = await uploadBufferToR2({ buffer, key: `products/listing-watermarks/${keyHash}.jpg`, contentType: "image/jpeg" });
  return { url: uploaded.url, signature: settings.signature, applied: true };
}
