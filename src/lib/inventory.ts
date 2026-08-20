import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import { toCsv } from "@/lib/csv";
import { matchOrderItemsForOrder } from "@/lib/services/matchingService";
import { normalizeProductStatus } from "@/lib/product-status";
import { prisma } from "@/lib/prisma";

export const inventoryMovementTypes = [
  "IN",
  "OUT",
  "ADJUST",
  "ORDER_DEDUCT",
  "CANCEL_RESTORE",
] as const;

export const inventoryMovementSchema = z.object({
  productId: z.string().min(1),
  type: z.enum(inventoryMovementTypes),
  quantity: z.coerce.number().int().min(0),
  reason: z.string().trim().optional(),
});

function isDeductibleOrder(order: { orderStatus: string; fulfillmentStatus: string }) {
  // 취소 주문만 차감 대상에서 제외한다. 배송완료(FULFILLED) 주문은 이미 출고되어
  // 재고가 실제로 소진된 건이므로 반드시 차감되어야 한다. 항목별 stockDeducted
  // 플래그가 중복 차감을 막아주므로 미차감 상태의 배송완료 주문도 안전하게 처리된다.
  const canceledStatuses = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
  return (
    !canceledStatuses.includes(order.orderStatus) &&
    !canceledStatuses.includes(order.fulfillmentStatus)
  );
}

export function statusAfterStockChange(
  currentStatus: string | null | undefined,
  afterQuantity: number,
) {
  const status = normalizeProductStatus(currentStatus);

  if (afterQuantity <= 0) {
    return "sold_out";
  }

  if (status === "active") {
    return "active";
  }

  return "unlisted";
}

export async function createInventoryMovement(input: {
  productId: string;
  type: (typeof inventoryMovementTypes)[number];
  quantity: number;
  reason?: string | null;
  relatedOrderId?: string | null;
  createdBy?: string | null;
}) {
  const product = await prisma.product.findUnique({ where: { id: input.productId } });

  if (!product) {
    throw new Error("상품을 찾을 수 없습니다.");
  }

  const beforeQuantity = product.stockQuantity;
  let afterQuantity = beforeQuantity;
  let movementQuantity = input.quantity;

  if (input.type === "IN" || input.type === "CANCEL_RESTORE") {
    afterQuantity = beforeQuantity + input.quantity;
  } else if (input.type === "OUT" || input.type === "ORDER_DEDUCT") {
    afterQuantity = beforeQuantity - input.quantity;
  } else if (input.type === "ADJUST") {
    afterQuantity = input.quantity;
    movementQuantity = Math.abs(afterQuantity - beforeQuantity);
  }

  if (afterQuantity < 0) {
    throw new Error("재고는 음수가 될 수 없습니다.");
  }

  return prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: input.productId },
      data: {
        stockQuantity: afterQuantity,
        status: statusAfterStockChange(product.status, afterQuantity),
      },
    });

    return tx.inventoryMovement.create({
      data: {
        productId: input.productId,
        type: input.type,
        quantity: movementQuantity,
        beforeQuantity,
        afterQuantity,
        reason: input.reason,
        relatedOrderId: input.relatedOrderId,
        createdBy: input.createdBy,
      },
    });
  });
}

export async function createInventoryMovementTx(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    type: (typeof inventoryMovementTypes)[number];
    quantity: number;
    reason?: string | null;
    relatedOrderId?: string | null;
    createdBy?: string | null;
  },
) {
  const product = await tx.product.findUnique({ where: { id: input.productId } });

  if (!product) {
    throw new Error("상품을 찾을 수 없습니다.");
  }

  const beforeQuantity = product.stockQuantity;
  let afterQuantity = beforeQuantity;
  let movementQuantity = input.quantity;

  if (input.type === "IN" || input.type === "CANCEL_RESTORE") {
    afterQuantity = beforeQuantity + input.quantity;
  } else if (input.type === "OUT" || input.type === "ORDER_DEDUCT") {
    afterQuantity = beforeQuantity - input.quantity;
  } else if (input.type === "ADJUST") {
    afterQuantity = input.quantity;
    movementQuantity = Math.abs(afterQuantity - beforeQuantity);
  }

  if (afterQuantity < 0) {
    throw new Error("재고는 음수가 될 수 없습니다.");
  }

  await tx.product.update({
    where: { id: input.productId },
    data: {
      stockQuantity: afterQuantity,
      status: statusAfterStockChange(product.status, afterQuantity),
    },
  });

  return tx.inventoryMovement.create({
    data: {
      productId: input.productId,
      type: input.type,
      quantity: movementQuantity,
      beforeQuantity,
      afterQuantity,
      reason: input.reason,
      relatedOrderId: input.relatedOrderId,
      createdBy: input.createdBy,
    },
  });
}

