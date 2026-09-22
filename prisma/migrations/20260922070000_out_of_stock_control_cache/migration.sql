-- 변동처리를 할 때마다 Trading API GetUserPreferences로 "품절 시 리스팅 유지"를
-- 확인했다. 작업 수만큼 호출이 쌓여 일일 한도를 넘겼고(오류 518), 그 뒤로는 모든
-- 수량 변경이 막혔다. 한 번 확인한 사실을 기록해 두고 하루에 한 번만 다시 묻는다.
ALTER TABLE "ebay_accounts"
  ADD COLUMN IF NOT EXISTS "out_of_stock_control_at" TIMESTAMP(3);
