import { describe, expect, it } from "vitest";
import { resolveChannelAvailability } from "@/lib/channel-availability";

const now = Date.UTC(2026, 7, 21, 0, 0, 0);
const fresh = new Date(now - 60_000);
const base = { status: "active", stockQuantity: 0, reservedQuantity: 0, safetyStock: 0, isSoldOut: true, pocamarketAvailableCount: 0, pocamarketSyncedAt: fresh };

describe("채널 판매 가능 수량", () => {
  it("내 재고와 빠른구매 재고가 모두 없고 최신 확인됐을 때만 품절이다", () => {
    expect(resolveChannelAvailability(base, now)).toMatchObject({ availabilityStatus: "SOLD_OUT", quantity: 0, actionable: true });
  });

  it("포카마켓 빠른구매 재고가 있으면 내 재고가 없어도 품절이 아니며 한 장만 연다", () => {
    expect(resolveChannelAvailability({ ...base, isSoldOut: false, pocamarketAvailableCount: 7 }, now)).toMatchObject({ availabilityStatus: "AVAILABLE", quantity: 1, pocamarketListingQuantity: 1 });
  });

  it("내부 품절 표시는 포카마켓 조달 가능 상품을 판매중지시키지 않는다", () => {
    expect(resolveChannelAvailability({ ...base, status: "sold_out", isSoldOut: false, pocamarketAvailableCount: 2 }, now)).toMatchObject({ availabilityStatus: "AVAILABLE", quantity: 1, actionable: true });
  });

  it("내 재고가 예약 또는 안전재고로 막힌 것은 품절이 아니라 판매 보류다", () => {
    expect(resolveChannelAvailability({ ...base, stockQuantity: 2, reservedQuantity: 1, safetyStock: 1 }, now)).toMatchObject({ availabilityStatus: "HELD_FOR_ORDER", quantity: 0, actionable: true });
  });

  it("포카마켓 확인 값이 없거나 24시간 넘게 오래되면 0을 보내지 않는다", () => {
    expect(resolveChannelAvailability({ ...base, isSoldOut: false, pocamarketAvailableCount: null, pocamarketSyncedAt: null }, now)).toMatchObject({ availabilityStatus: "SOURCE_UNKNOWN", actionable: false });
    expect(resolveChannelAvailability({ ...base, pocamarketSyncedAt: new Date(now - 24 * 60 * 60 * 1000 - 1) }, now)).toMatchObject({ availabilityStatus: "SOURCE_UNKNOWN", actionable: false });
  });

  it("비활성 상품은 재고와 무관하게 판매중지다", () => {
    expect(resolveChannelAvailability({ ...base, status: "inactive", stockQuantity: 3 }, now)).toMatchObject({ availabilityStatus: "DISCONTINUED", quantity: 0, actionable: true });
  });

  it("내부 상태와 활성 리스팅이 모순되면 전송하지 않고 확인 대상으로 남긴다", () => {
    expect(resolveChannelAvailability({ ...base, status: "unlisted", stockQuantity: 3 }, now)).toMatchObject({ availabilityStatus: "LISTING_STATUS_REVIEW", quantity: 0, actionable: false });
  });
});
