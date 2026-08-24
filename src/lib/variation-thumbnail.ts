import sharp from "sharp";
import path from "node:path";

const SIZE = 1000;
const HEADER_HEIGHT = 150;
const DEFAULT_WATERMARK_OPACITY = 0.06;
const DEFAULT_WATERMARK_LOGO_SIZE = 50;
const DEFAULT_WATERMARK_GAP = 25;

export type VariationThumbnailInput = {
  groupName: string;
  albumName: string;
  imageUrls: string[];
  watermarkText?: string;
  watermarkLogo?: Buffer | null;
  watermarkOpacity?: number;
  watermarkLogoSize?: number;
  watermarkGap?: number;
};

export async function createVariationThumbnail(input: VariationThumbnailInput) {
  const urls = input.imageUrls.slice(0, 40);
  if (urls.length < 2) throw new Error("대표 썸네일에는 상품 이미지가 2장 이상 필요합니다.");

  const downloaded = await Promise.allSettled(urls.map(downloadImage));
  const buffers = downloaded.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (buffers.length !== urls.length) {
    throw new Error(`카드 이미지 ${urls.length}장 중 ${urls.length - buffers.length}장을 불러오지 못했습니다. 누락된 썸네일은 만들지 않습니다.`);
  }
  if (buffers.length < 2) {
    throw new Error("사용 가능한 카드 이미지가 2장 이상 필요합니다. 상품 이미지를 확인해 주세요.");
  }
  const gap = 6;
  const padding = 18;
  const gridWidth = SIZE - padding * 2;
  const gridHeight = SIZE - HEADER_HEIGHT - padding;
  const cardRatio = 54 / 86;
  const { columns, rows, cardWidth, cardHeight } = bestCardGrid(buffers.length, gridWidth, gridHeight, gap, cardRatio);
  const usedWidth = columns * cardWidth + (columns - 1) * gap;
  const usedHeight = rows * cardHeight + (rows - 1) * gap;
  const gridLeft = Math.round((SIZE - usedWidth) / 2);
  const gridTop = HEADER_HEIGHT + Math.max(0, Math.round((gridHeight - usedHeight) / 2));

  const cards = await Promise.all(buffers.map(async (buffer, index) => {
    const radius = Math.max(7, Math.min(16, Math.round(cardWidth * 0.075)));
    const roundedMask = Buffer.from(
      `<svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="${cardWidth}" height="${cardHeight}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
    );
    const card = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width: cardWidth, height: cardHeight, fit: "cover", position: "centre" })
      .ensureAlpha()
      .composite([{ input: roundedMask, blend: "dest-in" }])
      .png({ compressionLevel: 7 })
      .toBuffer();
    return {
      input: card,
      left: gridLeft + (index % columns) * (cardWidth + gap),
      top: gridTop + Math.floor(index / columns) * (cardHeight + gap),
    };
  }));

  const base = sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: "#ffffff" } });
  const header = await headerLayer(input.groupName, input.albumName);
  const watermark = await watermarkLayer(input);
  return base
    .composite([{ input: header, left: 0, top: 0 }, ...cards, ...(watermark ? [{ input: watermark, left: 0, top: 0 }] : [])])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
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
  const opacity = Math.max(0.03, Math.min(0.3, input.watermarkOpacity ?? DEFAULT_WATERMARK_OPACITY));
  let tile: Buffer | null = null;
  if (input.watermarkLogo?.length) {
    const logoSize = Math.max(35, Math.min(220, input.watermarkLogoSize ?? DEFAULT_WATERMARK_LOGO_SIZE));
    tile = await sharp(input.watermarkLogo, { failOn: "none" })
      .resize({ width: logoSize, height: logoSize, fit: "inside", withoutEnlargement: true })
      .greyscale()
      .ensureAlpha()
      // greyscale 뒤 ensureAlpha()는 회색·알파 2개 밴드다. 현재 Sharp에서는
      // 4개 밴드 배열 확장을 지원하지 않으므로 알파 밴드만 투명도로 조절한다.
      .linear([1, opacity], [0, 0])
      .rotate(-18, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } else if (input.watermarkText?.trim()) {
    tile = Buffer.from(watermarkTextSvg(input.watermarkText.trim(), opacity));
  }
  if (!tile) return null;
  const metadata = await sharp(tile).metadata();
  const width = metadata.width ?? 150;
  const height = metadata.height ?? 80;
  const placements: sharp.OverlayOptions[] = [];
  const gap = Math.max(10, Math.min(180, input.watermarkGap ?? DEFAULT_WATERMARK_GAP));
  let row = 0;
  const step = width + gap;
  for (let y = HEADER_HEIGHT + 8; y < SIZE; y += height + gap) {
    // 항상 x=0에서 시작하면 왼쪽에 세로 워터마크 줄이 생긴다. 행마다 반 칸씩
    // 앞으로 이동해 화면 전체에서 자연스럽게 대각선으로 이어지게 한다.
    const offset = (row * Math.max(1, Math.round(step / 2))) % step;
    for (let x = offset; x < SIZE; x += width + gap) {
      placements.push({ input: tile, left: x, top: y });
    }
    row += 1;
  }
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(placements)
    .png()
    .toBuffer();
}

async function headerLayer(groupName: string, albumName: string) {
  const fontfile = path.join(process.cwd(), "assets", "fonts", "NotoSansKR.ttf");
  const [title, subtitle] = await Promise.all([
    sharp({ text: { text: `<span foreground="#111111" font_weight="700" font_size="34pt">${escapeXml(groupName)}</span>`, font: "Noto Sans KR", fontfile, width: 944, height: 62, align: "centre", rgba: true } }).png().toBuffer(),
    sharp({ text: { text: `<span foreground="#444444" font_weight="500" font_size="21pt">${escapeXml(albumName)}</span>`, font: "Noto Sans KR", fontfile, width: 944, height: 48, align: "centre", rgba: true } }).png().toBuffer(),
  ]);
  const line = Buffer.from(`<svg width="1000" height="150" xmlns="http://www.w3.org/2000/svg"><line x1="28" y1="140" x2="972" y2="140" stroke="#e4e4e7" stroke-width="2"/></svg>`);
  return sharp({ create: { width: SIZE, height: HEADER_HEIGHT, channels: 3, background: "#ffffff" } })
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
