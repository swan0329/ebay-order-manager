import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createWatermarkLogoTile, normalizedWatermarkValues } from "@/lib/watermark-render";

describe("shared watermark renderer", () => {
  it("작은 PNG 로고도 설정한 크기로 확대한다", async () => {
    const tinyLogo = await sharp({
      create: { width: 12, height: 12, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();
    const values = normalizedWatermarkValues({
      watermarkOpacity: 0.04,
      watermarkLogoSize: 100,
      watermarkGap: 30,
    });
    const metadata = await sharp(await createWatermarkLogoTile(tinyLogo, values)).metadata();
    expect(metadata.width).toBeGreaterThanOrEqual(100);
    expect(metadata.height).toBeGreaterThanOrEqual(100);
  });

  it("단일 카드와 옵션 썸네일에서 같은 상대 크기를 사용한다", () => {
    const settings = { watermarkOpacity: 0.04, watermarkLogoSize: 100, watermarkGap: 30 };
    const option = normalizedWatermarkValues(settings, 1000);
    const single = normalizedWatermarkValues(settings, 540);
    expect(option.logoSize / 1000).toBeCloseTo(single.logoSize / 540, 5);
    expect(option.gap / 1000).toBeCloseTo(single.gap / 540, 2);
  });

  it("흰색 로고 배경은 투명하게 만들고 로고 잉크만 남긴다", async () => {
    const logoWithWhiteBackdrop = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#ffffff" },
    }).composite([{
      input: Buffer.from('<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="20" fill="#111111"/></svg>'),
    }]).png().toBuffer();
    const tile = await createWatermarkLogoTile(logoWithWhiteBackdrop, normalizedWatermarkValues({
      watermarkOpacity: 1,
      watermarkLogoSize: 100,
      watermarkGap: 30,
    }));
    const { data, info } = await sharp(tile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2))).toBeGreaterThan(100);
  });

  it("투명 PNG의 밝은 글자와 장식 모양을 밝기와 무관하게 보존한다", async () => {
    const transparentLogo = await sharp({
      create: { width: 120, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([
      { input: Buffer.from('<svg width="120" height="80" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="12" width="40" height="56" fill="#ffffff"/><circle cx="88" cy="40" r="28" fill="#777777" fill-opacity="0.5"/></svg>') },
    ]).png().toBuffer();
    const tile = await createWatermarkLogoTile(transparentLogo, normalizedWatermarkValues({
      watermarkOpacity: 0.4,
      watermarkLogoSize: 120,
      watermarkGap: 30,
    }));
    const { data, info } = await sharp(tile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = Array.from({ length: info.width * info.height }, (_, pixel) => ({
      red: data[pixel * info.channels],
      alpha: data[pixel * info.channels + 3],
    }));
    const alphaValues = pixels.map((pixel) => pixel.alpha);
    expect(Math.max(...alphaValues)).toBeGreaterThanOrEqual(100);
    expect(alphaValues.filter((alpha) => alpha > 10).length).toBeGreaterThan(2_000);
    expect(alphaValues.filter((alpha) => alpha === 0).length).toBeGreaterThan(1_000);
    expect(pixels.some((pixel) => pixel.alpha > 90 && pixel.red > 240)).toBe(true);
    expect(pixels.some((pixel) => pixel.alpha > 30 && pixel.alpha < 70 && pixel.red > 90 && pixel.red < 160)).toBe(true);
  });

  it("음수 간격을 보존해 큰 로고를 더 촘촘하게 배치한다", () => {
    const values = normalizedWatermarkValues({
      watermarkOpacity: 0.04,
      watermarkLogoSize: 100,
      watermarkGap: -40,
    });
    expect(values.gap).toBe(-40);
  });
});
