import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListingUploadInput } from "../src/lib/services/inventoryService";

const getCategoryAspectsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services/ebayTaxonomyService", () => ({
  getCategoryAspects: getCategoryAspectsMock,
}));

import { validateListingUploadInput } from "../src/lib/services/listingValidationService";

const baseInput: ListingUploadInput = {
  sku: "SKU-1",
  title: "IVE Rei Photocard",
  descriptionHtml: "<p>Card</p>",
  price: "12.50",
  quantity: 2,
  imageUrls: ["https://example.com/card.jpg"],
  categoryId: "261328",
  condition: "NEW",
  shippingProfile: "ship-1",
  returnProfile: "return-1",
  paymentProfile: "pay-1",
  merchantLocationKey: "loc-1",
  marketplaceId: "EBAY_US",
  itemSpecifics: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  getCategoryAspectsMock.mockResolvedValue({
    categoryTreeId: "0",
    aspects: [
      {
        name: "Brand",
        required: true,
        requirement: "required",
        usage: "REQUIRED",
        mode: "FREE_TEXT",
        dataType: "STRING",
        cardinality: "single",
        maxLength: null,
        values: [],
      },
      {
        name: "Franchise",
        required: false,
        requirement: "recommended",
        usage: "RECOMMENDED",
        mode: "FREE_TEXT",
        dataType: "STRING",
        cardinality: "single",
        maxLength: null,
        values: [],
      },
    ],
  });
});

describe("validateListingUploadInput", () => {
  it("fails validation when eBay required category aspects are missing", async () => {
    const result = await validateListingUploadInput(baseInput, {
      userId: "user-1",
      checkCategoryAspects: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      field: "item_specifics.Brand",
      message: "Required eBay item specific is missing: Brand",
    });
  });

  it("passes category aspect validation when required specifics exist", async () => {
    const result = await validateListingUploadInput(
      {
        ...baseInput,
        itemSpecifics: { Brand: ["Starship"] },
      },
      {
        userId: "user-1",
        checkCategoryAspects: true,
      },
    );

    expect(result.valid).toBe(true);
    expect(getCategoryAspectsMock).toHaveBeenCalledWith({
      userId: "user-1",
      categoryId: "261328",
      marketplaceId: "EBAY_US",
    });
  });
});
