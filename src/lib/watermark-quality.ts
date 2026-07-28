export type WatermarkQualityInput = {
  width: number;
  height: number;
  clean: Uint8Array;
  watermarked: Uint8Array;
  candidate: Uint8Array;
  watermarkMask: Uint8Array;
  channels?: 3 | 4;
};

export type WatermarkQualityResult = {
  watermarkResidual: number;
  patternDamage: number;
  borderDamage: number;
  outsideChange: number;
  failures: Array<
    "watermark_residual" | "pattern_damage" | "border_damage"
  >;
};

/**
 * Fixed-set comparison metric. It never approves an image automatically:
 * the scores only highlight likely defects for the human reviewer.
 */
export function evaluateWatermarkQuality(
  input: WatermarkQualityInput,
): WatermarkQualityResult {
  const { width, height, clean, watermarked, candidate, watermarkMask } = input;
  const channels = input.channels ?? 3;
  const pixels = width * height;
  if (
    width < 3 ||
    height < 3 ||
    watermarkMask.length !== pixels ||
    clean.length !== pixels * channels ||
    watermarked.length !== clean.length ||
    candidate.length !== clean.length
  ) {
    throw new Error("품질 비교 이미지의 크기와 채널이 일치해야 합니다.");
  }

  let residualProjection = 0;
  let residualEnergy = 0;
  let patternError = 0;
  let patternWeight = 0;
  let borderError = 0;
  let borderWeight = 0;
  let outsideError = 0;
  let outsideWeight = 0;
  const borderX = Math.max(2, Math.round(width * 0.06));
  const borderY = Math.max(2, Math.round(height * 0.04));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const maskWeight = watermarkMask[pixel] / 255;
      const isBorder =
        x < borderX ||
        x >= width - borderX ||
        y < borderY ||
        y >= height - borderY;
      let absoluteError = 0;
      let localDetail = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const offset = pixel * channels + channel;
        const error = candidate[offset] - clean[offset];
        absoluteError += Math.abs(error) / 255;
        if (maskWeight > 0) {
          const watermarkVector = watermarked[offset] - clean[offset];
          residualProjection +=
            Math.max(0, error * watermarkVector) * maskWeight;
          residualEnergy +=
            watermarkVector * watermarkVector * maskWeight;
        }
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          const left = clean[offset - channels];
          const right = clean[offset + channels];
          const up = clean[offset - width * channels];
          const down = clean[offset + width * channels];
          localDetail +=
            (Math.abs(right - left) + Math.abs(down - up)) / (2 * 255);
        }
      }
      absoluteError /= 3;
      localDetail /= 3;
      if (isBorder) {
        borderError += absoluteError;
        borderWeight += 1;
      } else if (maskWeight > 0 && localDetail > 0.035) {
        patternError += absoluteError * maskWeight;
        patternWeight += maskWeight;
      }
      if (maskWeight < 0.02) {
        outsideError += absoluteError;
        outsideWeight += 1;
      }
    }
  }

  const result = {
    watermarkResidual:
      residualEnergy > 0
        ? Math.max(0, Math.min(1, residualProjection / residualEnergy))
        : 0,
    patternDamage: patternWeight ? patternError / patternWeight : 0,
    borderDamage: borderWeight ? borderError / borderWeight : 0,
    outsideChange: outsideWeight ? outsideError / outsideWeight : 0,
    failures: [] as WatermarkQualityResult["failures"],
  };
  if (result.watermarkResidual > 0.12)
    result.failures.push("watermark_residual");
  if (result.patternDamage > 0.045) result.failures.push("pattern_damage");
  if (result.borderDamage > 0.035) result.failures.push("border_damage");
  return result;
}
