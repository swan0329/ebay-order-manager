import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/matchingService", () => ({ matchOrderItemsForOrder: vi.fn() }));

const tx = {
  orderItem: { findUnique: vi.fn(), update: vi.fn() },
  product: { findUnique: vi.fn(), update: vi.fn() },
  inventoryMovement: { create: vi.fn() },
};
const prismaMock = {
  order: { findUnique: vi.fn() },
  orderItem: { findUnique: vi.fn() },
  $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { restoreStockForCancelledOrder, restoreStockForReturnedOrderItem } = await import("@/lib/inventory");

describe("cancel/refund stock restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.order.findUnique.mockResolvedValue({
      id: "order-1",
      externalOrderId: "external-1",
      orderStatus: "CANCELLED",
      fulfillmentStatus: "NOT_STARTED",
      rawJson: { cancelStatus: { cancelState: "CANCELED" } },
      items: [{ id: "line-1", productId: "product-1", quantity: 1, stockDeducted: true }],
    });
    tx.product.findUnique.mockResolvedValue({ id: "product-1", stockQuantity: 0, status: "sold_out" });
    tx.inventoryMovement.create.mockResolvedValue({ id: "movement-1" });
  });

  it("restores a deducted line once and clears the deduction marker atomically", async () => {
    tx.orderItem.findUnique
      .mockResolvedValueOnce({ id: "line-1", productId: "product-1", quantity: 1, stockDeducted: true })
      .mockResolvedValueOnce({ id: "line-1", productId: "product-1", quantity: 1, stockDeducted: false });

    const first = await restoreStockForCancelledOrder("order-1", "admin-1");
    const second = await restoreStockForCancelledOrder("order-1", "admin-1");

    expect(first).toEqual({ restored: 1, productIds: ["product-1"] });
    expect(second).toEqual({ restored: 0, productIds: [] });
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "CANCEL_RESTORE", relatedOrderId: "order-1" }),
    });
    expect(tx.orderItem.update).toHaveBeenCalledWith({
      where: { id: "line-1" },
      data: { stockDeducted: false },
    });
  });
});

describe("received return stock restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.product.findUnique.mockResolvedValue({ id: "product-1", stockQuantity: 0, status: "sold_out" });
    tx.inventoryMovement.create.mockResolvedValue({ id: "movement-1" });
  });

  it("restores only a full returned line and remains idempotent", async () => {
    prismaMock.orderItem.findUnique.mockResolvedValue({
      id: "line-1",
      orderId: "order-1",
      productId: "product-1",
      quantity: 1,
      stockDeducted: true,
      order: { externalOrderId: "external-1" },
    });
    tx.orderItem.findUnique
      .mockResolvedValueOnce({ id: "line-1", productId: "product-1", quantity: 1, stockDeducted: true })
      .mockResolvedValueOnce({ id: "line-1", productId: "product-1", quantity: 1, stockDeducted: false });

    const first = await restoreStockForReturnedOrderItem({
      orderItemId: "line-1", returnQuantity: 1, returnId: "return-1",
    });
    const second = await restoreStockForReturnedOrderItem({
      orderItemId: "line-1", returnQuantity: 1, returnId: "return-1",
    });

    expect(first).toMatchObject({ restored: 1, reason: "restored" });
    expect(second).toMatchObject({ restored: 0, reason: "not_deducted" });
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1);
  });

  it("leaves partial returns for human review", async () => {
    prismaMock.orderItem.findUnique.mockResolvedValue({
      id: "line-1",
      orderId: "order-1",
      productId: "product-1",
      quantity: 2,
      stockDeducted: true,
      order: { externalOrderId: "external-1" },
    });

    await expect(restoreStockForReturnedOrderItem({
      orderItemId: "line-1", returnQuantity: 1, returnId: "return-1",
    })).resolves.toMatchObject({ restored: 0, reason: "partial_return" });
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });
});
