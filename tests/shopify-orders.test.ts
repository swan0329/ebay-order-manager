import { describe, expect, it } from "vitest";
import { normalizeShopifyOrder } from "@/lib/services/shopifyOrders";
import { deriveEbayOrderCategory } from "@/lib/ebay-order-status";

// Shopify Orders API 응답 형태를 그대로 본떴다.
const baseOrder = {
  id: 5123456789,
  created_at: "2026-08-19T02:10:00+09:00",
  processed_at: "2026-08-19T02:11:00+09:00",
  financial_status: "paid",
  fulfillment_status: null,
  cancelled_at: null,
  total_price: "23000",
  currency: "KRW",
  email: "buyer@example.com",
  customer: { first_name: "길동", last_name: "홍", email: "buyer@example.com" },
  shipping_address: { name: "홍길동", country_code: "KR" },
  line_items: [
    { id: 9911, name: "Stray Kids HAN DICON", sku: "82737", quantity: 2 },
    { id: 9912, name: "IVE Wonyoung ELEVEN", sku: "40581", quantity: 1 },
  ],
};

// 주문 화면과 재고·구매 규칙이 모두 이 함수를 통해 주문을 분류한다.
const categoryOf = (order: ReturnType<typeof normalizeShopifyOrder>) => {
  const raw = order!.rawJson as Record<string, unknown>;
  const cancel = raw.cancelStatus as { cancelState: string | null };
  return deriveEbayOrderCategory({
    fulfillmentStatus: order!.fulfillmentStatus,
    paymentStatus: raw.orderPaymentStatus as string,
    cancelState: cancel.cancelState,
  });
};

describe("Shopify 주문 옮기기", () => {
  it("주문번호와 줄, 수량, SKU를 그대로 가져온다", () => {
    const order = normalizeShopifyOrder(baseOrder)!;
    expect(order.externalOrderId).toBe("5123456789");
    expect(order.totalAmount).toBe(23000);
    expect(order.currency).toBe("KRW");
    expect(order.items).toEqual([
      { lineItemId: "9911", title: "Stray Kids HAN DICON", sku: "82737", quantity: 2 },
      { lineItemId: "9912", title: "IVE Wonyoung ELEVEN", sku: "40581", quantity: 1 },
    ]);
  });

  it("결제 완료에 미배송이면 배송대기로 분류된다", () => {
    // 이 분류가 맞아야 재고 차감과 포카마켓 구매가 eBay와 똑같이 돌아간다.
    expect(categoryOf(normalizeShopifyOrder(baseOrder))).toBe("AWAITING_SHIPMENT");
  });

  it("배송 완료는 배송됨으로 분류된다", () => {
    const order = normalizeShopifyOrder({ ...baseOrder, fulfillment_status: "fulfilled" });
    expect(order!.fulfillmentStatus).toBe("FULFILLED");
    expect(categoryOf(order)).toBe("SHIPPED");
  });

  it("취소 주문은 취소로 분류된다", () => {
    // 취소를 배송대기로 두면 있지도 않은 주문 때문에 재고를 빼거나 카드를 사게 된다.
    const order = normalizeShopifyOrder({
      ...baseOrder,
      cancelled_at: "2026-08-19T05:00:00+09:00",
    });
    expect(order!.orderStatus).toBe("CANCELLED");
    expect(categoryOf(order)).toBe("CANCELLED");
  });

  it("환불 주문도 취소로 분류된다", () => {
    const order = normalizeShopifyOrder({ ...baseOrder, financial_status: "refunded" });
    expect(categoryOf(order)).toBe("CANCELLED");
  });

  it("미결제는 입금대기로 분류된다", () => {
    const order = normalizeShopifyOrder({ ...baseOrder, financial_status: "pending" });
    expect(order!.paidAt).toBeNull();
    expect(categoryOf(order)).toBe("AWAITING_PAYMENT");
  });

  it("SKU가 없는 줄도 버리지 않는다", () => {
    // 버리면 주문에 있는 물건이 화면에서 사라진다. 연결은 사람이 하면 된다.
    const order = normalizeShopifyOrder({
      ...baseOrder,
      line_items: [{ id: 1, name: "이름만 있는 상품", quantity: 1 }],
    });
    expect(order!.items).toEqual([
      { lineItemId: "1", title: "이름만 있는 상품", sku: null, quantity: 1 },
    ]);
  });

  it("주문번호가 없으면 받지 않는다", () => {
    expect(normalizeShopifyOrder({ line_items: [] })).toBeNull();
    expect(normalizeShopifyOrder(null)).toBeNull();
  });
});
