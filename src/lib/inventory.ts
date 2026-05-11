import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import { toCsv } from "@/lib/csv";
import { matchOrderItemsForOrder } from "@/lib/services/matchingService";
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
  const canceledStatuses = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
  return (
    !canceledStatuses.includes(order.orderStatus) &&
    ["NOT_STARTED", "IN_PROGRESS"].includes(order.fulfillmentStatus)
  );
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

  await prisma.product.update({
    where: { id: input.productId },
    data: {
      stockQuantity: afterQuantity,
      status:
        afterQuantity <= 0
          ? "sold_out"
          : product.status === "sold_out"
            ? "active"
            : product.status,
    },
  });

  return prisma.inventoryMovement.create({
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
      status: afterQuantity <= 0 ? "sold_out" : product.status === "sold_out" ? "active" : product.status,
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
    return { deducted: 0, skipped: order.items.length, shortages: 0, unmatched: 0 };
  }

  let deducted = 0;
  let skipped = 0;
  let shortages = 0;
  let unmatched = 0;

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

    await createInventoryMovement({
      productId: currentItem.product.id,
      type: "ORDER_DEDUCT",
      quantity: currentItem.quantity,
      reason: `Order ${order.ebayOrderId}`,
      relatedOrderId: order.id,
      createdBy,
    });
    await prisma.orderItem.update({
      where: { id: currentItem.id },
      data: { stockDeducted: true },
    });
    deducted += 1;
  }

  return { deducted, skipped, shortages, unmatched };
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
