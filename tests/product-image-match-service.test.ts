import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  computeImageFingerprintFromBuffer,
  hammingDistance,
  imageFingerprintVersion,
  imageFingerprintFromDataUrl,
  matchesImageCandidateMetadata,
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

async function sampleCardOnBackground(cardColor: string, background: string) {
  return sharp({
    create: {
      width: 180,
      height: 240,
      channels: 3,
      background,
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="180" height="240"><rect x="48" y="36" width="84" height="160" fill="${cardColor}"/><circle cx="90" cy="116" r="24" fill="white"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
}

async function solidImage(color: string) {
  return sharp({
    create: {
      width: 96,
      height: 128,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

function histogramIntersection(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + Math.min(value, right[index] ?? 0), 0);
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
    expect(fingerprint.fingerprintVersion).toBe(imageFingerprintVersion);
  });

  it("reads data URL images", async () => {
    const buffer = await sampleImage("#ffffff");
    const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;

    expect((await imageFingerprintFromDataUrl(dataUrl)).phash).toHaveLength(16);
  });

  it("computes card-color histograms without letting the background dominate", async () => {
    const left = await computeImageFingerprintFromBuffer(
      await sampleCardOnBackground("#d82020", "#002a8f"),
    );
    const right = await computeImageFingerprintFromBuffer(
      await sampleCardOnBackground("#d82020", "#f0e34a"),
    );

    expect(left.colorHistogram).toHaveLength(64);
    expect(right.colorHistogram).toHaveLength(64);
    expect(histogramIntersection(left.colorHistogram!, right.colorHistogram!)).toBeGreaterThan(
      0.75,
    );
  });

  it("records a completed fingerprint even when no ORB descriptors exist", async () => {
    const fingerprint = await computeImageFingerprintFromBuffer(
      await solidImage("#eeeeee"),
    );

    expect(fingerprint.descriptors).toEqual([]);
    expect(fingerprint.fingerprintVersion).toBe(imageFingerprintVersion);
  });

  it("computes hex hamming distance", () => {
    expect(hammingDistance("ffff", "0000")).toBe(16);
    expect(hammingDistance("abcd", "abcd")).toBe(0);
  });

  it("rejects image candidates from a different group or member", () => {
    expect(
      matchesImageCandidateMetadata(
        { brand: "IVE", optionName: "REI" },
        { group: "IVE", member: "REI" },
      ),
    ).toBe(true);
    expect(
      matchesImageCandidateMetadata(
        { brand: "LE SSERAFIM", optionName: "KAZUHA" },
        { group: "IVE", member: "REI" },
      ),
    ).toBe(false);
    expect(
      matchesImageCandidateMetadata(
        { brand: "IVE", optionName: "WONYOUNG" },
        { group: "IVE", member: "REI" },
      ),
    ).toBe(false);
  });

  it("tolerates harmless spacing and punctuation differences in metadata", () => {
    expect(
      matchesImageCandidateMetadata(
        { brand: "LE SSERAFIM", optionName: "KIM-CHAEWON" },
        { group: "LE_SSERAFIM", member: "Kim Chaewon" },
      ),
    ).toBe(true);
  });
});
