import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { parseSellingSummary } from "@/lib/ebay-selling-limit";

const response = (inner: string) =>
  new XMLParser().parse(
    `<?xml version="1.0" encoding="UTF-8"?><GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Summary>${inner}</Summary></GetMyeBaySellingResponse>`,
  ).GetMyeBaySellingResponse;

describe("parseSellingSummary", () => {
  it("판매 한도 잔여 수량과 금액을 읽는다", () => {
    expect(
      parseSellingSummary(
        response(
          "<QuantityLimitRemaining>45663</QuantityLimitRemaining><AmountLimitRemaining>499123.45</AmountLimitRemaining><TotalSoldCount>18</TotalSoldCount><TotalSoldValue>876.55</TotalSoldValue>",
        ),
      ),
    ).toEqual({
      quantityRemaining: 45663,
      amountRemainingUsd: 499123.45,
      soldCount: 18,
      soldValueUsd: 876.55,
    });
  });

  it("eBay가 한도를 내려주지 않으면 null로 두고 지어내지 않는다", () => {
    expect(parseSellingSummary(response("<TotalSoldCount>0</TotalSoldCount>"))).toEqual({
      quantityRemaining: null,
      amountRemainingUsd: null,
      soldCount: 0,
      soldValueUsd: null,
    });
    expect(parseSellingSummary({})).toEqual({
      quantityRemaining: null,
      amountRemainingUsd: null,
      soldCount: null,
      soldValueUsd: null,
    });
  });

  it("통화 속성이 붙은 금액도 숫자로 읽는다", () => {
    const withAttribute = parseSellingSummary({
      Summary: { AmountLimitRemaining: { "#text": "499123.45", "@_currencyID": "USD" } },
    });
    expect(withAttribute.amountRemainingUsd).toBe(499123.45);
  });
});
