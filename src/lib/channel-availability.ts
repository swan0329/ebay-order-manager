// 판매 채널에 보낼 수량과 "품절" 판정을 한 곳에서 계산한다.
// 포카마켓 값이 오래됐거나 없는 경우는 품절로 추측하지 않는다. 그런 항목을 0으로
// 보내면 실제로 팔 수 있는 카드를 잘못 내릴 수 있으므로 반드시 사람이 다시 확인한다.

export const POCAMARKET_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const MAX_PROCUREMENT_LISTING_QUANTITY = 1;

export type ChannelAvailabilityInput = {
  status: string;
  stockQuantity: number;
  reservedQuantity?: number;
  safetyStock?: number;
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
  safetyStock: number;
  pocamarketAvailableCount: number | null;
  pocamarketListingQuantity: number;
  pocamarketSyncedAt: Date | string | null;
  pocamarketFresh: boolean;
  quantity: number;
  actionable: boolean;
};

function nonNegative(value: number | null | undefined) {
  return Math.max(0, Number(value) || 0);
}

export function isFreshPocamarketObservation(
  syncedAt: Date | string | null,
  now = Date.now(),
) {
  if (!syncedAt) return false;
  const time = new Date(syncedAt).getTime();
  return Number.isFinite(time) && time <= now && now - time <= POCAMARKET_FRESHNESS_MS;
}

export function resolveChannelAvailability(
  input: ChannelAvailabilityInput,
  now = Date.now(),
): ChannelAvailability {
  const reservedQuantity = nonNegative(input.reservedQuantity);
  const safetyStock = nonNegative(input.safetyStock);
  const ownSellableQuantity = Math.max(
    0,
    nonNegative(input.stockQuantity) - reservedQuantity - safetyStock,
  );
  const pocamarketFresh = isFreshPocamarketObservation(input.pocamarketSyncedAt, now);
  const observedSourceQuantity = nonNegative(input.pocamarketAvailableCount);
  const sourceKnown = pocamarketFresh &&
    (input.isSoldOut || input.pocamarketAvailableCount !== null);
  const pocamarketListingQuantity = sourceKnown && !input.isSoldOut
    ? Math.min(MAX_PROCUREMENT_LISTING_QUANTITY, observedSourceQuantity)
    : 0;

  if (input.status !== "active") {
    return { availabilityStatus: "DISCONTINUED", ownSellableQuantity, reservedQuantity, safetyStock, pocamarketAvailableCount: input.pocamarketAvailableCount, pocamarketListingQuantity, pocamarketSyncedAt: input.pocamarketSyncedAt, pocamarketFresh, quantity: 0, actionable: true };
  }
  if (ownSellableQuantity + pocamarketListingQuantity > 0) {
    return { availabilityStatus: "AVAILABLE", ownSellableQuantity, reservedQuantity, safetyStock, pocamarketAvailableCount: input.pocamarketAvailableCount, pocamarketListingQuantity, pocamarketSyncedAt: input.pocamarketSyncedAt, pocamarketFresh, quantity: ownSellableQuantity + pocamarketListingQuantity, actionable: true };
  }
  if (!sourceKnown) {
    return { availabilityStatus: "SOURCE_UNKNOWN", ownSellableQuantity, reservedQuantity, safetyStock, pocamarketAvailableCount: input.pocamarketAvailableCount, pocamarketListingQuantity, pocamarketSyncedAt: input.pocamarketSyncedAt, pocamarketFresh, quantity: 0, actionable: false };
  }
  if (nonNegative(input.stockQuantity) > 0) {
    return { availabilityStatus: "HELD_FOR_ORDER", ownSellableQuantity, reservedQuantity, safetyStock, pocamarketAvailableCount: input.pocamarketAvailableCount, pocamarketListingQuantity, pocamarketSyncedAt: input.pocamarketSyncedAt, pocamarketFresh, quantity: 0, actionable: true };
  }
  return { availabilityStatus: "SOLD_OUT", ownSellableQuantity, reservedQuantity, safetyStock, pocamarketAvailableCount: input.pocamarketAvailableCount, pocamarketListingQuantity, pocamarketSyncedAt: input.pocamarketSyncedAt, pocamarketFresh, quantity: 0, actionable: true };
}

export function availabilityReason(status: AvailabilityStatus, variation = false) {
  if (status === "DISCONTINUED") return variation ? "옵션 판매중지" : "단품 판매중지";
  if (status === "SOLD_OUT") return variation ? "옵션 품절" : "단품 품절";
  if (status === "HELD_FOR_ORDER") return "예약·안전재고 판매 보류";
  if (status === "SOURCE_UNKNOWN") return "포카마켓 재고 확인 필요 (자동 전송 제외)";
  return "판매 가능";
}
