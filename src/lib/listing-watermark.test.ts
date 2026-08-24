import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import { createWatermarkedImageBuffer, type ResolvedWatermark } from "./listing-watermark";
import { createWatermarkOverlay } from "./listing-watermark-renderer";

describe("individual listing watermark", () => {
  it("applies the configured watermark opacity to an individual card image", async () => {
    const source = await sharp({ create: { width: 160, height: 240, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#000000"/></svg>');
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(source), { status: 200 })));
    const settings: ResolvedWatermark = { logoUrl: null, logoKey: null, watermarkText: null, watermarkOpacity: 0.06, watermarkLogoSize: 50, watermarkGap: 25, applyToIndividualCards: true, logo, signature: "test" };
    const rendered = await createWatermarkedImageBuffer("https://example.test/card.png", settings);
    const { data } = await sharp(rendered.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(rendered.applied).toBe(true);
    expect(data.some((value) => value < 250)).toBe(true);
  });

  it("keeps an individual card unchanged when individual application is disabled", async () => {
    const source = await sharp({ create: { width: 160, height: 240, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#000000"/></svg>');
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(source), { status: 200 })));
    const settings: ResolvedWatermark = { logoUrl: null, logoKey: null, watermarkText: null, watermarkOpacity: 0.06, watermarkLogoSize: 50, watermarkGap: 25, applyToIndividualCards: false, logo, signature: "test" };
    const rendered = await createWatermarkedImageBuffer("https://example.test/card.png", settings);
    expect(rendered.applied).toBe(false);
    expect(rendered.buffer.equals(source)).toBe(true);
  });

  it("scales the watermark with source width so its displayed size matches the 1000px collection cover", async () => {
    const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#000000"/></svg>');
    const controls = { logo, watermarkText: null, watermarkOpacity: 0.1, watermarkLogoSize: 100, watermarkGap: 50 };
    const collection = await createWatermarkOverlay(1000, 1000, controls);
    const individual = await createWatermarkOverlay(3000, 3000, controls);
    expect(collection).not.toBeNull();
    expect(individual).not.toBeNull();
    const collectionAlpha = await sharp(collection!).extractChannel("alpha").raw().toBuffer();
    const individualAtPreviewSize = await sharp(individual!).resize(1000, 1000).extractChannel("alpha").raw().toBuffer();
    const collectionCoverage = collectionAlpha.filter((value) => value > 0).length;
    const individualCoverage = individualAtPreviewSize.filter((value) => value > 0).length;
    expect(individualCoverage / collectionCoverage).toBeGreaterThan(0.9);
    expect(individualCoverage / collectionCoverage).toBeLessThan(1.1);
  });
});
