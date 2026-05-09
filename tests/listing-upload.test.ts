import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeListingUploadRow,
  resolveListingImageUrls,
} from "../src/lib/services/listingUploadInput";

const originalR2Base = process.env.R2_PUBLIC_BASE_URL;

afterEach(() => {
  process.env.R2_PUBLIC_BASE_URL = originalR2Base;
});

describe("listing upload input", () => {
  it("resolves relative image keys against the R2 public base URL", () => {
    process.env.R2_PUBLIC_BASE_URL = "https://pub-example.r2.dev/cards";

    expect(resolveListingImageUrls("sku-1/front.jpg,https://example.com/back.jpg")).toEqual([
      "https://pub-example.r2.dev/cards/sku-1/front.jpg",
      "https://example.com/back.jpg",
    ]);
  });

  it("normalizes spreadsheet rows into eBay listing input", () => {
    process.env.R2_PUBLIC_BASE_URL = "https://pub-example.r2.dev";

    expect(
      normalizeListingUploadRow({
        sku: "SKU-1",
        title: "Stray Kids Hyunjin Photocard",
        description_html: "<p>Card</p>",
        price: "12.5",
        quantity: "3",
        image_urls: "cards/sku-1.jpg",
        category_id: "261328",
        shipping_profile: "ship-policy",
        return_profile: "return-policy",
        payment_profile: "pay-policy",
      }),
    ).toMatchObject({
      sku: "SKU-1",
      title: "Stray Kids Hyunjin Photocard",
      price: "12.50",
      quantity: 3,
      imageUrls: ["https://pub-example.r2.dev/cards/sku-1.jpg"],
      categoryId: "261328",
      condition: "NEW",
      shippingProfile: "ship-policy",
      returnProfile: "return-policy",
      paymentProfile: "pay-policy",
    });
  });
});
