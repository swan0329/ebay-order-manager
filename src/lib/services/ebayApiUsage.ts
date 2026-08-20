import "server-only";

import { getEbayApiUsage } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";

// eBay가 돌려준 한도 정보를 화면이 읽기 쉬운 형태로 줄인다.
// 걱정의 근거가 "지인 말"이 아니라 "남은 호출 수"가 되도록 하는 것이 목적이다.

export type ApiUsageRow = {
  api: string;
  resource: string;
  limit: number;
  remaining: number;
  used: number;
  usedRate: number;
  resetAt: string | null;
};

export type ApiUsageSummary = {
  connected: boolean;
  environment: string | null;
  rows: ApiUsageRow[];
  /** 가장 많이 쓴 항목의 사용률. 자동화 주기를 정할 때 이것만 보면 된다. */
  busiestRate: number;
  message?: string;
};

export async function loadEbayApiUsage(userId: string): Promise<ApiUsageSummary> {
  const account = await prisma.ebayAccount.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  if (!account) {
    return {
      connected: false,
      environment: null,
      rows: [],
      busiestRate: 0,
      message: "eBay 계정이 연결되어 있지 않습니다.",
    };
  }

  const body = await getEbayApiUsage();
  const rows: ApiUsageRow[] = [];
  for (const entry of body.rateLimits ?? []) {
    for (const resource of entry.resources ?? []) {
      for (const rate of resource.rates ?? []) {
        const limit = Number(rate.limit ?? 0);
        const remaining = Number(rate.remaining ?? 0);
        if (!limit) continue;
        rows.push({
          api: [entry.apiContext, entry.apiName].filter(Boolean).join(" · ") || "알 수 없음",
          resource: resource.name ?? "-",
          limit,
          remaining,
          used: Math.max(0, limit - remaining),
          usedRate: Math.min(1, Math.max(0, (limit - remaining) / limit)),
          resetAt: rate.reset ?? null,
        });
      }
    }
  }

  // 많이 쓴 것부터 보여 준다. 여유 있는 항목을 먼저 보면 정작 봐야 할 것을 놓친다.
  rows.sort((a, b) => b.usedRate - a.usedRate);

  return {
    connected: true,
    environment: account.environment,
    rows,
    busiestRate: rows[0]?.usedRate ?? 0,
  };
}
