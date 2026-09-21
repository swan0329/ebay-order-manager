import type { EbayAccount } from "@/generated/prisma";
import {
  accountHasScope,
  ebayApiRequest,
  sellAccountReadonlyScope,
} from "@/lib/services/ebayApiService";

/**
 * eBay 스토어 구독 등급과 그 등급의 무료 등록 할당량.
 *
 * 구독 등급은 Account API `GET /sell/account/v1/subscription`에서 읽는다. Trading API
 * `GetStore`의 `SubscriptionLevel`은 2023-03-31에 폐기돼 더는 내려오지 않는다.
 *
 * 무료 등록(Zero Insertion Fee) 할당량은 **API로 내려오지 않는다.** 남은 수량을 알려
 * 주는 eBay API는 없다. 아래 표는 eBay가 공표한 등급별 고정가 리스팅 할당량이며,
 * 정책이 바뀌면 함께 바꿔야 한다. 그래서 이 값은 "eBay가 확인해 준 잔여량"이 아니라
 * "요금제상 한 달 한도"로만 쓰고, 실제로 돈이 나갔는지는 정산의 INSERTION_FEE로
 * 판단한다(`src/lib/ebay-insertion-fees.ts`).
 */
export type StoreSubscriptionLevel =
  | "NONE"
  | "STARTER"
  | "BASIC"
  | "PREMIUM"
  | "ANCHOR"
  | "ENTERPRISE";

/** eBay 공표 기준(2026-09, ebay.com 고정가 리스팅). 출처를 화면에도 함께 보여 준다. */
export const publishedFreeListingAllowance: Record<StoreSubscriptionLevel, number> = {
  NONE: 250,
  STARTER: 250,
  BASIC: 1_000,
  PREMIUM: 10_000,
  ANCHOR: 25_000,
  ENTERPRISE: 100_000,
};

export type StoreSubscription = {
  level: StoreSubscriptionLevel;
  /** eBay가 내려준 원래 문자열. 우리가 등급을 잘못 맞췄는지 사람이 볼 수 있어야 한다. */
  rawLevel: string | null;
  marketplaceId: string | null;
  term: string | null;
  subscribed: boolean;
  /** 요금제상 한 달 무료 등록 한도. eBay가 확인해 준 잔여량이 아니다. */
  freeListingAllowance: number;
};

function normalizeLevel(value: unknown): StoreSubscriptionLevel {
  const text = typeof value === "string" ? value.toUpperCase() : "";
  // eBay는 등급 이름에 접두사·공백을 붙여 보내기도 한다. 포함 여부로 맞춘다.
  for (const level of ["ENTERPRISE", "ANCHOR", "PREMIUM", "BASIC", "STARTER"] as const) {
    if (text.includes(level)) return level;
  }
  // FEATURED는 PREMIUM의 옛 이름이다.
  if (text.includes("FEATURED")) return "PREMIUM";
  return "NONE";
}

export function parseStoreSubscription(body: unknown): StoreSubscription {
  const subscriptions =
    body && typeof body === "object" && Array.isArray((body as { subscriptions?: unknown }).subscriptions)
      ? ((body as { subscriptions: unknown[] }).subscriptions as Array<Record<string, unknown>>)
      : [];
  // 스토어 구독만 본다. 다른 구독(예: 광고 도구)은 등록 한도와 무관하다.
  const store =
    subscriptions.find((row) => String(row.subscriptionType ?? "").toUpperCase().includes("STORE")) ??
    subscriptions[0];
  const rawLevel = store ? String(store.subscriptionLevel ?? "") || null : null;
  const level = normalizeLevel(rawLevel);
  return {
    level,
    rawLevel,
    marketplaceId: store ? String(store.marketplaceId ?? "") || null : null,
    term: store ? String(store.term ?? "") || null : null,
    subscribed: Boolean(store) && level !== "NONE",
    freeListingAllowance: publishedFreeListingAllowance[level],
  };
}

export async function getStoreSubscription(account: EbayAccount): Promise<StoreSubscription> {
  if (!accountHasScope(account, sellAccountReadonlyScope)) {
    throw new Error(
      "이 eBay 연결에는 계정(Account) 조회 권한이 없습니다. 연결 화면에서 다시 연결해 권한을 받아 주세요.",
    );
  }
  const result = await ebayApiRequest(account, {
    host: "api",
    path: "/sell/account/v1/subscription",
  });
  return parseStoreSubscription(result.body);
}
