import { describe, expect, it } from "vitest";
import { publishJobLabel } from "@/lib/channel-publish-constants";

// 진행 중 작업에 막혔을 때 사람이 기다릴지 중단할지 정하려면 무엇이 막는지 알아야 한다.
describe("publishJobLabel", () => {
  it("채널과 작업 종류를 사람 말로 붙인다", () => {
    expect(publishJobLabel("SHOPIFY", "PRICE_INVENTORY")).toBe("Shopify 가격·재고");
    expect(publishJobLabel("EBAY", "IMAGES")).toBe("eBay 이미지");
    expect(publishJobLabel("SHOPIFY", "ARCHIVE")).toBe("Shopify 판매중단");
    expect(publishJobLabel("EBAY", "REGISTER")).toBe("eBay 신규등록");
  });

  it("모르는 종류는 원래 값을 그대로 남긴다", () => {
    expect(publishJobLabel("EBAY", "SOMETHING")).toBe("eBay SOMETHING");
  });
});
