import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  computeImageFingerprintFromBuffer,
  hammingDistance,
  imageFingerprintFromDataUrl,
} from "@/lib/services/productImageMatchService";

async function sampleImage(color: string) {
  return sharp({
    create: {
      width: 96,
      height: 128,
      channels: 3,
      background: color,
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="96" height="128"><rect x="18" y="22" width="60" height="80" fill="white"/><circle cx="48" cy="62" r="18" fill="black"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
}

describe("product image matching helpers", () => {
  it("builds stable perceptual fingerprints from image bytes", async () => {
    const buffer = await sampleImage("#f2f2f2");

    expect(await computeImageFingerprintFromBuffer(buffer)).toEqual(
      await computeImageFingerprintFromBuffer(buffer),
    );
  });

  it("returns 64-bit hashes", async () => {
    const fingerprint = await computeImageFingerprintFromBuffer(
      await sampleImage("#dddddd"),
    );

    expect(fingerprint.ahash).toHaveLength(16);
    expect(fingerprint.dhash).toHaveLength(16);
    expect(fingerprint.phash).toHaveLength(16);
    expect(fingerprint.descriptors.length).toBeGreaterThan(0);
  });

  it("reads data URL images", async () => {
    const buffer = await sampleImage("#ffffff");
    const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;

    expect((await imageFingerprintFromDataUrl(dataUrl)).phash).toHaveLength(16);
  });

  it("computes hex hamming distance", () => {
    expect(hammingDistance("ffff", "0000")).toBe(16);
    expect(hammingDistance("abcd", "abcd")).toBe(0);
  });
});
