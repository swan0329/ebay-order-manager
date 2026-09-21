import type { EbayAccount } from "@/generated/prisma";
import { getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { XMLParser } from "fast-xml-parser";

/**
 * 계정의 판매 한도(Selling Limit).
 *
 * eBay Trading API `GetMyeBaySelling`의 `SellingSummary`에서 읽는다. 이 수치는
 * **이번 달에 더 팔 수 있는 수량·금액**이며 무료 등록 한도가 아니다. 등록수수료
 * 계산에는 절대 쓰지 않는다. 등록수수료는 정산에 찍힌 INSERTION_FEE만 쓴다
 * (`src/lib/ebay-insertion-fees.ts`).
 */
export type SellingLimit = {
  /** 이번 달 남은 등록·판매 가능 수량. eBay가 내려주지 않으면 null */
  quantityRemaining: number | null;
  /** 이번 달 남은 판매 가능 금액 */
  amountRemainingUsd: number | null;
  /** 이번 달 판매 건수·금액. eBay가 같은 응답에서 함께 내려준다. */
  soldCount: number | null;
  soldValueUsd: number | null;
};

function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  // 금액은 통화 속성이 붙어 객체로 올 수 있다.
  if (value && typeof value === "object" && "#text" in value) {
    return numberOf((value as { "#text": unknown })["#text"]);
  }
  return null;
}

/** 응답 파싱만 따로 둔다. 네트워크 없이 검증할 수 있어야 한다. */
export function parseSellingSummary(data: unknown): SellingLimit {
  const summary =
    data && typeof data === "object" && "Summary" in data
      ? ((data as { Summary?: Record<string, unknown> }).Summary ?? {})
      : {};
  return {
    quantityRemaining: numberOf(summary.QuantityLimitRemaining),
    amountRemainingUsd: numberOf(summary.AmountLimitRemaining),
    soldCount: numberOf(summary.TotalSoldCount),
    soldValueUsd: numberOf(summary.TotalSoldValue),
  };
}

export async function getSellingLimit(account: EbayAccount): Promise<SellingLimit> {
  const token = await getValidAccessToken(account);
  const response = await fetch(new URL("/ws/api.dll", getEbayConfig().hosts.api), {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    // 목록은 받지 않는다. 요약만 필요하다.
    body:
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
      "<SellingSummary><Include>true</Include></SellingSummary>" +
      "</GetMyeBaySellingRequest>",
  });
  const data = new XMLParser().parse(await response.text())?.GetMyeBaySellingResponse;
  if (!response.ok || !["Success", "Warning"].includes(data?.Ack)) {
    throw new Error("eBay 판매 한도를 조회하지 못했습니다.");
  }
  return parseSellingSummary(data);
}
