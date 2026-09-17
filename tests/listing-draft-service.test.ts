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
    createMany: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  ebayPolicyCache: {
    findMany: vi.fn(),
  },
  ebayInventoryLocationCache: {
    findMany: vi.fn(),
  },
  pricingSettings: {
    findUnique: vi.fn(),
  },
}));
const variationCandidateIdsMock = vi.hoisted(() => vi.fn(() => Promise.resolve(new Set<string>())));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));
vi.mock("@/lib/variation-listing-products", () => ({
  getVariationCandidateProductIds: variationCandidateIdsMock,
}));
vi.mock("@/lib/services/ebayAccountService", () => ({
  syncPolicies: vi.fn(() => Promise.resolve({})),
}));

import {
  createDraftsFromInventory,
  resolveAutomaticListingDefaults,
  validateDrafts,
} from "../src/lib/services/listingDraftService";
import { coerceListingUploadInput } from "../src/lib/services/listingUploadInput";

beforeEach(() => {
  vi.clearAllMocks();
  variationCandidateIdsMock.mockResolvedValue(new Set());
  prismaMock.listingDraft.create.mockImplementation(({ data }) =>
    Promise.resolve({ id: "draft-1", ...data }),
  );
  prismaMock.listingDraft.createMany.mockImplementation(({ data }) =>
    Promise.resolve({ count: Array.isArray(data) ? data.length : 0 }),
  );
  prismaMock.listingDraft.update.mockImplementation(({ data }) =>
    Promise.resolve({ id: "draft-1", ...data }),
  );
  prismaMock.ebayPolicyCache.findMany.mockResolvedValue([]);
  prismaMock.ebayInventoryLocationCache.findMany.mockResolvedValue([]);
});

describe("listing draft service", () => {
  it("상품에 정책이 없으면 현재 계정에 유효한 등록 성공 초안의 정책을 재사용한다", async () => {
    prismaMock.pricingSettings.findUnique.mockResolvedValue({ id: "default" });
    prismaMock.product.findMany.mockResolvedValue([]);
    prismaMock.ebayPolicyCache.findMany.mockResolvedValue([
      { policyType: "fulfillment", policyId: "used-shipping" },
      { policyType: "fulfillment", policyId: "other-shipping" },
    ]);
    prismaMock.ebayInventoryLocationCache.findMany.mockResolvedValue([
      { merchantLocationKey: "loc-1", addressSummary: "ENABLED", rawJson: { country: "KR", city: "Cheonan-si", stateOrProvince: "Chungcheongnam-do" } },
    ]);
    prismaMock.listingDraft.findMany.mockResolvedValue([{ fulfillmentPolicyId: "used-shipping", merchantLocationKey: "loc-1" }]);
    const result = await resolveAutomaticListingDefaults("user-1", null);
    expect(result.automaticDefaults).toMatchObject({ categoryId: "108857", shippingProfile: "used-shipping", merchantLocationKey: "loc-1" });
    expect(prismaMock.listingDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1", status: "uploaded" } }));
    prismaMock.listingDraft.findMany.mockResolvedValue([{ fulfillmentPolicyId: "removed-policy" }]);
    expect((await resolveAutomaticListingDefaults("user-1", null)).automaticDefaults.shippingProfile).toBeNull();
  });
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

    const created = await createDraftsFromInventory({
      userId: "user-1",
      productIds: ["product-1"],
    });

    expect(created).toBe(1);
    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["product-1"] } }),
      }),
    );
    expect(prismaMock.listingDraft.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: "user-1",
          sourceInventoryId: "product-1",
          sku: "SKU-1",
          title: "IVE Rei Photocard",
          price: null,
          quantity: 2,
          fieldSourceJson: expect.objectContaining({
            sku: "inventory",
            price: "default",
          }),
        }),
      ],
    });
  });

  it("does not create a single-item draft for an option candidate", async () => {
    variationCandidateIdsMock.mockResolvedValue(new Set(["product-1"]));

    await expect(createDraftsFromInventory({
      userId: "user-1",
      productIds: ["product-1"],
    })).rejects.toThrow("옵션상품으로 등록");
    expect(prismaMock.listingDraft.createMany).not.toHaveBeenCalled();
  });

  it("refreshes an automatic draft with the approved gallery and rendered detail template", async () => {
    prismaMock.product.findMany
      .mockResolvedValueOnce([
        {
          id: "product-1",
          sku: "SKU-1",
          productName: "IVE Rei Photocard",
          ebayTitle: null,
          descriptionHtml: null,
          memo: null,
          ebayPrice: "20",
          finalListingPriceUsd: "20",
          salePrice: null,
          stockQuantity: 2,
          ebayImageUrls: ["https://approved.example/watermarked.jpg"],
          imageUrl: "https://raw.example/card.jpg",
          userFrontImageUrl: "https://raw.example/front.jpg",
          ebayCategoryId: "261328",
          ebayCondition: "NEW",
          ebayPaymentProfile: null,
          ebayShippingProfile: null,
          ebayReturnProfile: null,
          ebayMerchantLocationKey: null,
          ebayMarketplaceId: "EBAY_US",
          ebayCurrency: "USD",
          brand: "IVE",
          internalCode: "SKU-1",
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.listingTemplate.findFirst.mockResolvedValue({
      id: "template-1",
      userId: "user-1",
      isDefault: true,
      titleTemplate: null,
      descriptionTemplateHtml: "<h2>{{title}}</h2><p>SKU {{sku}} / ${{price}}</p>",
    });
    prismaMock.pricingSettings.findUnique.mockResolvedValue({ id: "default" });
    prismaMock.ebayPolicyCache.findMany.mockResolvedValue([
      { policyType: "payment", policyId: "pay-1" },
      { policyType: "fulfillment", policyId: "ship-1" },
      { policyType: "return", policyId: "return-1" },
    ]);
    prismaMock.ebayInventoryLocationCache.findMany.mockResolvedValue([
      {
        merchantLocationKey: "loc-1",
        addressSummary: "ENABLED",
        rawJson: { country: "KR", city: "Cheonan-si", stateOrProvince: "Chungcheongnam-do" },
      },
    ]);
    prismaMock.listingDraft.findMany.mockResolvedValue([
      {
        id: "draft-old",
        sourceInventoryId: "product-1",
        imageUrlsJson: ["https://raw.example/old.jpg"],
        descriptionHtml: "<p>old</p>",
      },
    ]);

    await createDraftsFromInventory({
      userId: "user-1",
      productIds: ["product-1"],
      allowAnyProductStatus: true,
      automaticPublish: true,
    });

    expect(prismaMock.listingDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "draft-old" },
      data: expect.objectContaining({
        imageUrlsJson: ["https://approved.example/watermarked.jpg"],
        descriptionHtml: expect.stringContaining("SKU SKU-1 / $20.00"),
        merchantLocationKey: "loc-1",
        status: "draft",
      }),
    }));
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
