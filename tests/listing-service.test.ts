import { beforeEach, describe, expect, it, vi } from "vitest";

const ebayApiRequestMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/listing-publish-safety", () => ({ assertListingPublishSafety: vi.fn() }));
vi.mock("@/lib/services/ebayApiService", () => ({
  ebayApiRequest: ebayApiRequestMock,
}));

import {
  productToListingInput,
  publishProductListing,
} from "../src/lib/services/listingService";
import { EbayApiError } from "../src/lib/ebay";

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

  it("creates the SKU inventory item, offer, and published listing", async () => {
    ebayApiRequestMock
      .mockResolvedValueOnce({ body: { offers: [] } })
      .mockResolvedValueOnce({ body: null })
      .mockResolvedValueOnce({ body: { offerId: "offer-1" } })
      .mockResolvedValueOnce({ body: { listingId: "item-1" } });

    await expect(
      publishProductListing(account as never, product as never, input),
    ).resolves.toEqual({
      action: "create",
      offerId: "offer-1",
      listingId: "item-1",
      listingStatus: "ACTIVE",
    });
    expect(ebayApiRequestMock.mock.calls.map(([, request]) => request.path)).toEqual([
      "/sell/inventory/v1/offer",
      "/sell/inventory/v1/inventory_item/SKU-1",
      "/sell/inventory/v1/offer",
      "/sell/inventory/v1/offer/offer-1/publish",
    ]);
  });

  it("updates a published offer without publishing it a second time", async () => {
    ebayApiRequestMock
      .mockResolvedValueOnce({
        body: {
          offerId: "offer-1",
          listing: { listingId: "item-1", listingStatus: "ACTIVE" },
        },
      })
      .mockResolvedValueOnce({ body: null })
      .mockResolvedValueOnce({ body: null });

    await expect(
      publishProductListing(
        account as never,
        { ...product, ebayOfferId: "offer-1", ebayItemId: "item-1" } as never,
        input,
      ),
    ).resolves.toEqual({
      action: "revise",
      offerId: "offer-1",
      listingId: "item-1",
      listingStatus: "ACTIVE",
    });
    expect(ebayApiRequestMock).toHaveBeenCalledTimes(3);
    expect(ebayApiRequestMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: expect.stringContaining("/publish") }),
    );
  });

  it("recovers an already-published SKU after a lost response instead of duplicating it", async () => {
    ebayApiRequestMock
      .mockResolvedValueOnce({
        body: {
          offers: [
            {
              offerId: "recovered-offer",
              listing: { listingId: "recovered-item", listingStatus: "ACTIVE" },
            },
          ],
        },
      })
      .mockResolvedValueOnce({ body: null })
      .mockResolvedValueOnce({ body: null });

    const result = await publishProductListing(
      account as never,
      product as never,
      input,
    );

    expect(result).toMatchObject({
      action: "revise",
      offerId: "recovered-offer",
      listingId: "recovered-item",
    });
    expect(
      ebayApiRequestMock.mock.calls.filter(
        ([, request]) => request.method === "POST" && request.path === "/sell/inventory/v1/offer",
      ),
    ).toHaveLength(0);
  });

  it("deletes an unavailable offer and recreates it for the same SKU", async () => {
    ebayApiRequestMock
      .mockResolvedValueOnce({ body: { offers: [{ offerId: "dead-offer" }] } })
      .mockResolvedValueOnce({ body: null })
      .mockRejectedValueOnce(new EbayApiError(
        "This Offer is not available.",
        400,
        { errors: [{ errorId: 25713, message: "This Offer is not available." }] },
      ))
      .mockResolvedValueOnce({ body: null })
      .mockResolvedValueOnce({ body: { offers: [] } })
      .mockResolvedValueOnce({ body: { offerId: "replacement-offer" } })
      .mockResolvedValueOnce({ body: { listingId: "replacement-item" } });

    await expect(
      publishProductListing(account as never, product as never, input),
    ).resolves.toMatchObject({
      action: "create",
      offerId: "replacement-offer",
      listingId: "replacement-item",
    });
    expect(ebayApiRequestMock).toHaveBeenCalledWith(
      account,
      expect.objectContaining({
        method: "DELETE",
        path: "/sell/inventory/v1/offer/dead-offer",
      }),
    );
  });
});
