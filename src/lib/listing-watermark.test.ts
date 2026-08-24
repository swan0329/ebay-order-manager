import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import { createWatermarkedImageBuffer, type ResolvedWatermark } from "./listing-watermark";

describe("individual listing watermark", () => {
  it("composites a visible logo on an individual card image", async () => {
    const source = await sharp({ create: { width: 160, height: 240, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#000000"/></svg>');
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(source), { status: 200 })));
    const settings: ResolvedWatermark = { logoUrl: null, logoKey: null, watermarkText: null, watermarkOpacity: 0.2, watermarkLogoSize: 50, watermarkGap: 25, applyToIndividualCards: true, logo, signature: "test" };
    const rendered = await createWatermarkedImageBuffer("https://example.test/card.png", settings);
    const { data } = await sharp(rendered.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(rendered.applied).toBe(true);
    expect(data.some((value) => value < 245)).toBe(true);
  });
});
