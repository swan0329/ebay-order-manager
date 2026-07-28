import { describe, expect, it } from "vitest";
import { evaluateWatermarkQuality } from "../src/lib/watermark-quality";

const width = 64;
const height = 96;
const channels = 3 as const;
const pixels = width * height;

function representativeCard() {
  const clean = new Uint8Array(pixels * channels);
  const mask = new Uint8Array(pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const border = x < 4 || x >= width - 4 || y < 4 || y >= height - 4;
      const pattern = ((x >> 2) + (y >> 2)) % 2 === 0 ? 42 : -42;
      clean[pixel * 3] = border ? 28 : 128 + pattern;
      clean[pixel * 3 + 1] = border ? 31 : 142 - pattern;
      clean[pixel * 3 + 2] = border ? 35 : 156 + pattern;
      if (x >= 13 && x <= 50 && y >= 22 && y <= 72 && (x + y) % 7 < 3) {
        mask[pixel] = 180;
      }
    }
  }
  const watermarked = clean.slice();
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const alpha = mask[pixel] / 255 * 0.35;
    for (let channel = 0; channel < 3; channel += 1) {
      const offset = pixel * 3 + channel;
      watermarked[offset] = Math.round(
        clean[offset] * (1 - alpha) + 255 * alpha,
      );
    }
  }
  return { clean, watermarked, mask };
}

function compare(candidate: Uint8Array) {
  const fixture = representativeCard();
  return evaluateWatermarkQuality({
    width,
    height,
    channels,
    ...fixture,
    candidate,
    watermarkMask: fixture.mask,
  });
}

describe("대표 워터마크 제거 실패 이미지 비교", () => {
  it("깨끗한 기준 이미지는 세 핵심 결함을 통과한다", () => {
    const { clean } = representativeCard();
    expect(compare(clean).failures).toEqual([]);
  });

  it("글자 모양의 워터마크 잔상을 검출한다", () => {
    const { watermarked } = representativeCard();
    const result = compare(watermarked);
    expect(result.watermarkResidual).toBeGreaterThan(0.9);
    expect(result.failures).toContain("watermark_residual");
  });

  it("워터마크 영역의 카드 고유 무늬 뭉개짐을 검출한다", () => {
    const { clean, mask } = representativeCard();
    const damaged = clean.slice();
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      if (!mask[pixel]) continue;
      damaged[pixel * 3] = 128;
      damaged[pixel * 3 + 1] = 142;
      damaged[pixel * 3 + 2] = 156;
    }
    const result = compare(damaged);
    expect(result.patternDamage).toBeGreaterThan(0.045);
    expect(result.failures).toContain("pattern_damage");
  });

  it("네 변과 모서리의 카드 테두리 손상을 검출한다", () => {
    const { clean } = representativeCard();
    const damaged = clean.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x >= 4 && x < width - 4 && y >= 4 && y < height - 4) continue;
        const pixel = y * width + x;
        damaged[pixel * 3] = 245;
        damaged[pixel * 3 + 1] = 245;
        damaged[pixel * 3 + 2] = 245;
      }
    }
    const result = compare(damaged);
    expect(result.borderDamage).toBeGreaterThan(0.035);
    expect(result.failures).toContain("border_damage");
  });
});
