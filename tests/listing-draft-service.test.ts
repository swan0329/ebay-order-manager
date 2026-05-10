import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  product: {
    findMany: vi.fn(),
  },
  listingTemplate: {
    findFirst: vi.fn(),
  },
  listingDraft: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  ebayPolicyCache: {
    findMany: vi.fn(),
  },
  ebayInventoryLocationCache: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

import {
  createDraftsFromInventory,
  validateDrafts,
} from "../src/lib/services/listingDraftService";
import { coerceListingUploadInput } from "../src/lib/services/listingUploadInput";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.listingDraft.create.mockImplementation(({ data }) =>
    Promise.resolve({ id: "draft-1", ...data }),
  );
  prismaMock.listingDraft.update.mockImplementation(({ data }) =>
    Promise.resolve({ id: "draft-1", ...data }),
  );
  prismaMock.ebayPolicyCache.findMany.mockResolvedValue([]);
  prismaMock.ebayInventoryLocationCache.findMany.mockResolvedValue([]);
});

describe("listing draft service", () => {
  it("creates ListingDraft rows from inventory products without mutating inventory", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: "product-1",
        sku: "SKU-1",
        productName: "IVE Rei Photocard",
        ebayTitle: null,
        descriptionHtml: null,
        memo: "memo",
        ebayPrice: null,
        salePrice: { toString: () => "12.50" },
        stockQuantity: 2,
        ebayImageUrls: [],
        imageUrl: "https://example.com/card.jpg",
        ebayCategoryId: "261328",
        ebayCondition: "NEW",
        ebayPaymentProfile: "pay-1",
        ebayShippingProfile: "ship-1",
        ebayReturnProfile: "return-1",
        ebayMerchantLocationKey: "loc-1",
        ebayMarketplaceId: "EBAY_US",
        ebayCurrency: "USD",
        brand: "IVE",
        internalCode: "SKU-1",
      },
    ]);
    prismaMock.listingTemplate.findFirst.mockResolvedValue(null);

    const drafts = await createDraftsFromInventory({
      userId: "user-1",
      productIds: ["product-1"],
    });

    expect(drafts).toHaveLength(1);
    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["product-1"] } } }),
    );
    expect(prismaMock.listingDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        sourceInventoryId: "product-1",
        sku: "SKU-1",
        title: "IVE Rei Photocard",
        price: "12.50",
        quantity: 2,
        fieldSourceJson: expect.objectContaining({
          sku: "inventory",
          price: "inventory",
        }),
      }),
    });
  });

  it("keeps uploaded values ahead of template defaults", () => {
    expect(
      coerceListingUploadInput(
        {
          sku: "SKU-2",
          title: "직접 입력 제목",
          price: "15",
          quantity: "3",
          imageUrls: "https://example.com/direct.jpg",
          categoryId: "direct-category",
          condition: "USED_EXCELLENT",
          shippingProfile: "direct-ship",
          returnProfile: "direct-return",
          paymentProfile: "direct-pay",
          merchantLocationKey: "direct-location",
        },
        {
          title: "템플릿 제목",
          price: "9.99",
          quantity: 1,
          imageUrls: "https://example.com/template.jpg",
          categoryId: "template-category",
          condition: "NEW",
          shippingProfile: "template-ship",
          returnProfile: "template-return",
          paymentProfile: "template-pay",
          merchantLocationKey: "template-location",
        },
      ),
    ).toMatchObject({
      title: "직접 입력 제목",
      price: "15.00",
      quantity: 3,
      imageUrls: ["https://example.com/direct.jpg"],
      categoryId: "direct-category",
      condition: "USED_EXCELLENT",
      shippingProfile: "direct-ship",
      returnProfile: "direct-return",
      paymentProfile: "direct-pay",
      merchantLocationKey: "direct-location",
    });
  });

  it("stores draft validation failure details when required fields are missing", async () => {
    prismaMock.listingDraft.findMany.mockResolvedValue([
      {
        id: "draft-1",
        userId: "user-1",
        templateId: null,
        sku: "",
        title: "",
        descriptionHtml: null,
        price: null,
        quantity: null,
        imageUrlsJson: [],
        categoryId: null,
        condition: null,
        conditionDescription: null,
        itemSpecificsJson: {},
        marketplaceId: null,
        currency: null,
        paymentPolicyId: null,
        fulfillmentPolicyId: null,
        returnPolicyId: null,
        merchantLocationKey: null,
        bestOfferEnabled: false,
        minimumOfferPrice: null,
        autoAcceptPrice: null,
        privateListing: false,
        immediatePayRequired: false,
        listingFormat: null,
      },
    ]);
    prismaMock.listingTemplate.findFirst.mockResolvedValue(null);

    const results = await validateDrafts("user-1", ["draft-1"]);

    expect(results[0]).toMatchObject({
      draftId: "draft-1",
      validation: { valid: false },
    });
    expect(prismaMock.listingDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: expect.objectContaining({
        status: "draft",
        errorSummary: expect.any(String),
      }),
    });
  });
});
