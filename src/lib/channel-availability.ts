// 판매 채널에 보낼 수량과 "품절" 판정을 한 곳에서 계산한다.
// 마지막으로 수집한 포카마켓 값은 수집 시각과 무관하게 사용한다. 데이터가 아예
// 없을 때만 품절을 추측하지 않고 전송 대상에서 제외한다.

export type ChannelAvailabilityInput = {
  status: string;
  stockQuantity: number;
  reservedQuantity?: number;
  isSoldOut: boolean;
  pocamarketAvailableCount: number | null;
  pocamarketSyncedAt: Date | string | null;
};

export type AvailabilityStatus =
  | "AVAILABLE"
  | "SOLD_OUT"
  | "HELD_FOR_ORDER"
  | "SOURCE_UNKNOWN"
  | "DISCONTINUED";

export type ChannelAvailability = {
  availabilityStatus: AvailabilityStatus;
  ownSellableQuantity: number;
  reservedQuantity: number;
  pocamarketAvailableCount: number | null;
  pocamarketListingQuantity: number;
  pocamarketSyncedAt: Date | string | null;
  quantity: number;
  actionable: boolean;
};

function nonNegative(value: number | null | undefined) {
  return Math.max(0, Number(value) || 0);
}

function normalizedStatus(value: string) {
  return value.trim().toLowerCase();
}

// `sold_out` is an internal stock display state, not a command to end a
// marketplace listing.  A fresh PocaMarket procurement offer can still make
// that card sellable.  Only explicit stop states may end a listing.
function isExplicitlyDiscontinued(value: string) {
  return ["inactive", "discontinued", "ended", "판매중지"].includes(normalizedStatus(value));
}

export function resolveChannelAvailability(
  input: ChannelAvailabilityInput,
): ChannelAvailability {
  const reservedQuantity = nonNegative(input.reservedQuantity);
  const ownSellableQuantity = Math.max(
    0,
    nonNegative(input.stockQuantity) - reservedQuantity,
  );
  const observedSourceQuantity = nonNegative(input.pocamarketAvailableCount);
  // 마지막 수집값은 24시간이 지나도 작업 기준으로 유지한다. null만 아직 수집된
  // 값이 없다는 뜻이다.
  const sourceKnown = input.isSoldOut || input.pocamarketAvailableCount !== null;
  const pocamarketListingQuantity = sourceKnown && !input.isSoldOut
    ? observedSourceQuantity
    : 0;

  if (isExplicitlyDiscontinued(input.status)) {
    return { availabilityStatus: "DISCONTINUED", ownSellableQuantity, reservedQuantity, pocamarketAvailableCount: input.pocamarketAvailableCount, pocamarketListingQuantity, pocamarketSyncedAt: input.pocamarketSyncedAt, quantity: 0, actionable: true };
  }
  if (ownSellableQuantity + pocamarketListingQuantity > 0) {
    return { availabilityStatus: "AVAILABLE", ownSellableQuantity, reservedQuantity, pocamarketAvailableCount: input.pocamarketAvailableCount, pocamarketListingQuantity, pocamarketSyncedAt: input.pocamarketSyncedAt, quantity: ownSellableQuantity + pocamarketListingQuantity, actionable: true };
  }
  if (!sourceKnown) {
    return { availabilityStatus: "SOURCE_UNKNOWN", ownSellableQuantity, reservedQuantity, pocamarketAvailableCount: input.pocamarketAvailableCount, pocamarketListingQuantity, pocamarketSyncedAt: input.pocamarketSyncedAt, quantity: 0, actionable: false };
  }
  if (nonNegative(input.stockQuantity) > 0) {
    return { availabilityStatus: "HELD_FOR_ORDER", ownSellableQuantity, reservedQuantity, pocamarketAvailableCount: input.pocamarketAvailableCount, pocamarketListingQuantity, pocamarketSyncedAt: input.pocamarketSyncedAt, quantity: 0, actionable: true };
  }
  return { availabilityStatus: "SOLD_OUT", ownSellableQuantity, reservedQuantity, pocamarketAvailableCount: input.pocamarketAvailableCount, pocamarketListingQuantity, pocamarketSyncedAt: input.pocamarketSyncedAt, quantity: 0, actionable: true };
}

export function availabilityReason(status: AvailabilityStatus, variation = false) {
  if (status === "DISCONTINUED") return variation ? "옵션 판매중지" : "단품 판매중지";
  if (status === "SOLD_OUT") return variation ? "옵션 품절" : "단품 품절";
  if (status === "HELD_FOR_ORDER") return "주문 예약분으로 판매 보류";
  if (status === "SOURCE_UNKNOWN") return "포카마켓 재고 확인 필요 (자동 전송 제외)";
  return "판매 가능";
}
