-- 브리지(PC에서 도는 휴대폰 조작 스크립트)가 살아 있는지 화면에서 알 수 있게
-- 마지막 응답 시각을 남긴다. 이 표가 비어 있으면 브리지가 한 번도 붙지 않은 것이고,
-- 오래됐으면 꺼진 것이다. 구매 작업 자체와는 수명이 다르므로 별도 표로 둔다.
CREATE TABLE IF NOT EXISTS "pocamarket_bridge_heartbeats" (
  "device_serial" TEXT PRIMARY KEY,
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "pocamarket_bridge_heartbeats_last_seen_idx"
  ON "pocamarket_bridge_heartbeats" ("last_seen_at" DESC);
