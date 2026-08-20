import "server-only";

import type { EbayAccount } from "@/generated/prisma";
import { getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { safeLog } from "@/lib/safe-log";

// 기존 eBay 리스팅의 가격과 수량을 바꾼다.
//
// 지금까지는 CSV를 만들어 사람이 올렸고, 그 사이에 실재고와 eBay 수량이 어긋나
// 이미 팔린 카드가 계속 팔렸다. 재고 없음으로 주문을 취소하는 일이 쌓이면 그것이
// 실제 계정 제한 사유가 된다. 그래서 이 경로만 API로 연다.
//
// 리스팅을 새로 만들지 않는다. 제목, 설명, 카테고리 같은 내용은 건드리지 않으므로
// 중복 리스팅 정책과도 무관하다.

const ITEMS_PER_CALL = 4; // ReviseInventoryStatus는 한 번에 네 건까지 받는다.

export type ReviseTarget = {
  itemId: string;
  sku?: string | null;
  /** 판매 가능 수량. 실재고가 아니라 예약을 뺀 값을 넣는다. */
  quantity?: number | null;
  /** 판매가(USD). 바꾸지 않으려면 비운다. */
  price?: number | null;
};

export type ReviseResult = {
  requested: number;
  succeeded: string[];
  failed: Array<{ itemId: string; reason: string }>;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inventoryStatusXml(target: ReviseTarget) {
  const parts = [`<ItemID>${escapeXml(target.itemId)}</ItemID>`];
  // SKU는 있으면 함께 보낸다. 옵션상품은 SKU로 어느 옵션인지 가린다.
  if (target.sku) parts.push(`<SKU>${escapeXml(target.sku)}</SKU>`);
  if (target.quantity !== null && target.quantity !== undefined) {
    parts.push(`<Quantity>${Math.max(0, Math.trunc(target.quantity))}</Quantity>`);
  }
  if (target.price !== null && target.price !== undefined) {
    parts.push(`<StartPrice>${Number(target.price).toFixed(2)}</StartPrice>`);
  }
  return `<InventoryStatus>${parts.join("")}</InventoryStatus>`;
}

function buildRequest(targets: ReviseTarget[]) {
  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
${targets.map(inventoryStatusXml).join("\n")}
</ReviseInventoryStatusRequest>`;
}

// eBay는 성공해도 경고를 함께 준다. Ack가 Failure일 때만 실패로 본다.
function parseResponse(xml: string) {
  const ack = /<Ack>([^<]+)<\/Ack>/.exec(xml)?.[1] ?? "Unknown";
  const messages = [...xml.matchAll(/<LongMessage>([^<]*)<\/LongMessage>/g)].map(
    (match) => match[1],
  );
  const severities = [...xml.matchAll(/<SeverityCode>([^<]*)<\/SeverityCode>/g)].map(
    (match) => match[1],
  );
  const hasError = severities.includes("Error") || ack === "Failure";
  return { ack, hasError, message: messages.join(" / ") || ack };
}

async function reviseChunk(account: EbayAccount, targets: ReviseTarget[]) {
  const config = getEbayConfig();
  const token = await getValidAccessToken(account);
  const response = await fetch(`${config.hosts.api}/ws/api.dll`, {
    method: "POST",
    headers: {
      "content-type": "text/xml;charset=UTF-8",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-CALL-NAME": "ReviseInventoryStatus",
      "X-EBAY-API-SITEID": "0",
      // OAuth 토큰을 쓸 때는 이 헤더에 넣고 RequesterCredentials는 보내지 않는다.
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: buildRequest(targets),
  });
  const xml = await response.text();
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${xml.slice(0, 200)}` };
  }
  const parsed = parseResponse(xml);
  return { ok: !parsed.hasError, message: parsed.message };
}

export async function reviseEbayPriceQuantity(
  account: EbayAccount,
  targets: ReviseTarget[],
): Promise<ReviseResult> {
  const result: ReviseResult = { requested: targets.length, succeeded: [], failed: [] };

  for (let offset = 0; offset < targets.length; offset += ITEMS_PER_CALL) {
    const chunk = targets.slice(offset, offset + ITEMS_PER_CALL);
    try {
      const outcome = await reviseChunk(account, chunk);
      for (const target of chunk) {
        if (outcome.ok) result.succeeded.push(target.itemId);
        // 한 번에 네 건을 함께 보내므로 어느 것이 실패했는지 eBay가 따로 알려 주지
        // 않을 수 있다. 그럴 때는 그 묶음 전체를 실패로 남겨 사람이 확인하게 한다.
        else result.failed.push({ itemId: target.itemId, reason: outcome.message });
      }
    } catch (error) {
      for (const target of chunk) {
        result.failed.push({
          itemId: target.itemId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  safeLog("info", "ebay.revise.price_quantity", {
    requested: result.requested,
    succeeded: result.succeeded.length,
    failed: result.failed.length,
  });
  return result;
}
