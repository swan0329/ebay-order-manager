import sharp from "sharp";
import path from "node:path";
import { createWatermarkLogoTile, normalizedWatermarkValues } from "@/lib/watermark-render";
import { createPreparedListingImage } from "@/lib/ebay-watermarked-images";
import { variationWatermarkPlacements } from "@/lib/variation-watermark-placement";

const WIDTH = 800;
const HEIGHT = 1200;
const HEADER_HEIGHT = 150;
const DEFAULT_WATERMARK_OPACITY = 0.06;
const DEFAULT_WATERMARK_LOGO_SIZE = 50;
const DEFAULT_WATERMARK_GAP = 25;
export const variationThumbnailRenderVersion = "v11-uniform-800x1200-all-cards";

export type VariationThumbnailInput = {
  groupName: string;
  albumName: string;
  imageUrls: string[];
  watermarkText?: string;
  watermarkLogo?: Buffer | null;
  watermarkOpacity?: number;
  watermarkLogoSize?: number;
  watermarkGap?: number;
  imageExposure?: number;
  imageContrast?: number;
  imageSaturation?: number;
  imageRotation?: number;
  imageZoom?: number;
  imageFlipHorizontal?: boolean;
  backgroundImageUrl?: string | null;
  backgroundEligible?: boolean[];
  backgroundPadding?: number;
  backgroundColor?: string;
  backgroundEnabled?: boolean;
  shadowEnabled?: boolean;
  shadowOpacity?: number;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
};

export async function createVariationThumbnail(input: VariationThumbnailInput) {
  const base = await createVariationThumbnailBase(input);
  return applyVariationThumbnailWatermark(base, input);
}

/**
 * The card layout is independent of the repeating watermark. Keeping it
 * separate lets the settings screen redraw watermark controls immediately
 * while the server still produces the exact upload renderer result.
 */
