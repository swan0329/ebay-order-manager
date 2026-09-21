import { describe, expect, it } from "vitest";
import { parseStoreSubscription, publishedFreeListingAllowance } from "@/lib/ebay-store-subscription";

describe("parseStoreSubscription", () => {
  it("프리미엄 구독을 읽고 등급 한도를 붙인다", () => {
    const parsed = parseStoreSubscription({
      subscriptions: [
        {
          marketplaceId: "EBAY_US",
          subscriptionId: "s1",
          subscriptionLevel: "PREMIUM",
          subscriptionType: "STORE",
          term: "MONTHLY",
        },
      ],
    });
    expect(parsed.level).toBe("PREMIUM");
    expect(parsed.subscribed).toBe(true);
    expect(parsed.freeListingAllowance).toBe(10_000);
    expect(parsed.marketplaceId).toBe("EBAY_US");
  });

  it("스토어가 아닌 구독은 등급으로 쓰지 않는다", () => {
    const parsed = parseStoreSubscription({
      subscriptions: [
        { subscriptionType: "PROMOTED_LISTINGS", subscriptionLevel: "BASIC" },
        { subscriptionType: "STORE", subscriptionLevel: "ANCHOR" },
      ],
    });
    expect(parsed.level).toBe("ANCHOR");
    expect(parsed.freeListingAllowance).toBe(25_000);
  });

  it("FEATURED는 PREMIUM의 옛 이름이다", () => {
    expect(parseStoreSubscription({ subscriptions: [{ subscriptionType: "STORE", subscriptionLevel: "FEATURED" }] }).level).toBe("PREMIUM");
  });

  it("구독이 없으면 스토어 없음으로 본다", () => {
    const parsed = parseStoreSubscription({ subscriptions: [] });
    expect(parsed.level).toBe("NONE");
    expect(parsed.subscribed).toBe(false);
    expect(parsed.freeListingAllowance).toBe(250);
    expect(parsed.rawLevel).toBeNull();
  });

  it("모르는 등급 이름은 원문을 남겨 사람이 확인하게 한다", () => {
    const parsed = parseStoreSubscription({
      subscriptions: [{ subscriptionType: "STORE", subscriptionLevel: "SOMETHING_NEW" }],
    });
    expect(parsed.level).toBe("NONE");
    expect(parsed.rawLevel).toBe("SOMETHING_NEW");
  });

  it("공표 한도표는 등급마다 값을 갖는다", () => {
    expect(Object.values(publishedFreeListingAllowance).every((value) => value > 0)).toBe(true);
  });
});
