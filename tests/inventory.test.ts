import { describe, expect, it } from "vitest";
import { statusAfterStockChange } from "@/lib/inventory";

describe("statusAfterStockChange", () => {
  it("returns unlisted when a sold-out product gets stock again", () => {
    expect(statusAfterStockChange("sold_out", 1)).toBe("unlisted");
  });

  it("preserves active only when the product was already active", () => {
    expect(statusAfterStockChange("active", 1)).toBe("active");
  });

  it("keeps unlisted products unlisted while stock is positive", () => {
    expect(statusAfterStockChange("unlisted", 1)).toBe("unlisted");
  });

  it("marks products sold out when stock reaches zero", () => {
    expect(statusAfterStockChange("active", 0)).toBe("sold_out");
    expect(statusAfterStockChange("unlisted", 0)).toBe("sold_out");
  });
});
