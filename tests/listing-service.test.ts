import { beforeEach, describe, expect, it, vi } from "vitest";

const ebayApiRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services/ebayApiService", () => ({
  ebayApiRequest: ebayApiRequestMock,
}));

import {
  productToListingInput,
  publishProductListing,
} from "../src/lib/services/listingService";

const account = { id: "account-1" };
const product = {
  id: "product-1",
  sku: "SKU-1",
  ebayOfferId: null,
  ebayItemId: null,
};
const input = {
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
  currency: "USD",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishProductListing", () => {
  it("uses user-uploaded front and back image asset URLs before the product image", () => {
    const listingInput = productToListingInput({
      sku: "SKU-USER-IMAGE",
      productName: "IVE Rei Photocard",
      ebayTitle: null,
      descriptionHtml: null,
      memo: null,
      ebayPrice: "12.50",
      salePrice: null,
      stockQuantity: 1,
      ebayImageUrls: [
        "https://example.com/api/products/image-match/assets/card-1/front",
        "https://example.com/api/products/image-match/assets/card-1/back",
      ],
      imageUrl: "https://source.example/original.jpg",
      ebayCategoryId: "261328",
      ebayCondition: "NEW",
      ebayShippingProfile: "ship-1",
      ebayReturnProfile: "return-1",
      ebayPaymentProfile: "pay-1",
      ebayMerchantLocationKey: "loc-1",
      ebayMarketplaceId: "EBAY_US",
      ebayCurrency: "USD",
    } as never);

    expect(listingInput.imageUrls).toEqual([
      "https://example.com/api/products/image-match/assets/card-1/front",
      "https://example.com/api/products/image-match/assets/card-1/back",
    ]);
  });

  it("creates the inventory item and publishes one new offer", async () => {
    ebayApiRequestMock.mockImplementation(async (_account, request) => {
      if (request.path === "/sell/inventory/v1/offer" && !request.method) return { body: { offers: [] } };
      if (request.path === "/sell/inventory/v1/offer" && request.method === "POST") return { body: { offerId: "offer-1" } };
      if (request.path.endsWith("/publish")) return { body: { listingId: "item-1" } };
      return { body: null };
    });
    await expect(publishProductListing(account as never, product as never, input)).resolves.toEqual({
      action: "create", offerId: "offer-1", listingId: "item-1", listingStatus: "ACTIVE",
    });
    expect(ebayApiRequestMock).toHaveBeenCalledTimes(4);
  });

  it("does not publish again when a product already has an item id", async () => {
    ebayApiRequestMock.mockImplementation(async (_account, request) => {
      if (request.path === "/sell/inventory/v1/offer" && !request.method) return { body: { offers: [{ offerId: "offer-1" }] } };
      return { body: null };
    });
    const existing={...product,ebayItemId:"item-existing"};
    const result=await publishProductListing(account as never,existing as never,input);
    expect(result).toMatchObject({action:"revise",listingId:"item-existing"});
    expect(ebayApiRequestMock.mock.calls.some(([,request])=>request.path.endsWith("/publish"))).toBe(false);
  });
});