export async function createVariationThumbnailBase(input: VariationThumbnailInput) {
  const urls = input.imageUrls;
  if (urls.length > 250) throw new Error("대표 썸네일은 최대 250장까지 지원합니다. 일부 카드만 포함해 생성하지 않습니다.");
  if (urls.length < 2) throw new Error("대표 썸네일에는 상품 이미지가 2장 이상 필요합니다.");

  // Large groups can contain 40 source files. Restricting concurrent downloads
  // avoids exhausting the server's image decoder and is faster in practice.
  const downloaded = await mapWithConcurrency(urls, 8, async (url) => {
    try { return { status: "fulfilled" as const, value: await downloadImage(url) }; }
    catch { return { status: "rejected" as const }; }
  });
  const buffers = downloaded.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (buffers.length !== urls.length) {
    throw new Error(`카드 이미지 ${urls.length}장 중 ${urls.length - buffers.length}장을 불러오지 못했습니다. 누락된 썸네일은 만들지 않습니다.`);
  }
  if (buffers.length < 2) {
    throw new Error("사용 가능한 카드 이미지가 2장 이상 필요합니다. 상품 이미지를 확인해 주세요.");
  }
  const gap = 6;
  const padding = 18;
  const gridWidth = WIDTH - padding * 2;
  const gridHeight = HEIGHT - HEADER_HEIGHT - padding;
  const cardRatio = WIDTH / HEIGHT;
  const { columns, rows, cardWidth, cardHeight } = bestCardGrid(buffers.length, gridWidth, gridHeight, gap, cardRatio);
  const usedWidth = columns * cardWidth + (columns - 1) * gap;
  const usedHeight = rows * cardHeight + (rows - 1) * gap;
  const gridLeft = Math.round((WIDTH - usedWidth) / 2);
  const gridTop = HEADER_HEIGHT + Math.max(0, Math.round((gridHeight - usedHeight) / 2));

  const background = input.backgroundImageUrl ? await downloadImage(input.backgroundImageUrl) : null;
  const cards = await mapWithConcurrency(buffers, 4, async (buffer, index) => {
    const prepared = await createPreparedListingImage(buffer, {
      ...input,
      watermarkOpacity: input.watermarkOpacity ?? DEFAULT_WATERMARK_OPACITY,
      watermarkLogoSize: input.watermarkLogoSize ?? DEFAULT_WATERMARK_LOGO_SIZE,
      watermarkGap: input.watermarkGap ?? DEFAULT_WATERMARK_GAP,
    }, {
      backgroundEligible: Boolean(input.backgroundEligible?.[index]),
      background,
    });
    const card = await sharp(prepared).resize({ width: cardWidth, height: cardHeight, fit: "contain", background: "#ffffff" }).png().toBuffer();
    return {
      input: card,
      left: gridLeft + (index % columns) * (cardWidth + gap),
      top: gridTop + Math.floor(index / columns) * (cardHeight + gap),
    };
  });

  const base = sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: "#ffffff" } });
  const header = await headerLayer(input.groupName, input.albumName);
  // Group thumbnails have their own watermark settings. Interpret those values
  // against the group canvas, not a tiny member-card size.
  return base
    .composite([{ input: header, left: 0, top: 0 }, ...cards])
    .jpeg({ quality: 86, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

export async function applyVariationThumbnailWatermark(base: Buffer, input: VariationThumbnailInput) {
  const watermark = await watermarkLayer(input);
  return sharp(base)
    .composite(watermark ? [{ input: watermark, left: 0, top: 0 }] : [])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function bestCardGrid(count: number, width: number, height: number, gap: number, ratio: number) {
  let best = { columns: 1, rows: count, cardWidth: 1, cardHeight: 1, area: 0 };
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const maxWidth = (width - gap * (columns - 1)) / columns;
    const maxHeight = (height - gap * (rows - 1)) / rows;
    const cardWidth = Math.max(1, Math.floor(Math.min(maxWidth, maxHeight * ratio)));
    const cardHeight = Math.max(1, Math.floor(cardWidth / ratio));
    const area = cardWidth * cardHeight;
    if (area > best.area) best = { columns, rows, cardWidth, cardHeight, area };
  }
  return best;
}

async function downloadImage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`상품 이미지를 불러오지 못했습니다. (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 15 * 1024 * 1024) throw new Error("상품 이미지가 너무 큽니다.");
  const buffer = Buffer.from(bytes);
  const metadata = await sharp(buffer, { failOn: "none" }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("유효한 상품 이미지가 아닙니다.");
  return buffer;
}

async function watermarkLayer(input: VariationThumbnailInput) {
  const values = normalizedWatermarkValues({
    watermarkOpacity: input.watermarkOpacity ?? DEFAULT_WATERMARK_OPACITY,
    watermarkLogoSize: input.watermarkLogoSize ?? DEFAULT_WATERMARK_LOGO_SIZE,
    watermarkGap: input.watermarkGap ?? DEFAULT_WATERMARK_GAP,
  });
  const opacity = values.opacity;
  let tile: Buffer | null = null;
  if (input.watermarkLogo?.length) {
    tile = await createWatermarkLogoTile(input.watermarkLogo, values);
  } else if (input.watermarkText?.trim()) {
    tile = Buffer.from(watermarkTextSvg(input.watermarkText.trim(), opacity));
  }
  if (!tile) return null;
  const metadata = await sharp(tile).metadata();
  const width = metadata.width ?? 150;
  const height = metadata.height ?? 80;
  const placements = await Promise.all(variationWatermarkPlacements({
    canvasWidth: WIDTH, canvasHeight: HEIGHT, headerHeight: HEADER_HEIGHT,
    tileWidth: width, tileHeight: height, repeatDistancePercent: values.gap,
  }).map(async (placement): Promise<sharp.OverlayOptions> => {
    const isWholeTile = placement.sourceLeft === 0 && placement.sourceTop === 0
      && placement.width === width && placement.height === height;
    const overlay = isWholeTile ? tile! : await sharp(tile!).extract({
      left: placement.sourceLeft,
      top: placement.sourceTop,
      width: placement.width,
      height: placement.height,
    }).png().toBuffer();
    return { input: overlay, left: placement.left, top: placement.top };
  }));
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(placements)
    .png()
    .toBuffer();
}

async function headerLayer(groupName: string, albumName: string) {
  const fontfile = path.join(process.cwd(), "assets", "fonts", "NotoSansKR.ttf");
  const [title, subtitle] = await Promise.all([
    sharp({ text: { text: `<span foreground="#111111" font_weight="700" font_size="34pt">${escapeXml(groupName)}</span>`, font: "Noto Sans KR", fontfile, width: WIDTH - 56, height: 62, align: "centre", rgba: true } }).png().toBuffer(),
    sharp({ text: { text: `<span foreground="#444444" font_weight="500" font_size="21pt">${escapeXml(albumName)}</span>`, font: "Noto Sans KR", fontfile, width: WIDTH - 56, height: 48, align: "centre", rgba: true } }).png().toBuffer(),
  ]);
  const line = Buffer.from(`<svg width="800" height="150" xmlns="http://www.w3.org/2000/svg"><line x1="28" y1="140" x2="772" y2="140" stroke="#e4e4e7" stroke-width="2"/></svg>`);
  return sharp({ create: { width: WIDTH, height: HEADER_HEIGHT, channels: 3, background: "#ffffff" } })
    .composite([{ input: title, left: 28, top: 12 }, { input: subtitle, left: 28, top: 82 }, { input: line, left: 0, top: 0 }])
    .png().toBuffer();
}

function watermarkTextSvg(text: string, opacity: number) {
  return `<svg width="190" height="90" xmlns="http://www.w3.org/2000/svg">
    <text x="95" y="52" text-anchor="middle" transform="rotate(-18 95 45)" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#111" fill-opacity="${opacity}">${escapeXml(text)}</text>
  </svg>`;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}
