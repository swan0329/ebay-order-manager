import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  account: vi.fn(),
  syncLog: vi.fn(),
  getOrders: vi.fn(),
  upsert: vi.fn(),
  itemFind: vi.fn(),
  itemUpsert: vi.fn(),
  itemDelete: vi.fn(),
  deduct: vi.fn(),
  automation: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    ebayAccount: { findFirst: mocks.account },
    syncLog: { create: mocks.syncLog },
    order: { upsert: mocks.upsert },
    orderItem: {
      findMany: mocks.itemFind,
      upsert: mocks.itemUpsert,
      deleteMany: mocks.itemDelete,
    },
    shipment: { upsert: vi.fn() },
  },
}));
vi.mock("@/lib/ebay", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOrdersFromEbay: mocks.getOrders,
  getEbayListingImageUrl: vi.fn(async () => null),
}));
vi.mock("@/lib/inventory", () => ({ deductStockForOrder: mocks.deduct }));
vi.mock("@/lib/order-automation", () => ({ applyOrderAutomation: mocks.automation }));

import { syncOrdersForUser } from "@/lib/orders";

const modified = "2026-09-16T00:00:00.000Z";
const ebayOrder = (id: string) => ({
  orderId: id,
  lastModifiedDate: modified,
  creationDate: modified,
  orderFulfillmentStatus: "FULFILLED",
  lineItems: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account.mockResolvedValue({ id: "acc-1", ebayUserId: "seller" });
  mocks.syncLog.mockResolvedValue({});
  mocks.upsert.mockResolvedValue({ id: "order-row" });
  mocks.itemFind.mockResolvedValue([]);
  mocks.itemDelete.mockResolvedValue({ count: 0 });
  mocks.deduct.mockResolvedValue(undefined);
  mocks.automation.mockResolvedValue(null);
  mocks.getOrders.mockResolvedValue({ orders: [ebayOrder("11-1"), ebayOrder("11-2")], total: 2 });
});

describe("전체 주문 불러오기", () => {
  it("eBay가 주는 lastModifiedDate를 수정 시각으로 읽는다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    await syncOrdersForUser("user-1", {});
    expect(mocks.upsert.mock.calls[0][0].update.modifiedAt).toEqual(
      new Date(modified),
    );
  });

  it("eBay에서 바뀌지 않은 주문은 다시 저장하지 않는다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        ebayOrderId: "11-1",
        modifiedAt: new Date(modified),
        automationCheckedAt: new Date(modified),
        pendingItems: 0,
      },
    ]);
    const result = await syncOrdersForUser("user-1", {});
    expect(result).toMatchObject({ imported: 2, skipped: 1, saved: 1 });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it("재고 차감이 남았거나 자동 분류 전이면 바뀌지 않아도 다시 처리한다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        ebayOrderId: "11-1",
        modifiedAt: new Date(modified),
        automationCheckedAt: null,
        pendingItems: 0,
      },
      {
        ebayOrderId: "11-2",
        modifiedAt: new Date(modified),
        automationCheckedAt: new Date(modified),
        pendingItems: 1,
      },
    ]);
    const result = await syncOrdersForUser("user-1", {});
    expect(result).toMatchObject({ skipped: 0, saved: 2 });
    expect(mocks.deduct).toHaveBeenCalledTimes(2);
  });

  it("수정 시각이 다르면 다시 저장한다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        ebayOrderId: "11-1",
        modifiedAt: new Date("2026-09-15T00:00:00.000Z"),
        automationCheckedAt: new Date(modified),
        pendingItems: 0,
      },
    ]);
    expect(await syncOrdersForUser("user-1", {})).toMatchObject({ skipped: 0 });
  });

  it("전체 다시 저장을 고르면 건너뛰지 않는다", async () => {
    const result = await syncOrdersForUser("user-1", {}, { refreshAll: true });
    expect(result).toMatchObject({ skipped: 0, saved: 2 });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
