// eBay 리스팅에 올릴 수량을 정하는 단일 경로.
// 신규등록 파일, 가격·수량 변경 파일, 구버전 내보내기가 모두 이 규칙을 쓴다.
// 세 곳이 각자 계산하면 등록할 때와 변경할 때 수량이 달라진다.

export type ListingQuantityProduct = {
  // 내가 실제로 가진 수량.
  stockQuantity: number;
  // 포카마켓에서 지금 살 수 있는 수량. 동기화 시점의 값이다.
  pocamarketAvailableCount: number | null;
};

// 팔 수 있는 수량 = 내 재고 + 포카마켓에서 조달 가능한 수량.
// 포카마켓 매물은 다음 동기화 전에 사라질 수 있다. 그래도 판매 기회를 넓히기 위해
// 그대로 반영하기로 했으므로(운영자 결정), 매물이 빠지면 그날 변경 파일로 수량이
// 내려가는 것에 의존한다.
export function listingQuantity(
  product: ListingQuantityProduct,
  _fallback = 0,
): number {
  // 기존 내보내기 호출과의 호환을 위해 인자는 받지만, 재고 0을 기본값으로
  // 되살려 과판매하는 것을 막기 위해 의도적으로 사용하지 않는다.
  void _fallback;
  const own = Math.max(0, product.stockQuantity);
  // 조달 판매는 빠른구매 매물이 갑자기 사라질 수 있어 한 장만 연다. 템플릿의
  // 기본 수량으로 재고 0 상품을 되살리면 안 된다.
  const procurable = (product.pocamarketAvailableCount ?? 0) > 0 ? 1 : 0;
  return own + procurable;
}
