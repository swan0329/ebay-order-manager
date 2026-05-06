import { prisma } from "@/lib/prisma";

const openFulfillmentStatuses = new Set(["NOT_STARTED", "IN_PROGRESS"]);

export type OrderWarningLevel = "none" | "warning" | "critical";

type AutomationOrder = {
  fulfillmentStatus: string;
  shipByDate: Date | null;
  items: {
    productId: string | null;
    stockDeducted: boolean;
    quantity: number;
    product: { stockQuantity: number } | null;
  }[];
  shipments: { status: string }[];
};

export function orderWarningClass(level: string) {
  if (level === "critical") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  if (level === "warning") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  return "bg-zinc-100 text-zinc-600 ring-zinc-200";
}

export function getOrderAutomationState(
  order: AutomationOrder,
  now = new Date(),
) {
  const unmatchedCount = order.items.filter((item) => !item.productId).length;
  const shortageCount = order.items.filter(
    (item) =>
      !item.stockDeducted &&
      item.product &&
      item.product.stockQuantity < item.quantity,
  ).length;
  const failedShipmentCount = order.shipments.filter(
    (shipment) => shipment.status === "FAILED",
  ).length;
  const isOpen = openFulfillmentStatuses.has(order.fulfillmentStatus);
  const msUntilShipBy = order.shipByDate
    ? order.shipByDate.getTime() - now.getTime()
    : null;
  const isOverdue = isOpen && msUntilShipBy !== null && msUntilShipBy < 0;
  const isDueSoon =
    isOpen &&
    msUntilShipBy !== null &&
    msUntilShipBy >= 0 &&
    msUntilShipBy <= 24 * 60 * 60 * 1000;
  const tags: string[] = [];
  const messages: string[] = [];

  if (unmatchedCount) {
    tags.push("미매칭");
    messages.push(`상품 미매칭 ${unmatchedCount}건`);
  }

  if (shortageCount) {
    tags.push("재고부족");
    messages.push(`재고부족 ${shortageCount}건`);
  }

  if (failedShipmentCount) {
    tags.push("배송실패");
    messages.push(`배송처리 실패 ${failedShipmentCount}건`);
  }

  if (isOverdue) {
    tags.push("배송마감초과");
    messages.push("배송 마감일 초과");
  } else if (isDueSoon) {
    tags.push("배송마감임박");
    messages.push("24시간 이내 배송 마감");
  }

  const warningLevel: OrderWarningLevel =
    unmatchedCount || shortageCount || failedShipmentCount || isOverdue
      ? "critical"
      : isDueSoon
        ? "warning"
        : "none";

  return {
    tags,
    warningLevel,
    warningMessage: messages.length ? messages.join(" · ") : null,
  };
}

export async function applyOrderAutomation(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: true } },
      shipments: true,
    },
  });

  if (!order) {
    return null;
  }

  const state = getOrderAutomationState(order);

  return prisma.order.update({
    where: { id: order.id },
    data: {
      tags: state.tags,
      warningLevel: state.warningLevel,
      warningMessage: state.warningMessage,
      automationCheckedAt: new Date(),
    },
  });
}

export async function applyOrderAutomationMany(orderIds: string[]) {
  const uniqueIds = [...new Set(orderIds)];

  for (const orderId of uniqueIds) {
    await applyOrderAutomation(orderId);
  }
}
