import { describe, expect, it } from "vitest";
import {
  imageUrlFromBrowseItemPayload,
  orderItemImageUrlFromRaw,
} from "../src/lib/order-images";

describe("order item images", () => {
  it("prefers the stored sold listing image over generic item images", () => {
    expect(
      orderItemImageUrlFromRaw({
        imageUrl: "https://example.com/generic.jpg",
        soldImageUrl: "https://i.ebayimg.com/sold.jpg",
      }),
    ).toBe("https://i.ebayimg.com/sold.jpg");
  });

  it("reads the primary image from a Browse item response", () => {
    expect(
      imageUrlFromBrowseItemPayload({
        image: { imageUrl: "https://i.ebayimg.com/listing.jpg" },
      }),
    ).toBe("https://i.ebayimg.com/listing.jpg");
  });

  it("falls back to thumbnail images from a Browse item response", () => {
    expect(
      imageUrlFromBrowseItemPayload({
        thumbnailImages: [{ imageUrl: "https://i.ebayimg.com/thumb.jpg" }],
      }),
    ).toBe("https://i.ebayimg.com/thumb.jpg");
  });
});
