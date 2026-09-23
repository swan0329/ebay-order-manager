export const watermarkSettingLimits = {
  opacity: { min: 0.01, max: 0.5, step: 0.01 },
  logoSize: { min: 5, max: 1200, step: 5 },
  // This is the renderer's internal edge offset. The settings screen exposes
  // an easier centre-to-centre repeat distance instead.
  gap: { min: -1200, max: 2000, step: 5 },
} as const;

export const variationWatermarkSettingLimits = {
  logoSize: { min: 5, max: 1200, step: 5 },
  repeatDistance: { min: 2, max: 200, step: 1 },
} as const;

export const singleWatermarkSettingLimits = {
  logoSize: { min: 20, max: 500, step: 5 },
  centerDistance: { min: 40, max: 1000, step: 5 },
} as const;
