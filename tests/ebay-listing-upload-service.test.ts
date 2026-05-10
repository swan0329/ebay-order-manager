import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  listingDraft: {
    update: vi.fn(),
    findMany: vi.fn(),
  },
  inventoryListingLink: {
    upsert: vi.fn(),
  },
  product: {
    update: vi.fn(),
  },
}));
const getActiveAccountMock = vi.hoisted(() => vi.fn());
const upsertProductMock = vi.hoisted(() => vi.fn());
const draftToListingInputMock = vi.hoisted(() => vi.fn());
const publishProductListingMock = vi.hoisted(() => vi.fn());
const validateListingUploadInputMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));
vi.mock("@/lib/services/ebayApiService", () => ({
  getActiveEbayInventoryAccount: getActiveAccountMock,
}));
vi.mock("@/lib/services/inventoryService", () => ({
  upsertProductFromListingInput: upsertProductMock,
}));
vi.mock("@/lib/services/listingDraftService", () => ({
  draftToListingInput: draftToListingInputMock,
}));
vi.mock("@/lib/services/listingService", () => ({
  publishProductListing: publishProductListingMock,
}));
vi.mock("@/lib/services/listingValidationService", () => ({
  validateListingUploadInput: validateListingUploadInputMock,
}));

import { uploadDraft } from "../src/lib/services/ebayListingUploadService";

const listingInput = {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  draftToListingInputMock.mockResolvedValue(listingInput);
  validateListingUploadInputMock.mockResolvedValue({ valid: true, issues: [] });
  getActiveAccountMock.mockResolvedValue({ id: "account-1" });
  upsertProductMock.mockResolvedValue({
    product: { id: "product-1", ebayOfferId: null, ebayItemId: null },
    created: false,
  });
  publishProductListingMock.mockResolvedValue({
    action: "create",
    offerId: "offer-1",
    listingId: "item-1",
    listingStatus: "ACTIVE",
  });
  prismaMock.listingDraft.update.mockResolvedValue({});
  prismaMock.inventoryListingLink.upsert.mockResolvedValue({});
  prismaMock.product.update.mockResolvedValue({});
});

describe("uploadDraft", () => {
  it("uploads through the mocked eBay service and creates InventoryListingLink", async () => {
    const result = await uploadDraft("user-1", {
      id: "draft-1",
      sourceInventoryId: "inventory-1",
      sku: "SKU-1",
    } as never);

    expect(result).toMatchObject({
      draftId: "draft-1",
      result: { offerId: "offer-1", listingId: "item-1" },
    });
    expect(publishProductListingMock).toHaveBeenCalledWith(
      { id: "account-1" },
      { id: "product-1", ebayOfferId: null, ebayItemId: null },
      listingInput,
    );
    expect(prismaMock.inventoryListingLink.upsert).toHaveBeenCalledWith({
      where: { inventoryId: "inventory-1" },
      update: expect.objectContaining({
        sku: "SKU-1",
        offerId: "offer-1",
        ebayItemId: "item-1",
        listingStatus: "ACTIVE",
      }),
      create: expect.objectContaining({
        inventoryId: "inventory-1",
        sku: "SKU-1",
        offerId: "offer-1",
        ebayItemId: "item-1",
        listingStatus: "ACTIVE",
      }),
    });
  });

  it("does not call eBay when validation fails", async () => {
    validateListingUploadInputMock.mockResolvedValueOnce({
      valid: false,
      issues: [{ field: "price", message: "price 입력값을 확인해 주세요." }],
    });

    await expect(
      uploadDraft("user-1", { id: "draft-1", sku: "SKU-1" } as never),
    ).resolves.toMatchObject({
      draftId: "draft-1",
      error: "price 입력값을 확인해 주세요.",
    });
    expect(publishProductListingMock).not.toHaveBeenCalled();
    expect(prismaMock.inventoryListingLink.upsert).not.toHaveBeenCalled();
  });
});