export async function deductStockForOrder(orderId: string, createdBy?: string | null) {
  await matchOrderItemsForOrder(orderId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });

  if (!order) {
    throw new Error("주문을 찾을 수 없습니다.");
  }

  if (!isDeductibleOrder(order)) {
    return {
      deducted: 0,
      skipped: order.items.length,
      shortages: 0,
      unmatched: 0,
      productIds: [] as string[],
    };
  }

  let deducted = 0;
  let skipped = 0;
  let shortages = 0;
  let unmatched = 0;
  const productIds: string[] = [];

  for (const item of order.items) {
    if (item.stockDeducted) {
      skipped += 1;
      continue;
    }

    if (!item.productId || !item.product) {
      unmatched += 1;
      continue;
    }

    if (item.product.stockQuantity < item.quantity) {
      shortages += 1;
      continue;
    }

    const currentItem = await prisma.orderItem.findUnique({
      where: { id: item.id },
      include: { product: true },
    });

    if (!currentItem || currentItem.stockDeducted || !currentItem.product) {
      skipped += 1;
      continue;
    }

    if (currentItem.product.stockQuantity < currentItem.quantity) {
      shortages += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await createInventoryMovementTx(tx, {
        productId: currentItem.product!.id,
        type: "ORDER_DEDUCT",
        quantity: currentItem.quantity,
        reason: `Order ${order.externalOrderId}`,
        relatedOrderId: order.id,
        createdBy,
      });
      await tx.orderItem.update({
        where: { id: currentItem.id },
        data: { stockDeducted: true },
      });
    });
    productIds.push(currentItem.product.id);
    deducted += 1;
  }

  return { deducted, skipped, shortages, unmatched, productIds: [...new Set(productIds)] };
}

function isCancelledOrRefunded(order: {
  orderStatus: string;
  fulfillmentStatus: string;
  rawJson: unknown;
}) {
  const raw = order.rawJson && typeof order.rawJson === "object" && !Array.isArray(order.rawJson)
    ? order.rawJson as Record<string, unknown> : {};
  const cancel = raw.cancelStatus && typeof raw.cancelStatus === "object"
    ? raw.cancelStatus as Record<string, unknown> : {};
  return [order.orderStatus, order.fulfillmentStatus, raw.orderPaymentStatus, cancel.cancelState]
    .map((value) => String(value ?? "").toUpperCase())
    .some((value) => ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER", "FULLY_REFUNDED"].includes(value));
}

export async function restoreStockForCancelledOrder(orderId: string, createdBy?: string | null) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) throw new Error("주문을 찾을 수 없습니다.");
  if (!isCancelledOrRefunded(order)) return { restored: 0, productIds: [] as string[] };

  const productIds: string[] = [];
  for (const item of order.items) {
    if (!item.stockDeducted || !item.productId) continue;
    await prisma.$transaction(async (tx) => {
      const current = await tx.orderItem.findUnique({ where: { id: item.id } });
      if (!current?.stockDeducted || !current.productId) return;
      await createInventoryMovementTx(tx, {
        productId: current.productId,
        type: "CANCEL_RESTORE",
        quantity: current.quantity,
        reason: `Cancelled/refunded order ${order.externalOrderId}`,
        relatedOrderId: order.id,
        createdBy,
      });
      await tx.orderItem.update({ where: { id: current.id }, data: { stockDeducted: false } });
      productIds.push(current.productId);
    });
  }
  return { restored: productIds.length, productIds: [...new Set(productIds)] };
}

export async function inventoryMovementsCsv(where: Prisma.InventoryMovementWhereInput = {}) {
  const movements = await prisma.inventoryMovement.findMany({
    where,
    include: { product: true, relatedOrder: true },
    orderBy: { createdAt: "desc" },
  });
  const header = [
    "created_at",
    "type",
    "sku",
    "product_name",
    "quantity",
    "before_quantity",
    "after_quantity",
    "reason",
    "related_order_id",
    "created_by",
  ];
  const rows = movements.map((movement) => [
    movement.createdAt.toISOString(),
    movement.type,
    movement.product.sku,
    movement.product.productName,
    movement.quantity,
    movement.beforeQuantity,
    movement.afterQuantity,
    movement.reason,
    movement.relatedOrder?.ebayOrderId ?? movement.relatedOrderId,
    movement.createdBy,
  ]);

  return toCsv([header, ...rows]);
}
