import { createHash } from "node:crypto";
import sharp from "sharp";
import { buildPublicR2Url, getObjectFromR2, uploadBufferToR2 } from "@/lib/r2";
import {
  getListingImageSettings,
  type ListingImageSettings,
} from "@/lib/variation-thumbnail-settings";
import { createWatermarkLogoTile, normalizedWatermarkValues } from "@/lib/watermark-render";

export const listingWatermarkRenderVersion = "v15-uniform-800x1200";
import { LISTING_IMAGE_SIZE, LISTING_IMAGE_WIDTH, listingImageBox, portraitRotation, listingImageCornerRadius } from "@/lib/listing-image-layout";
const maxImageBytes = 15 * 1024 * 1024;

type WatermarkRenderSettings = Pick<
  ListingImageSettings,
  "watermarkOpacity" | "watermarkLogoSize" | "watermarkGap"
> & Partial<Omit<ListingImageSettings, "logoUrl" | "logoKey" | "backgroundUrl" | "backgroundKey" | "watermarkEnabled">> &
  Partial<Pick<ListingImageSettings, "backgroundEnabled">>;

export type ListingImageRenderOptions = {
  backgroundEligible?: boolean;
  background?: Buffer | null;
};

function listingWatermarkKey(
  imageUrl: string,
  logoIdentity: string,
  settings: ListingImageSettings,
  backgroundEligible: boolean,
) {
  const hash = createHash("sha256")
    .update([listingWatermarkRenderVersion, imageUrl, logoIdentity, String(backgroundEligible), JSON.stringify(settings)].join("\0"))
    .digest("hex");
  return `products/channel-watermarked/${hash}.jpg`;
}

async function downloadImage(url: string, label: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${label}을 불러오지 못했습니다. (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxImageBytes) throw new Error(`${label}의 용량이 너무 큽니다.`);
  return Buffer.from(bytes);
}

export async function createEbayWatermarkedImage(
  source: Buffer,
  watermarkLogo: Buffer | null,
  settings: WatermarkRenderSettings = {
    watermarkOpacity: 0.06,
    watermarkLogoSize: 50,
    watermarkGap: 25,
  },
  options: ListingImageRenderOptions = {},
) {
  const prepared = await createPreparedListingImage(source, settings, options);
  const normalized = sharp(prepared, { failOn: "none" });
  const metadata = await normalized.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("유효한 상품 이미지가 아닙니다.");
  }

  if (!watermarkLogo) return normalized.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  const values = normalizedWatermarkValues(settings, Math.min(metadata.width, metadata.height));
  const logoSize = values.logoSize;
  const gap = values.gap;
  const tile = await createWatermarkLogoTile(watermarkLogo, values);
  const tileMetadata = await sharp(tile).metadata();
  const tileWidth = tileMetadata.width ?? logoSize;
  const tileHeight = tileMetadata.height ?? logoSize;
  const placements: sharp.OverlayOptions[] = [];
  const horizontalStep = Math.max(10, tileWidth + gap);
  const verticalStep = Math.max(10, tileHeight + gap);
  const centerX = Math.round(metadata.width / 2);
  const centerY = Math.round(metadata.height / 2);
  // The middle logo stays fixed at the image centre. Enlarging a logo grows it
  // evenly around each grid centre instead of expanding from the top-left.
  for (let rowIndex = -Math.ceil(centerY / verticalStep); ; rowIndex += 1) {
    const y = centerY + rowIndex * verticalStep - Math.round(tileHeight / 2);
    if (y >= metadata.height) break;
    const stagger = Math.abs(rowIndex % 2) === 1 ? Math.round(horizontalStep / 2) : 0;
    for (let columnIndex = -Math.ceil((centerX + stagger) / horizontalStep); ; columnIndex += 1) {
      const x = centerX + stagger + columnIndex * horizontalStep - Math.round(tileWidth / 2);
      if (x >= metadata.width) break;
      if (x + tileWidth > 0 && y + tileHeight > 0) {
        const left = Math.max(0, x), top = Math.max(0, y);
        const width = Math.min(metadata.width, x + tileWidth) - left;
        const height = Math.min(metadata.height, y + tileHeight) - top;
        if (width > 0 && height > 0) placements.push({
          input: await sharp(tile).extract({ left: left - x, top: top - y, width, height }).png().toBuffer(), left, top,
        });
      }
    }
  }

  return normalized
    .composite(placements)
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

