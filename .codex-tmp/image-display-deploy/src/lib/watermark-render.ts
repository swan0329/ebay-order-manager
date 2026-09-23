import sharp from "sharp";
import { watermarkSettingLimits } from "@/lib/watermark-setting-limits";

export type WatermarkRenderValues = {
  watermarkOpacity: number;
  watermarkLogoSize: number;
  watermarkGap: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizedWatermarkValues(
  settings: WatermarkRenderValues,
  imageReferenceSize = 1000,
) {
  const scale = clamp(imageReferenceSize / 1000, 0.2, 4);
  return {
    opacity: clamp(settings.watermarkOpacity, watermarkSettingLimits.opacity.min, watermarkSettingLimits.opacity.max),
    logoSize: Math.max(1, Math.round(clamp(settings.watermarkLogoSize, watermarkSettingLimits.logoSize.min, watermarkSettingLimits.logoSize.max) * scale)),
    gap: Math.round(clamp(settings.watermarkGap, watermarkSettingLimits.gap.min, watermarkSettingLimits.gap.max) * scale),
  };
}

export async function createWatermarkLogoTile(
  watermarkLogo: Buffer,
  values: ReturnType<typeof normalizedWatermarkValues>,
) {
  // The configured size is authoritative. A small uploaded PNG must be
  // enlarged too; otherwise a 30px logo silently stays tiny on every channel.
  // Transparent PNG logos already contain the exact silhouette that must be
  // preserved. Flattening them first blends translucent white/grey artwork
  // into a solid backdrop and later turns it into the large grey blobs seen
  // on group thumbnails. Only derive an ink mask for genuinely opaque images
  // that need their white backdrop removed.
  const resized = await sharp(watermarkLogo, { failOn: "none" })
    .resize({ width: values.logoSize, height: values.logoSize, fit: "inside" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const resizedRaw = await sharp(resized).raw().toBuffer({ resolveWithObject: true });
  const hasTransparentArtwork = hasMeaningfulTransparency(resizedRaw.data, resizedRaw.info.channels);
  const rotated = await sharp(resized)
    .rotate(-18, { background: hasTransparentArtwork
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 255, g: 255, b: 255, alpha: 1 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = rotated;

  if (info.channels !== 4) throw new Error("워터마크 로고를 RGBA로 변환하지 못했습니다.");
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    // Pure white is the uploaded-logo backdrop. Preserve dark or saturated
    // logo ink, including coloured logos which would otherwise disappear.
    const sourceAlpha = data[index + 3] / 255;
    const ink = hasTransparentArtwork
      ? sourceAlpha
      : clamp(Math.max((245 - luminance) / 150, chroma / 120), 0, 1);
    // Match the single-card browser preview: retain the logo's light/dark
    // detail in grayscale and apply the setting only to alpha. Turning every
    // visible pixel dark made the K-POP letters and flowers one grey blob.
    const outputLuminance = hasTransparentArtwork ? Math.round(luminance) : 20;
    data[index] = outputLuminance;
    data[index + 1] = outputLuminance;
    data[index + 2] = outputLuminance;
    data[index + 3] = Math.round(255 * values.opacity * ink);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

function hasMeaningfulTransparency(data: Buffer, channels: number) {
  if (channels < 4) return false;
  let transparentPixels = 0;
  const pixelCount = data.length / channels;
  for (let index = 3; index < data.length; index += channels) {
    if (data[index] < 250) transparentPixels += 1;
  }
  return transparentPixels / pixelCount > 0.005;
}
