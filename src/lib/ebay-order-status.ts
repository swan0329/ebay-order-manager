// eBay 셀러허브와 동일한 주문 분류.
// eBay 원본의 배송상태(orderFulfillmentStatus) + 결제상태(orderPaymentStatus)
// + 취소상태(cancelStatus.cancelState)를 조합해 하나의 카테고리로 환산한다.

export type EbayOrderCategory =
  | "AWAITING_PAYMENT"
  | "AWAITING_SHIPMENT"
  | "SHIPPED"
  | "CANCELLED";

// 화면 탭/드롭다운 순서 (eBay 셀러허브 순서에 맞춤)
export const ebayOrderCategories: EbayOrderCategory[] = [
  "AWAITING_PAYMENT",
  "AWAITING_SHIPMENT",
  "SHIPPED",
  "CANCELLED",
];

export const ebayOrderCategoryLabel: Record<EbayOrderCategory, string> = {
  AWAITING_PAYMENT: "입금대기",
  AWAITING_SHIPMENT: "배송대기",
  SHIPPED: "배송완료",
  CANCELLED: "취소·환불",
};

export const ebayOrderCategoryStyle: Record<EbayOrderCategory, string> = {
  AWAITING_PAYMENT: "border-zinc-200 bg-zinc-50 text-zinc-700",
  AWAITING_SHIPMENT: "border-amber-200 bg-amber-50 text-amber-800",
  SHIPPED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  CANCELLED: "border-rose-200 bg-rose-50 text-rose-800",
};

export function deriveEbayOrderCategory(input: {
  fulfillmentStatus?: string | null;
  paymentStatus?: string | null;
  cancelState?: string | null;
}): EbayOrderCategory {
  const fulfillment = (input.fulfillmentStatus ?? "").toUpperCase();
  const payment = (input.paymentStatus ?? "").toUpperCase();
  const cancel = (input.cancelState ?? "").toUpperCase();

  if (cancel === "CANCELED" || cancel === "CANCELLED" || payment === "FULLY_REFUNDED") {
    return "CANCELLED";
  }
  if (fulfillment === "FULFILLED") {
    return "SHIPPED";
  }
  // 결제상태가 명확히 미결제/실패일 때만 입금대기. 값이 없으면 안전하게 배송대기로 둔다.
  if (payment === "PENDING" || payment === "FAILED") {
    return "AWAITING_PAYMENT";
  }
  return "AWAITING_SHIPMENT";
}

// URL의 status 파라미터를 카테고리 또는 "ALL"로 정규화한다.
// 과거에 쓰던 값(OPEN/NOT_STARTED/IN_PROGRESS/FULFILLED)도 호환되게 매핑한다.
export function normalizeOrderStatusParam(
  status: string | null | undefined,
): EbayOrderCategory | "ALL" {
  const value = (status ?? "").toUpperCase();

  switch (value) {
    case "ALL":
      return "ALL";
    case "AWAITING_PAYMENT":
      return "AWAITING_PAYMENT";
    case "SHIPPED":
    case "FULFILLED":
      return "SHIPPED";
    case "CANCELLED":
    case "CANCELED":
      return "CANCELLED";
    case "AWAITING_SHIPMENT":
    case "OPEN":
    case "NOT_STARTED":
    case "IN_PROGRESS":
      return "AWAITING_SHIPMENT";
    default:
      // 기본 보기: 배송대기 (eBay 셀러허브 기본과 동일)
      return "AWAITING_SHIPMENT";
  }
}
