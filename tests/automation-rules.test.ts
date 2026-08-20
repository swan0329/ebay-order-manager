import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const endMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  automationRule: { upsert: vi.fn() },
  product: { findMany: vi.fn(), update: vi.fn() },
  productListing: { updateMany: vi.fn() },
  ebayAccount: { findFirst: vi.fn() },
  automationEvent: { upsert: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/ebay-environment", () => ({ currentEbayEnvironment: () => "PRODUCTION" }));
vi.mock("@/lib/safe-log", () => ({ safeLog: vi.fn() }));
vi.mock("@/lib/services/ebayEndListing", () => ({ endEbayListing: endMock }));

const { runZeroStockRule } = await import("@/lib/services/automationRules");

describe("zero stock automation rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.product.findMany.mockResolvedValue([{ id: "p1", sku: "S1", productName: "Card", stockQuantity: 0, updatedAt: new Date("2026-08-20T00:00:00Z"), ebayItemId: "item-1", productListings: [] }]);
    prismaMock.automationEvent.upsert.mockResolvedValue({ id: "event-1", status: "NOTIFIED" });
  });

  it("defaults to notification and does not call eBay", async () => {
    prismaMock.automationRule.upsert.mockResolvedValue({ id: "rule-1", enabled: true, mode: "NOTIFY" });
    const result = await runZeroStockRule({ userId: "u1", productIds: ["p1"] });
    expect(result).toMatchObject({ notified: 1, ended: 0 });
    expect(endMock).not.toHaveBeenCalled();
  });

  it("executes only when the saved mode is automatic", async () => {
    prismaMock.automationRule.upsert.mockResolvedValue({ id: "rule-1", enabled: true, mode: "AUTOMATIC" });
    prismaMock.ebayAccount.findFirst.mockResolvedValue({ id: "a1", environment: "PRODUCTION" });
    prismaMock.automationEvent.upsert.mockResolvedValue({ id: "event-1", status: "PENDING" });
    prismaMock.automationEvent.update.mockResolvedValue({});
    prismaMock.$transaction.mockResolvedValue([]);
    const result = await runZeroStockRule({ userId: "u1", productIds: ["p1"] });
    expect(result).toMatchObject({ ended: 1, failed: 0 });
    expect(endMock).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }), "item-1");
  });
});
