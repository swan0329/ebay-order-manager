import { beforeEach, describe, expect, it, vi } from "vitest";

const ebayApiRequestMock = vi.hoisted(() => vi.fn());
const repairLocationMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/listing-publish-safety", () => ({ assertListingPublishSafety: vi.fn() }));
vi.mock("@/lib/services/ebayApiService", () => ({
  ebayApiRequest: ebayApiRequestMock,
}));
vi.mock("@/lib/ebay-inventory-location", () => ({
  repairKoreaEbayInventoryLocation: repairLocationMock,
}));

import { EbayApiError } from "@/lib/ebay";
import { publishProductListing, productToListingInput } from "@/lib/services/listingService";

const input = {
  sku: "TEST-1",
  title: "Test photocard",
  descriptionHtml: "<p>Test</p>",
  price: "10.00",
  quantity: 1,
  imageUrls: ["https://example.com/card.jpg"],
  categoryId: "183454",
  condition: "NEW",
  shippingProfile: "shipping-policy",
  returnProfile: "return-policy",
  paymentProfile: "payment-policy",
  merchantLocationKey: "warehouse",
  marketplaceId: "EBAY_US",
  currency: "USD",
  listingFormat: "FIXED_PRICE" as const,
};

describe("eBay 단품 등록", () => {
  it.each([null, "", "  "])("빈 상품 카테고리 %s에는 공통 포토카드 카테고리를 적용한다", (category) => {
    const product = { sku: "100284", productName: "BTS MERCH BOX #10 Jimin", brand: "BTS", category: "MERCH BOX #10", optionName: "Jimin", ebayCategoryId: category, ebayPrice: 12, stockQuantity: 1, ebayShippingProfile: "ship", ebayReturnProfile: "return", ebayImageUrls: [] };
    expect(productToListingInput(product as never).categoryId).toBe("108857");
    expect(productToListingInput({ ...product, ebayCategoryId: "183454" } as never).categoryId).toBe("183454");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    repairLocationMock.mockResolvedValue(true);
  });

  it("기존 Offer 조회의 404/25713을 신규등록 경로로 처리한다", async () => {
    ebayApiRequestMock
      .mockRejectedValueOnce(new EbayApiError("request failed", 404, {
        errors: [{ errorId: 25713, message: "This Offer is not available." }],
      }))
      .mockResolvedValueOnce({ body: null, headers: new Headers() })
      .mockResolvedValueOnce({ body: { offerId: "offer-new" }, headers: new Headers() })
      .mockResolvedValueOnce({ body: { listingId: "item-new" }, headers: new Headers() });

    const result = await publishProductListing(
      { id: "account" } as never,
      { sku: "TEST-1", ebayOfferId: null, ebayItemId: null } as never,
      input,
    );

    expect(result).toMatchObject({
      action: "create",
      offerId: "offer-new",
      listingId: "item-new",
      listingStatus: "ACTIVE",
    });
    expect(ebayApiRequestMock).toHaveBeenNthCalledWith(2, expect.anything(),
      expect.objectContaining({ method: "PUT", path: "/sell/inventory/v1/inventory_item/TEST-1" }),
    );
  });

  it("게시 오류 25012이면 같은 한국 재고 위치 주소를 복구하고 한 번 재시도한다", async () => {
    ebayApiRequestMock
      .mockResolvedValueOnce({ body: { offers: [{ offerId: "offer-existing" }] }, headers: new Headers() })
      .mockResolvedValueOnce({ body: null, headers: new Headers() })
      .mockResolvedValueOnce({ body: null, headers: new Headers() })
      .mockRejectedValueOnce(new EbayApiError("request failed", 400, {
        errors: [{ errorId: 25012, message: "Invalid inventory location." }],
      }))
      .mockResolvedValueOnce({ body: { listingId: "item-fixed" }, headers: new Headers() });

    const result = await publishProductListing(
      { id: "account" } as never,
      { sku: "TEST-1", ebayOfferId: null, ebayItemId: null } as never,
      input,
    );

    expect(repairLocationMock).toHaveBeenCalledWith(
      expect.anything(),
      "warehouse",
    );
    expect(result.listingId).toBe("item-fixed");
  });
});
