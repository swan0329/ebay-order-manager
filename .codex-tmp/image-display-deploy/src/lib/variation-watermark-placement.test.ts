import { describe, expect, it } from "vitest";
import { variationWatermarkPlacements } from "@/lib/variation-watermark-placement";

describe("variation watermark placements", () => {
  it("crops edge tiles instead of pushing them inward and stacking them", () => {
    const placements = variationWatermarkPlacements({
      canvasWidth: 1000, canvasHeight: 1000, headerHeight: 150,
      tileWidth: 360, tileHeight: 300, repeatDistancePercent: 20,
    });
    expect(placements.length).toBeGreaterThan(1);
    expect(placements.every((placement) => placement.left >= 0 && placement.top >= 150)).toBe(true);
    expect(placements.some((placement) => placement.sourceLeft > 0 || placement.sourceTop > 0)).toBe(true);
    expect(placements.every((placement) => placement.left + placement.width <= 1000)).toBe(true);
    expect(placements.every((placement) => placement.top + placement.height <= 1000)).toBe(true);
    expect(placements.some((placement) => placement.left === 0 && placement.sourceLeft > 0)).toBe(true);
  });

  it("keeps tile centres fixed when only logo size changes", () => {
    const small = variationWatermarkPlacements({
      canvasWidth: 1000, canvasHeight: 1000, headerHeight: 150,
      tileWidth: 120, tileHeight: 100, repeatDistancePercent: 20,
    });
    const large = variationWatermarkPlacements({
      canvasWidth: 1000, canvasHeight: 1000, headerHeight: 150,
      tileWidth: 240, tileHeight: 200, repeatDistancePercent: 20,
    });
    const centres = (placements: typeof small) => placements
      .filter((placement) => placement.sourceLeft === 0 && placement.sourceTop === 0)
      .map((placement) => `${placement.left + placement.width / 2}:${placement.top + placement.height / 2}`);
    expect(centres(small)).toContain("500:575");
    expect(centres(large)).toContain("500:575");
  });

  it("allows overlap by setting centre distance below logo size", () => {
    const placements = variationWatermarkPlacements({
      canvasWidth: 1000, canvasHeight: 1000, headerHeight: 150,
      tileWidth: 300, tileHeight: 200, repeatDistancePercent: 10,
    });
    const sameRow = placements.filter((placement) => placement.top === 475);
    expect(sameRow.some((placement, index) => index > 0 && placement.left - sameRow[index - 1].left === 85)).toBe(true);
  });
});
