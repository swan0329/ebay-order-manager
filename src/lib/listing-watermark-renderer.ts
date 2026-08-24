import sharp from "sharp";

/** Shared rendering controls used by both collection covers and individual card photos. */
export type WatermarkRenderSettings = {
  logo: Buffer | null;
  watermarkText: string | null;
  watermarkOpacity: number;
  watermarkLogoSize: number;
  watermarkGap: number;
};

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

async function applyAlphaOpacity(input: Buffer, opacity: number) {
  const rendered = await sharp(input, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaChannel = rendered.info.channels - 1;
  for (let index = alphaChannel; index < rendered.data.length; index += rendered.info.channels) rendered.data[index] = Math.round(rendered.data[index]! * opacity);
  return sharp(rendered.data, { raw: { width: rendered.info.width, height: rendered.info.height, channels: rendered.info.channels } }).png().toBuffer();
}

async function watermarkTile(settings: WatermarkRenderSettings) {
  const opacity = Math.max(0.03, Math.min(0.3, settings.watermarkOpacity));
  if (settings.logo?.length) {
    const size = Math.max(35, Math.min(220, settings.watermarkLogoSize));
    const resized = await sharp(settings.logo, { failOn: "none" }).resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).greyscale().ensureAlpha().png().toBuffer();
    return sharp(await applyAlphaOpacity(resized, opacity)).rotate(-18, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  }
  if (!settings.watermarkText?.trim()) return null;
  return Buffer.from(`<svg width="190" height="90" xmlns="http://www.w3.org/2000/svg"><text x="95" y="52" text-anchor="middle" transform="rotate(-18 95 45)" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#111" fill-opacity="${opacity}">${escapeXml(settings.watermarkText.trim())}</text></svg>`);
}

export async function createWatermarkOverlay(width: number, height: number, settings: WatermarkRenderSettings, startY = 0) {
  const canonicalTile = await watermarkTile(settings);
  if (!canonicalTile) return null;

  // Controls are expressed against the 1000px collection-cover canvas. Scale
  // the complete tile and gap for arbitrary source widths so both previews have
  // the same apparent watermark size when displayed at the same CSS width.
  const scale = width / 1000;
  const canonicalMetadata = await sharp(canonicalTile).metadata();
  const canonicalWidth = canonicalMetadata.width ?? 150;
  const tile = scale === 1
    ? canonicalTile
    : await sharp(canonicalTile, { failOn: "none" }).resize({ width: Math.max(1, Math.round(canonicalWidth * scale)) }).png().toBuffer();
  const metadata = await sharp(tile).metadata();
  const tileWidth = metadata.width ?? 150;
  const tileHeight = metadata.height ?? 80;
  const gap = Math.max(1, Math.round(Math.max(10, Math.min(180, settings.watermarkGap)) * scale));
  const placements: sharp.OverlayOptions[] = [];
  let row = 0;
  const step = tileWidth + gap;
  for (let y = startY; y < height; y += tileHeight + gap) {
    const offset = (row * Math.max(1, Math.round(step / 2))) % step;
    for (let x = offset; x < width; x += step) placements.push({ input: tile, left: x, top: y });
    row += 1;
  }
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(placements).png().toBuffer();
}
