// eBay 리스팅에 올릴 수량을 정하는 단일 경로.
// 신규등록 파일, 가격·수량 변경 파일, 구버전 내보내기가 모두 이 규칙을 쓴다.
// 세 곳이 각자 계산하면 등록할 때와 변경할 때 수량이 달라진다.

import { procurementHoldReason, type ProcurementFreshness } from "@/lib/procurement-freshness";

export type ListingQuantityProduct = ProcurementFreshness & {
  // 내가 실제로 가진 수량.
  stockQuantity: number;
  // 포카마켓에서 지금 살 수 있는 수량. 동기화 시점의 값이다.
  pocamarketAvailableCount: number | null;
};

// 보유 재고 + 최근 확인된 구매 허용가격 이내 매물.
// 확인 실패·24시간 경과 시 조달 수량만 제외하고 보유 재고는 유지한다.
export function listingQuantity(
  product: ListingQuantityProduct,
  fallback = 0,
): number {
  const own = Math.max(0, product.stockQuantity);
  const held = procurementHoldReason(product);
  const procurable = held ? 0 : Math.max(0, product.pocamarketAvailableCount ?? 0);
  const total = own + procurable;

  // 어느 쪽 재고 신호도 없을 때만 넘겨받은 기본값을 쓴다.
  return total > 0 ? total : held || product.pocamarketId || product.pocamarketSyncedAt ? 0 : fallback;
}
