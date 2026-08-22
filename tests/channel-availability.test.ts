import { describe, expect, it } from "vitest";
import { resolveChannelAvailability } from "@/lib/channel-availability";

const lastCollected = new Date(Date.UTC(2026, 7, 19, 0, 0, 0));
const base = { status: "active", stockQuantity: 0, reservedQuantity: 0, isSoldOut: true, pocamarketAvailableCount: 0, pocamarketSyncedAt: lastCollected };

describe("채널 판매 가능 수량", () => {
  it("내 재고와 마지막 수집값이 모두 없을 때 품절이다", () => {
    expect(resolveChannelAvailability(base)).toMatchObject({ availabilityStatus: "SOLD_OUT", quantity: 0, actionable: true });
  });

  it("포카마켓 빠른구매 재고가 있으면 내 재고가 없어도 품절이 아니며 한 장만 연다", () => {
    expect(resolveChannelAvailability({ ...base, isSoldOut: false, pocamarketAvailableCount: 7 })).toMatchObject({ availabilityStatus: "AVAILABLE", quantity: 1, pocamarketListingQuantity: 1 });
  });

  it("내부 품절 표시는 포카마켓 조달 가능 상품을 판매중지시키지 않는다", () => {
    expect(resolveChannelAvailability({ ...base, status: "sold_out", isSoldOut: false, pocamarketAvailableCount: 2 })).toMatchObject({ availabilityStatus: "AVAILABLE", quantity: 1, actionable: true });
  });

  it("주문 예약분은 품절이 아니라 판매 보류다", () => {
    expect(resolveChannelAvailability({ ...base, stockQuantity: 1, reservedQuantity: 1 })).toMatchObject({ availabilityStatus: "HELD_FOR_ORDER", quantity: 0, actionable: true });
  });

  it("수집값이 아예 없을 때만 전송하지 않고, 오래된 마지막 수집값은 사용한다", () => {
    expect(resolveChannelAvailability({ ...base, isSoldOut: false, pocamarketAvailableCount: null, pocamarketSyncedAt: null })).toMatchObject({ availabilityStatus: "SOURCE_UNKNOWN", actionable: false });
    expect(resolveChannelAvailability({ ...base, isSoldOut: false, pocamarketAvailableCount: 2, pocamarketSyncedAt: new Date(0) })).toMatchObject({ availabilityStatus: "AVAILABLE", quantity: 1, actionable: true });
  });

  it("비활성 상품은 재고와 무관하게 판매중지다", () => {
    expect(resolveChannelAvailability({ ...base, status: "inactive", stockQuantity: 3 })).toMatchObject({ availabilityStatus: "DISCONTINUED", quantity: 0, actionable: true });
  });

  it("연결된 활성 리스팅은 내부 미등록 상태여도 최신 재고 기준으로 처리한다", () => {
    expect(resolveChannelAvailability({ ...base, status: "unlisted", stockQuantity: 3 })).toMatchObject({ availabilityStatus: "AVAILABLE", quantity: 3, actionable: true });
  });
});