export async function createPreparedListingImage(
  source: Buffer,
  settings: WatermarkRenderSettings,
  options: ListingImageRenderOptions,
) {
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  let sourceImage = sharp(source, { failOn: "none" }).rotate();
  if (settings.imageFlipHorizontal) sourceImage = sourceImage.flop();
  // Materialize EXIF orientation before applying a user rotation. Sharp only
  // applies one rotation per pipeline; the expanded rotated image is contained.
  const oriented = await sourceImage.png().toBuffer();
  const dimensions = await sharp(oriented).metadata();
  if (!dimensions.width || !dimensions.height) throw new Error("유효한 상품 이미지가 아닙니다.");
  const radius = listingImageCornerRadius(dimensions.width, dimensions.height);
  const rounded = await sharp(oriented).ensureAlpha().composite([{input:Buffer.from(`<svg width="${dimensions.width}" height="${dimensions.height}"><rect width="100%" height="100%" rx="${radius}" fill="white"/></svg>`),blend:"dest-in"}]).png().toBuffer();
  const rotation = portraitRotation(dimensions.width ?? 0, dimensions.height ?? 0);
  const adjusted = await sharp(rounded)
    .rotate(rotation + clamp(settings.imageRotation ?? 0, -180, 180), { background: transparent })
    .modulate({ brightness: clamp(settings.imageExposure ?? 1, 0, 2), saturation: clamp(settings.imageSaturation ?? 1, 0, 2) })
    .linear(clamp(settings.imageContrast ?? 1, 0, 2), 128 * (1 - clamp(settings.imageContrast ?? 1, 0, 2)))
    .png().toBuffer();
  const box = listingImageBox(settings, Boolean(options.backgroundEligible));
  const card = await sharp(adjusted).resize({ width: box.width, height: box.height, fit: "contain", background: transparent }).png().toBuffer();
  const size = LISTING_IMAGE_SIZE;
  const backgroundActive = options.backgroundEligible && settings.backgroundEnabled !== false;
  const color = backgroundActive && /^#[0-9A-Fa-f]{6}$/.test(settings.backgroundColor ?? "") ? settings.backgroundColor! : "#ffffff";
  const canvas = backgroundActive && options.background
    ? sharp(options.background).rotate().resize(LISTING_IMAGE_WIDTH, size, { fit: "cover" })
    : sharp({ create: { width: LISTING_IMAGE_WIDTH, height: size, channels: 4, background: color } });
  const layers: sharp.OverlayOptions[] = [];
  if (settings.shadowEnabled) {
    const {data,info} = await sharp(card).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let i=0;i<data.length;i+=4){data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=Math.round(data[i+3]*clamp(settings.shadowOpacity ?? 0.35,0,1));}
    const silhouette=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
    const shadow=await sharp({create:{width:LISTING_IMAGE_WIDTH,height:size,channels:4,background:transparent}}).composite([{input:silhouette,left:Math.round(clamp(box.left+(settings.shadowOffsetX??12),0,LISTING_IMAGE_WIDTH-box.width)),top:Math.round(clamp(box.top+(settings.shadowOffsetY??12),0,size-box.height))}]).png().toBuffer();
    layers.push({input:await sharp(shadow).blur(Math.max(0.3,clamp(settings.shadowBlur??20,0,100))).png().toBuffer(),left:0,top:0});
  }
  layers.push({input:card,left:box.left,top:box.top});
  return canvas.composite(layers).png().toBuffer();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function ensureListingWatermarkedImages(
  userId: string,
  imageUrls: string[],
  options: Pick<ListingImageRenderOptions, "backgroundEligible"> = {},
) {
  const normalizedUrls = imageUrls.map((url) => url.trim()).filter(Boolean);
  if (!normalizedUrls.length) return [];

  const settings = await getListingImageSettings(userId);
  if (settings.watermarkEnabled && !settings.logoUrl) {
    throw new Error(
      "중앙 워터마크 로고가 저장되어 있지 않습니다. 판매채널 자동반영의 등록 이미지 설정에서 PNG 로고를 먼저 저장해 주세요.",
    );
  }
  let renderAssets: Promise<[Buffer | null, Buffer | null]> | undefined;
  const logoIdentity = settings.watermarkEnabled ? (settings.logoKey ?? settings.logoUrl ?? "missing") : "watermark-disabled";
  const output: string[] = [];

  for (const imageUrl of normalizedUrls) {
    if (imageUrl.includes("/products/channel-watermarked/")) {
      output.push(imageUrl);
      continue;
    }

    const key = listingWatermarkKey(imageUrl, logoIdentity, settings, Boolean(options.backgroundEligible));
    const existing = await getObjectFromR2(key);
    if (existing) {
      output.push(buildPublicR2Url(key));
      continue;
    }

    // A saved derivative is already complete. Only fetch its source, logo and
    // background on a cache miss; a retry must not download every asset again.
    const [source, [logo, background]] = await Promise.all([
      downloadImage(imageUrl, "상품 이미지"),
      renderAssets ??= Promise.all([
        settings.watermarkEnabled && settings.logoUrl ? downloadImage(settings.logoUrl, "저장된 워터마크 로고") : null,
        settings.backgroundUrl && options.backgroundEligible ? downloadImage(settings.backgroundUrl, "저장된 배경 이미지") : null,
      ]),
    ]);
    const buffer = await createEbayWatermarkedImage(source, logo, settings, {
      backgroundEligible: options.backgroundEligible,
      background,
    });
    const uploaded = await uploadBufferToR2({
      buffer,
      key,
      contentType: "image/jpeg",
    });
    output.push(uploaded.url);
  }

  return output;
}

export const ensureEbayWatermarkedImages = ensureListingWatermarkedImages;

export async function createListingImagePreview(
  sourceUrl: string,
  settings: ListingImageSettings,
  options: Pick<ListingImageRenderOptions, "backgroundEligible"> = {},
) {
  const source = await downloadImage(sourceUrl, "미리보기 상품 이미지");
  const logoUrl = settings.logoUrl;
  if (settings.watermarkEnabled && !logoUrl) throw new Error("미리보기에 사용할 중앙 워터마크 로고가 없습니다.");
  const logo = settings.watermarkEnabled && logoUrl ? await downloadImage(logoUrl, "저장된 워터마크 로고") : null;
  const background = settings.backgroundUrl && options.backgroundEligible
    ? await downloadImage(settings.backgroundUrl, "저장된 배경 이미지")
    : null;
  return createEbayWatermarkedImage(source, logo, settings, { ...options, background });
}
