import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ candidates: vi.fn(), product: vi.fn(), groups: vi.fn() }));
vi.mock("@/lib/channel-registration-candidates", () => ({ getRegistrationCandidates: mocks.candidates }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findUnique: mocks.product } } }));
vi.mock("@/lib/variation-listing-products", () => ({ getVariationListingGroups: mocks.groups }));
import { getRegistrationPreview } from "@/lib/registration-preview";
const product = { id: "p3", sku: "3", brand: "BTS", category: "Album", optionName: "Jin", productName: "Album", imageUrl: "https://img/card.jpg", ebayImageUrls: [], shopifyProductId: "shopify" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.candidates.mockResolvedValue({ products: [{ id: "p1", sku: "1" }, { id: "p2", sku: "2" }, { id: "p3", sku: "3" }], eligibleCount: 3 });
  mocks.product.mockResolvedValue(product);
  mocks.groups.mockResolvedValue([]);
});
it("랜덤 변경은 기존 묶음의 모든 카드를 제외하고 다른 상품을 선택한다", async () => {
  const result = await getRegistrationPreview("EBAY", true, ["p1", "p2"]);
  expect(mocks.product).toHaveBeenCalledWith({ where: { id: "p3" } });
  expect(result.target).toMatchObject({ productId: "p3", sku: "3", members: [{ ebayRegistered: false, shopifyRegistered: true }] });
});
it("다른 후보가 없을 때 같은 상품을 랜덤 결과로 돌려주지 않는다", async () => {
  const result = await getRegistrationPreview("EBAY", true, ["p1", "p2", "p3"]);
  expect(result).toMatchObject({ target: null, noAlternative: true });
  expect(mocks.product).not.toHaveBeenCalled();
});
it("실제로 묶여 등록되는 전체 카드와 등록할 선택 ID를 함께 반환한다", async () => {
  mocks.groups.mockResolvedValue([{ groupName: "BTS", albumName: "Album", versionName: "", products: [product, { ...product, id: "p4", sku: "4" }] }]);
  const result = await getRegistrationPreview("EBAY", true, ["p1", "p2"]);
  expect(result.target).toMatchObject({ productId: "p3", grouped: true, memberIds: ["p3", "p4"], title: "BTS Official Album Photocard Kpop" });
});
