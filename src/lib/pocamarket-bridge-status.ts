import { prisma } from "@/lib/prisma";

// 브리지는 대기 중일 때 5초마다 작업을 물어본다. 그보다 넉넉하게 잡아서, 한두 번
// 놓친 것만으로 "꺼짐"이라고 말하지 않는다.
export const BRIDGE_OFFLINE_AFTER_MS = 30_000;

export type BridgeStatus = {
  online: boolean;
  deviceSerial: string | null;
  lastSeenAt: string | null;
  secondsAgo: number | null;
};

/**
 * 마지막 응답 시각만으로 브리지가 살아 있는지 판단한다.
 *
 * 시간 계산을 따로 떼어 두면 화면 문구를 시각에 의존하지 않고 확인할 수 있다.
 * 한 번도 붙은 적이 없으면(lastSeenAt이 없으면) 꺼진 것으로 본다. 대기 중인
 * 작업을 아무도 가져가지 않는 상황과 결과가 같기 때문이다.
 */
export function describeBridge(input: {
  deviceSerial: string | null;
  lastSeenAt: Date | null;
  now: Date;
}): BridgeStatus {
  if (!input.lastSeenAt) {
    return { online: false, deviceSerial: null, lastSeenAt: null, secondsAgo: null };
  }
  const elapsed = input.now.getTime() - input.lastSeenAt.getTime();
  return {
    online: elapsed >= 0 && elapsed < BRIDGE_OFFLINE_AFTER_MS,
    deviceSerial: input.deviceSerial,
    lastSeenAt: input.lastSeenAt.toISOString(),
    secondsAgo: Math.max(0, Math.round(elapsed / 1000)),
  };
}

let heartbeatReady: Promise<void> | null = null;

// 마이그레이션이 아직 적용되지 않은 환경에서도 주문 화면이 500으로 죽지 않도록,
// 구매 작업 표와 같은 방식으로 표가 있는지 한 번만 확인한다.
function ensureHeartbeatTable() {
  if (heartbeatReady) return heartbeatReady;
  heartbeatReady = prisma
    .$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "pocamarket_bridge_heartbeats" (
         "device_serial" TEXT PRIMARY KEY,
         "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    )
    .then(() => undefined)
    .catch((error) => {
      heartbeatReady = null;
      throw error;
    });
  return heartbeatReady;
}

export async function recordBridgeHeartbeat(deviceSerial: string | null) {
  await ensureHeartbeatTable();
  const serial = deviceSerial?.trim() || "unknown";
  await prisma.$executeRaw`
    INSERT INTO "pocamarket_bridge_heartbeats" ("device_serial", "last_seen_at")
    VALUES (${serial}, NOW())
    ON CONFLICT ("device_serial") DO UPDATE SET "last_seen_at" = NOW()
  `;
}

export async function readBridgeStatus(now = new Date()): Promise<BridgeStatus> {
  await ensureHeartbeatTable();
  const rows = await prisma.$queryRaw<Array<{ deviceSerial: string; lastSeenAt: Date }>>`
    SELECT "device_serial" AS "deviceSerial", "last_seen_at" AS "lastSeenAt"
    FROM "pocamarket_bridge_heartbeats" ORDER BY "last_seen_at" DESC LIMIT 1
  `;
  return describeBridge({
    deviceSerial: rows[0]?.deviceSerial ?? null,
    lastSeenAt: rows[0]?.lastSeenAt ?? null,
    now,
  });
}
