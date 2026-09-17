import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ products: vi.fn(), snapshots: vi.fn(), membership: vi.fn(), logs: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  syncLog: { findMany: mocks.logs },
  product: { findMany: mocks.products }, ebayActiveListing: { findMany: mocks.snapshots },
  pricingSettings: { findUnique: vi.fn().mockResolvedValue({}) },
  ebayReportImport: { findFirst: vi.fn().mockResolvedValue({ id: "report" }) },
} }));
vi.mock("@/lib/product-operations", () => ({ getOperationalProductIds: vi.fn().mockResolvedValue(["p1"]) }));
vi.mock("@/lib/listing-price", () => ({ resolveListingPriceUsd: vi.fn().mockReturnValue({ priceUsd: 11.3 }) }));
vi.mock("@/lib/listing-quantity", () => ({ listingQuantity: vi.fn().mockReturnValue(29) }));
vi.mock("@/lib/variation-listing-products", () => ({ getEbayVariationMembershipByProductId: mocks.membership }));
vi.mock("@/lib/services/ebayApiService", () => ({ ebayApiRequest: vi.fn(), ebayApiRawRequest: vi.fn(), getActiveEbayInventoryAccount: vi.fn() }));
vi.mock("@/lib/ebay-active-report-task", () => ({ requestEbayActiveReport: vi.fn(), listEbayInventoryTasks: vi.fn() }));
vi.mock("@/lib/ebay-active-report-sync", () => ({ syncEbayActiveReport: vi.fn() }));

import { getEbayFeedOperationTargets } from "@/lib/ebay-feed-operations";
import { resolveListingPriceUsd } from "@/lib/listing-price";
const single = { productId: "p1", sku: "182221", itemId: "old-single", price: "3.49", quantity: 1 };
const variation = { productId: null, sku: "182221", itemId: "current-group", price: "11.3", quantity: 29 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.logs.mockResolvedValue([{ status: "SUCCESS", rawJson: { productId: "p1", itemId: "current-group", price: "11.3", quantity: 29 } }]);
  mocks.membership.mockResolvedValue(new Map([["p1", "current-group"]]));
  mocks.products.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "p1", sku: "182221", productName: "Card", ebayItemId: "old-single", ebayLastSyncedPrice: "3.49", ebayLastSyncedQuantity: 1 }]);
});
it("과거 단품 연결보다 실제 반영한 옵션 ItemID+SKU의 보고서를 우선한다", async () => {
  mocks.snapshots.mockResolvedValue([variation, single]);
  expect(await getEbayFeedOperationTargets("user", "revise")).toEqual([]);
});
it("옵션의 실제 가격이 다르면 SKU와 부모 ItemID를 함께 대상으로 남긴다", async () => {
  mocks.snapshots.mockResolvedValue([{ ...variation, price: "10" }, single]);
  expect(await getEbayFeedOperationTargets("user", "revise")).toEqual([expect.objectContaining({ itemId: "current-group", useSku: true, price: "11.3", quantity: 29, priceChanged: true })]);
});
it("다른 ItemID의 단품 보고서를 옵션 검증 근거로 사용하지 않는다", async () => {
  mocks.snapshots.mockResolvedValue([single]);
  expect(await getEbayFeedOperationTargets("user", "revise")).toEqual([expect.objectContaining({ itemId: "current-group", verificationMissing: true })]);
});
it("옵션에 속하지 않는 단품은 SKU 전송 없이 현재 ItemID를 사용한다", async () => {
  mocks.membership.mockResolvedValue(new Map());
  mocks.snapshots.mockResolvedValue([{ ...single, sku: "different-ebay-label" }]);
  expect(await getEbayFeedOperationTargets("user", "revise")).toEqual([expect.objectContaining({ itemId: "old-single", useSku: false })]);
});
it("가격이 없으면 보유 재고와 관계없이 수량 0만 보내고 가격을 만들지 않는다", async () => {
  vi.mocked(resolveListingPriceUsd).mockReturnValueOnce(null);
  mocks.snapshots.mockResolvedValue([variation]);
  expect(await getEbayFeedOperationTargets("user", "revise")).toEqual([expect.objectContaining({itemId:"current-group",quantity:0,price:undefined,resultStatus:"OUT_OF_STOCK"})]);
});
it("보류 중 판매가를 입력하면 기존 묶음에 가격과 양수 재고를 복구한다", async () => {
  mocks.snapshots.mockResolvedValue([{...variation,quantity:0}]);
  expect(await getEbayFeedOperationTargets("user", "revise")).toEqual([expect.objectContaining({itemId:"current-group",price:"11.3",quantity:29,resultStatus:"ACTIVE"})]);
});

it("보고서 수량이 같아도 Inventory 반영 증거가 없으면 다시 대상으로 남긴다", async () => {
  mocks.logs.mockResolvedValue([]);
  mocks.snapshots.mockResolvedValue([variation]);
  expect(await getEbayFeedOperationTargets("user", "revise")).toEqual([expect.objectContaining({ sku: "182221", quantityChanged: true })]);
});
