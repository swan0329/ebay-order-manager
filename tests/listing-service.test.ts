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

  it("permanently blocks direct eBay listing writes and requires Excel", async () => {
    await expect(
      publishProductListing(account as never, product as never, input),
    ).rejects.toThrow(
      "eBay API 상품 등록·수정 기능은 영구 비활성화되었습니다",
    );
    expect(ebayApiRequestMock).not.toHaveBeenCalled();
  });
});
