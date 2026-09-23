export const PROCUREMENT_REFRESH_MS = 6 * 60 * 60 * 1000;
export const PROCUREMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ProcurementFreshness = {
  pocamarketId?: string | null;
  pocamarketSyncedAt?: Date | string | null;
  pocamarketLastAttemptAt?: Date | string | null;
  salePrice?: unknown;
  ebayPrice?: unknown;
  ebayLastSyncedPrice?: unknown;
  lastUploadedAt?: Date | string | null;
};

function time(value: Date | string | null | undefined) {
  return value ? new Date(value).getTime() : 0;
}

export function procurementCostNeedsVerification(product: ProcurementFreshness) {
  const cost = Number(product.salePrice);
  if (!product.pocamarketId || !(cost > 0)) return false;
  // Legacy listing upserts wrote the exact USD price over the KRW observation.
  // Never reuse that value as a newly confirmed source cost, even with owned stock.
  return !Number.isInteger(cost) || (time(product.lastUploadedAt) > time(product.pocamarketSyncedAt) &&
    [product.ebayPrice, product.ebayLastSyncedPrice].some(value => value != null && Number(value) === cost));
}

// Missing date on a real source-linked product is unverified, never fresh.
export function procurementHoldReason(product: ProcurementFreshness, now = Date.now()) {
  if (procurementCostNeedsVerification(product)) return "원화 원가·달러 판매가 혼입 의심 · 원가 재확인 필요";
  if (!product.pocamarketId && product.pocamarketSyncedAt == null) return null;
  const success = time(product.pocamarketSyncedAt);
  if (!success || !Number.isFinite(success)) return "포카마켓 가격·수량 확인 전";
  if (time(product.pocamarketLastAttemptAt) > success) return "포카마켓 최근 확인 실패·재확인 대기";
  if (now - success >= PROCUREMENT_MAX_AGE_MS) return "포카마켓 정보 24시간 경과";
  return null;
}

export function procurementRefreshDue(product: ProcurementFreshness, now = Date.now()) {
  return Boolean(product.pocamarketId) && (Boolean(procurementHoldReason(product, now)) ||
    now - time(product.pocamarketSyncedAt) >= PROCUREMENT_REFRESH_MS);
}
