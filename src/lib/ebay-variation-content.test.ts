import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ api: vi.fn(), state: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  product: { findUnique: async () => ({ id: "p1", sku: "100284", ebayItemId: "item-1" }), findMany: async () => [] },
  variationListingState: { findFirst: mocks.state },
  listingTemplate: { findFirst: async () => ({ titleTemplate: "{{title}}", fulfillmentPolicyId: "ship-approved", returnPolicyId: "no-return" }) },
} }));
vi.mock("@/lib/services/ebayApiService", () => ({ getActiveEbayInventoryAccount: async () => ({}), ebayApiRequest: mocks.api }));
vi.mock("@/lib/variation-listing-groups", () => ({ buildVariationListingGroups: () => ({ groups: [{ key: "g", groupName: "BTS", albumName: "MERCH BOX #10", versionName: "", products: [{}] }] }) }));
import { repairEbayVariationContent } from "@/lib/ebay-variation-content";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.mockResolvedValue({ groupKey: "g", parentSku: "VAR-G", includedProductIds: ["p1"] });
});

it("기존 HTML을 복구하며 그룹 이미지·옵션은 보존하고 가격·재고·게시 API는 호출하지 않는다", async () => {
  let group = { title: "BTS MERCH BOX #10", description: "plain", imageUrls: ["cover"], variantSKUs: ["100284"], variesBy: { specifications: [] } };
  mocks.api.mockImplementation(async (_account, request) => {
    if (request.path.endsWith("/inventory_item_group/VAR-G")) {
      if (request.method === "PUT") group = request.body;
      return { body: group };
    }
    if (request.path.endsWith("/offer/o1")) return { body: { listingDescription: '<div style="text-align:center"><h3>BTS MERCH BOX #10</h3><p>Original<br>layout</p></div>' } };
    return { body: { offers: [{ offerId: "o1", listing: { listingId: "item-1" } }] } };
  });
  await expect(repairEbayVariationContent("u1", "p1")).resolves.toMatchObject({ title: "BTS Official MERCH BOX #10 Photocard Kpop", verified: true });
  expect(group).toMatchObject({ imageUrls: ["cover"], variantSKUs: ["100284"], description: expect.stringContaining('<p>Original<br>layout</p>') });
  expect(mocks.api.mock.calls.filter(([, request]) => request.method)).toHaveLength(1);
});

it("사용자의 저장된 묶음 연결이 없으면 외부 수정 전에 중단한다", async () => {
  mocks.state.mockResolvedValue(null);
  await expect(repairEbayVariationContent("u1", "p1")).rejects.toThrow("묶음 연결");
  expect(mocks.api).not.toHaveBeenCalled();
});

it("명시적으로 선택한 배송·반품 정책만 변경하고 기존 가격·수량은 유지한다", async () => {
  let group = { title: "BTS MERCH BOX #10", description: "plain", variantSKUs: ["100284"] };
  let offer = { sku: "100284", availableQuantity: 3, pricingSummary: { price: { value: "12.00", currency: "USD" } }, listingDescription: "<p>Original description</p>", listingPolicies: { fulfillmentPolicyId: "old", returnPolicyId: "old", paymentPolicyId: "payment" } };
  mocks.api.mockImplementation(async (_account, request) => {
    if (request.path.endsWith("/inventory_item_group/VAR-G")) {
      if (request.method === "PUT") group = request.body;
      return { body: group };
    }
    if (request.path.endsWith("/offer/o1")) {
      if (request.method === "PUT") offer = request.body;
      return { body: offer };
    }
    return { body: { offers: [{ offerId: "o1", listing: { listingId: "item-1" } }] } };
  });
  await expect(repairEbayVariationContent("u1", "p1", true)).resolves.toMatchObject({ policiesUpdated: true });
  expect(offer).toMatchObject({ availableQuantity: 3, pricingSummary: { price: { value: "12.00", currency: "USD" } }, listingPolicies: { fulfillmentPolicyId: "ship-approved", returnPolicyId: "no-return", paymentPolicyId: "payment" } });
  expect(mocks.api).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PUT", path: "/sell/inventory/v1/offer/o1", contentLanguage: "en-US" }));
});
