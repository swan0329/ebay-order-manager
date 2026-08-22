-- 안전재고는 더 이상 판매 가능 수량 계산에 쓰지 않는다. 기존 값도 0으로
-- 정리해 이후 내보내기·복구 과정에서 과거 완충 수량이 되살아나지 않게 한다.
UPDATE "products"
SET "safety_stock" = 0
WHERE "safety_stock" <> 0;
