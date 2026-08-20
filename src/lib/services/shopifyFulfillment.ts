import "server-only";

import { getShopifyConfig } from "@/lib/env";
import { shopifyApiRequest } from "@/lib/services/shopifyService";

export async function createShopifyFulfillment(input: {
  orderId: string;
  carrierCode: string;
  trackingNumber: string;
}) {
  const config = getShopifyConfig();
  const response = await shopifyApiRequest(config, {
    path: `/orders/${encodeURIComponent(input.orderId)}/fulfillment_orders.json`,
  }) as { fulfillment_orders?: Array<{ id: number; status?: string }> };
  const open = (response.fulfillment_orders ?? []).filter((order) =>
    ["open", "in_progress", "scheduled"].includes(String(order.status ?? "open")),
  );
  if (!open.length) throw new Error("Shopify에서 처리 가능한 배송 주문을 찾지 못했습니다.");

  const result = await shopifyApiRequest(config, {
    method: "POST",
    path: "/fulfillments.json",
    body: {
      fulfillment: {
        line_items_by_fulfillment_order: open.map((order) => ({
          fulfillment_order_id: order.id,
        })),
        tracking_info: {
          company: input.carrierCode,
          number: input.trackingNumber,
        },
        notify_customer: false,
      },
    },
  }) as { fulfillment?: { id?: number | string } };
  return { fulfillmentId: String(result.fulfillment?.id ?? "") };
}
