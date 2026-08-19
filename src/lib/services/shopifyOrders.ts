// Shopify 주문을 우리 주문 형태로 옮긴다.
//
// 판정에 쓰는 낱말은 eBay 것을 그대로 쓴다. 주문 화면, 재고 차감, 포카마켓 구매가
// 모두 `deriveEbayOrderCategory`가 읽는 값(배송상태, 결제상태, 취소상태)으로
// 돌아가므로, 여기서 같은 낱말로 옮겨 두면 화면과 업무 규칙을 하나도 고치지 않고
// Shopify 주문이 섞여 들어온다.

export type ShopifyOrderItem = {
  lineItemId: string;
  title: string;
  sku: string | null;
  quantity: number;
};

export type NormalizedShopifyOrder = {
  externalOrderId: string;
  orderStatus: string;
  fulfillmentStatus: string;
  buyerName: string | null;
  buyerUsername: string | null;
  buyerCountry: string | null;
  totalAmount: number;
  currency: string;
  orderDate: Date;
  paidAt: Date | null;
  items: ShopifyOrderItem[];
  rawJson: Record<string, unknown>;
};

function text(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function date(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Shopify는 배송을 안 한 주문의 fulfillment_status를 null로 준다. 우리 화면은
// 그것을 "아직 안 보냄"으로 읽어야 하므로 eBay와 같은 낱말로 바꾼다.
export function shopifyFulfillmentStatus(value: unknown) {
  switch (text(value)?.toLowerCase()) {
    case "fulfilled":
      return "FULFILLED";
    case "partial":
      return "IN_PROGRESS";
    default:
      return "NOT_STARTED";
  }
}

// 결제상태는 취소·환불 판정에도 쓰인다. 환불된 주문을 배송대기로 두면 있지도 않은
// 주문 때문에 재고를 빼거나 포카마켓에서 사게 된다.
export function shopifyPaymentStatus(value: unknown) {
  switch (text(value)?.toLowerCase()) {
    case "paid":
    case "partially_paid":
      return "PAID";
    case "refunded":
      return "FULLY_REFUNDED";
    case "partially_refunded":
      return "PARTIALLY_REFUNDED";
    case "voided":
      return "FAILED";
    case "pending":
    case "authorized":
      return "PENDING";
    default:
      return "UNKNOWN";
  }
}

export function normalizeShopifyOrder(raw: unknown): NormalizedShopifyOrder | null {
  const order = record(raw);
  const externalOrderId = text(order.id) ?? (typeof order.id === "number" ? String(order.id) : null);
  if (!externalOrderId) return null;

  const customer = record(order.customer);
  const shipping = record(order.shipping_address);
  const cancelledAt = date(order.cancelled_at);
  const paymentStatus = shopifyPaymentStatus(order.financial_status);

  const buyerName =
    [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ") ||
    text(shipping.name);

  const items: ShopifyOrderItem[] = (Array.isArray(order.line_items) ? order.line_items : [])
    .map((entry) => {
      const line = record(entry);
      const lineItemId =
        text(line.id) ?? (typeof line.id === "number" ? String(line.id) : null);
      if (!lineItemId) return null;
      const quantity = Number(line.quantity);
      return {
        lineItemId,
        title: text(line.name) ?? text(line.title) ?? "제목 없음",
        sku: text(line.sku),
        quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
      };
    })
    .filter((item): item is ShopifyOrderItem => item !== null);

  return {
    externalOrderId,
    // 취소는 주문상태로도 남긴다. 화면이 결제상태만 보지 않기 때문이다.
    orderStatus: cancelledAt ? "CANCELLED" : paymentStatus,
    fulfillmentStatus: cancelledAt
      ? "NOT_STARTED"
      : shopifyFulfillmentStatus(order.fulfillment_status),
    buyerName,
    buyerUsername: text(customer.email) ?? text(order.email),
    buyerCountry: text(shipping.country_code) ?? text(shipping.country),
    totalAmount: Number(order.total_price ?? 0) || 0,
    currency: text(order.currency) ?? "KRW",
    orderDate: date(order.created_at) ?? new Date(),
    paidAt: paymentStatus === "PAID" ? (date(order.processed_at) ?? date(order.created_at)) : null,
    items,
    // 주문 분류는 이 두 값을 본다. eBay 주문과 같은 자리에 넣어 두면 화면과 업무
    // 규칙이 채널을 구분하지 않아도 된다.
    rawJson: {
      ...order,
      orderPaymentStatus: paymentStatus,
      cancelStatus: { cancelState: cancelledAt ? "CANCELED" : null },
    },
  };
}
