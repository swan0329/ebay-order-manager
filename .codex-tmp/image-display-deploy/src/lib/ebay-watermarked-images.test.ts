import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import { createEbayWatermarkedImage } from "@/lib/ebay-watermarked-images";

describe("eBay listing watermark", () => {
  it("uses uniform portrait dimensions and tiles the saved logo across the image", async () => {
    const source = await sharp({
      create: {
        width: 400,
        height: 600,
        channels: 3,
        background: "#ffffff",
      },
    }).png().toBuffer();
    const logo = await sharp({
      create: {
        width: 40,
        height: 20,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    }).png().toBuffer();

    const output = await createEbayWatermarkedImage(source, logo);
    const image = sharp(output);
    const metadata = await image.metadata();
    const { data } = await image.raw().toBuffer({ resolveWithObject: true });

    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(1200);
    expect(data.some((value) => value < 250)).toBe(true);
  });

  it("adds the chosen background only when the source is an approved image-work result", async () => {
    const source = await sharp({ create: { width: 300, height: 500, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const background = await sharp({ create: { width: 300, height: 500, channels: 3, background: "#0000ff" } }).png().toBuffer();
    const settings = {
      watermarkOpacity: 0.06,
      watermarkLogoSize: 50,
      watermarkGap: 25,
      imageExposure: 1,
      imageContrast: 1,
      imageSaturation: 1,
      backgroundPadding: 100,
      backgroundEnabled: true,
    };

    const worked = await createEbayWatermarkedImage(source, null, settings, { backgroundEligible: true, background });
    const captured = await createEbayWatermarkedImage(source, null, settings, { backgroundEligible: false, background });
    const workedPixel = await sharp(worked).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer();
    const capturedPixel = await sharp(captured).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer();

    expect(workedPixel[2]).toBeGreaterThan(workedPixel[0]);
    expect(capturedPixel[0]).toBeGreaterThan(240);
    expect(capturedPixel[2]).toBeGreaterThan(240);
  });

  it("shrinks an image-work result without changing its aspect ratio", async () => {
    const source = await sharp({ create: { width: 300, height: 500, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const background = await sharp({ create: { width: 300, height: 500, channels: 3, background: "#0000ff" } }).png().toBuffer();
    const output = await createEbayWatermarkedImage(source, null, {
      watermarkOpacity: 0.06,
      watermarkLogoSize: 50,
      watermarkGap: 25,
      imageExposure: 1,
      imageContrast: 1,
      imageSaturation: 1,
      backgroundEnabled: true,
      paddingTop: 250,
      paddingRight: 250,
      paddingBottom: 250,
      paddingLeft: 250,
    }, { backgroundEligible: true, background });
    const topInsideBoundingBox = await sharp(output).extract({ left: 400, top: 90, width: 1, height: 1 }).raw().toBuffer();
    const cardCenter = await sharp(output).extract({ left: 400, top: 600, width: 1, height: 1 }).raw().toBuffer();

    // The 3:5 source fits inside the requested box without stretching to its
    // full height: blue remains above it, while its centre stays red.
    expect(topInsideBoundingBox[2]).toBeGreaterThan(topInsideBoundingBox[0]);
    expect(cardCenter[0]).toBeGreaterThan(cardCenter[2]);
  });

  it("preserves a margin around an image-work result", async () => {
    const source = await sharp({ create: { width: 300, height: 500, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const background = await sharp({ create: { width: 300, height: 500, channels: 3, background: "#0000ff" } }).png().toBuffer();
    const output = await createEbayWatermarkedImage(source, null, {
      watermarkOpacity: 0.06,
      watermarkLogoSize: 50,
      watermarkGap: 25,
      imageExposure: 1,
      imageContrast: 1,
      imageSaturation: 1,
      paddingTop: 100,
      paddingRight: 100,
      paddingBottom: 100,
      paddingLeft: 100,
    }, { backgroundEligible: true, background });
    const roundedCorner = await sharp(output).extract({ left: 31, top: 51, width: 1, height: 1 }).raw().toBuffer();
    const cardInside = await sharp(output).extract({ left: 400, top: 600, width: 1, height: 1 }).raw().toBuffer();

    expect(roundedCorner[2]).toBeGreaterThan(roundedCorner[0]);
    expect(cardInside[0]).toBeGreaterThan(cardInside[2]);
  });
});
it('clips an oversized rotated logo without shifting it or exceeding the output canvas',async()=>{
 const source=await sharp({create:{width:300,height:500,channels:3,background:'white'}}).png().toBuffer();
 const logo=Buffer.from('<svg width="700" height="300"><rect width="700" height="300" fill="black"/></svg>');
 const out=await createEbayWatermarkedImage(source,logo,{watermarkOpacity:0.15,watermarkLogoSize:1200,watermarkGap:200});
 const m=await sharp(out).metadata();expect([m.width,m.height]).toEqual([800,1200]);
});
