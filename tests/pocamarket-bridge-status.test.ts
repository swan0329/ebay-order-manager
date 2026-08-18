import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { BRIDGE_OFFLINE_AFTER_MS, describeBridge } = await import(
  "@/lib/pocamarket-bridge-status"
);

const now = new Date("2026-08-18T12:00:00.000Z");

describe("브리지 연결 상태 판단", () => {
  it("방금 응답했으면 연결됨으로 본다", () => {
    const status = describeBridge({
      deviceSerial: "192.168.35.129:41655",
      lastSeenAt: new Date(now.getTime() - 4_000),
      now,
    });
    expect(status).toMatchObject({ online: true, secondsAgo: 4, deviceSerial: "192.168.35.129:41655" });
  });

  it("기준 시간을 넘겨 응답이 없으면 꺼진 것으로 본다", () => {
    const status = describeBridge({
      deviceSerial: "device-1",
      lastSeenAt: new Date(now.getTime() - BRIDGE_OFFLINE_AFTER_MS),
      now,
    });
    expect(status.online).toBe(false);
    expect(status.secondsAgo).toBe(BRIDGE_OFFLINE_AFTER_MS / 1000);
  });

  it("폴링을 한두 번 놓친 정도로는 꺼졌다고 하지 않는다", () => {
    // 브리지는 5초마다 물어본다. 15초는 세 번 놓친 것이라 아직 살아 있다고 본다.
    expect(describeBridge({ deviceSerial: "device-1", lastSeenAt: new Date(now.getTime() - 15_000), now }).online).toBe(true);
  });

  it("한 번도 붙은 적 없으면 꺼진 것으로 본다", () => {
    // 대기 중인 작업을 아무도 가져가지 않는다는 점에서 결과가 같다.
    expect(describeBridge({ deviceSerial: null, lastSeenAt: null, now })).toEqual({
      online: false,
      deviceSerial: null,
      lastSeenAt: null,
      secondsAgo: null,
    });
  });

  it("서버와 시계가 어긋나 미래 시각이 와도 연결됨이라고 하지 않는다", () => {
    const status = describeBridge({ deviceSerial: "device-1", lastSeenAt: new Date(now.getTime() + 60_000), now });
    expect(status.online).toBe(false);
    expect(status.secondsAgo).toBe(0);
  });
});
