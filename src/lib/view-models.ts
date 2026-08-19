import type { Shipment } from "@/generated/prisma";
import type { ShippingOrder } from "@/components/BulkShippingClient";

type OrderWithItems = {
  id: string;
  // 채널 공통 주문번호. eBay 전용 번호를 직접 보지 않는다.
  externalOrderId: string;
  buyerName: string | null;
  buyerUsername: string | null;
  buyerCountry: string | null;
  orderDate: Date;
  fulfillmentStatus: string;
  items: {
    title: string;
    sku: string | null;
    quantity: number;
  }[];
  shipments?: Shipment[];
};

export function formatDate(date: Date | null | undefined) {
  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function toShippingOrder(order: OrderWithItems): ShippingOrder {
  return {
    id: order.id,
    externalOrderId: order.externalOrderId,
    buyerName: order.buyerName ?? order.buyerUsername ?? "-",
    buyerCountry: order.buyerCountry ?? "-",
    items: order.items.map((item) => item.title).join(" | "),
    sku: order.items.map((item) => item.sku ?? "").filter(Boolean).join(" | "),
    quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    orderDate: order.orderDate.toISOString(),
    fulfillmentStatus: order.fulfillmentStatus,
  };
}

export function trackingNumbers(shipments: Shipment[] | undefined) {
  return shipments?.map((shipment) => shipment.trackingNumber).join(" | ") || "-";
}
