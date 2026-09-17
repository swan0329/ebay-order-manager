import { describe, expect, it } from "vitest";
import { productDisplayImageUrl, productDisplayImageLabel } from "./product-display-image";

const product = { id: "card", userImageRegistered: false, imageSource: "lens_workbench",
  imageUrl: "https://images.example/completed.jpg", sourceImageUrl: "https://images.example/pocamarket.jpg" };

describe("product display image priority", () => {
  it("prefers a registered photograph even when a completed result exists and no timestamp is available", () => {
    expect(productDisplayImageUrl({ ...product, userImageRegistered: true })).toBe("/api/products/image-match/assets/card/front");
  });
  it("shows the completed image instead of its preserved original", () => {
    expect(productDisplayImageUrl(product)).toBe(product.imageUrl);
  });
  it("shows the original when image work is not complete", () => {
    expect(productDisplayImageUrl({ ...product, imageSource: "pocamarket" })).toBe(product.sourceImageUrl);
  });
  it("falls back to the original if the completed image is missing", () => {
    expect(productDisplayImageUrl({ ...product, imageUrl: null })).toBe(product.sourceImageUrl);
    expect(productDisplayImageLabel({ ...product, imageUrl: null })).toBe("포카마켓");
  });
  it("keeps the visible source consistent with the selected image", () => {
    expect(productDisplayImageLabel(product)).toBe("Lens 작업");
    expect(productDisplayImageLabel({ ...product, userImageRegistered: true })).toBe("직접 촬영");
    expect(productDisplayImageLabel({ ...product, imageSource: "pocamarket" })).toBe("포카마켓");
  });
});
