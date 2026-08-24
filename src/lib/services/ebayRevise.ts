import "server-only";

import type { EbayAccount } from "@/generated/prisma";
import { getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { safeLog } from "@/lib/safe-log";
import sharp from "sharp";

// 기존 eBay 리스팅의 가격과 수량을 바꾼다.
//
// 지금까지는 CSV를 만들어 사람이 올렸고, 그 사이에 실재고와 eBay 수량이 어긋나
// 이미 팔린 카드가 계속 팔렸다. 재고 없음으로 주문을 취소하는 일이 쌓이면 그것이
// 실제 계정 제한 사유가 된다. 그래서 이 경로만 API로 연다.
//
// 리스팅을 새로 만들지 않는다. 제목, 설명, 카테고리 같은 내용은 건드리지 않으므로
// 중복 리스팅 정책과도 무관하다.

const ITEMS_PER_CALL = 4; // ReviseInventoryStatus는 한 번에 네 건까지 받는다.
// eBay 공식 순간 제한(판매자별 15초에 6,000회)보다 훨씬 낮게 유지한다.
// 직렬 처리의 긴 대기만 줄이고, 같은 계정에 무제한 요청이 몰리지는 않게 한다.
const EBAY_CONCURRENCY = 3;
const VERIFY_ATTEMPTS = 2;
const EBAY_REQUEST_TIMEOUT_MS = 20_000;

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
  failed: Array<{ itemId: string; targetKey: string; reason: string }>;
};

export function reviseTargetKey(target: Pick<ReviseTarget, "itemId" | "sku">) {
  return target.sku ? `${target.itemId}:${target.sku}` : target.itemId;
}

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

export function buildReviseInventoryRequest(targets: ReviseTarget[]) {
  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
${targets.map(inventoryStatusXml).join("\n")}
</ReviseInventoryStatusRequest>`;
}

export function buildRevisePictureRequest(itemId: string, imageUrl: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${escapeXml(itemId)}</ItemID>
    <PictureDetails><PictureURL>${escapeXml(imageUrl)}</PictureURL></PictureDetails>
  </Item>
</ReviseFixedPriceItemRequest>`;
}

export async function reviseEbayRepresentativePicture(account: EbayAccount, itemId: string, imageUrl: string) {
  const config = getEbayConfig();
  const token = await getValidAccessToken(account);
  const response = await fetch(`${config.hosts.api}/ws/api.dll`, {
    method: "POST",
    headers: {
      "content-type": "text/xml;charset=UTF-8",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-CALL-NAME": "ReviseFixedPriceItem",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: buildRevisePictureRequest(itemId, imageUrl),
  });
  const xml = await response.text();
  if (!response.ok) throw new Error(`eBay 대표사진 수정 실패 (HTTP ${response.status})`);
  const parsed = parseResponse(xml);
  if (parsed.hasError) throw new Error(parsed.message);
  await verifyEbayRepresentativePicture(account, itemId, imageUrl);
  safeLog("info", "ebay.revise.representative_picture", { itemId });
  return { itemId, imageUrl, ack: parsed.ack, verified: true };
}

async function visualFingerprint(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`대표사진 확인용 이미지를 불러오지 못했습니다. (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("대표사진 확인용 이미지 크기가 올바르지 않습니다.");
  return sharp(bytes, { failOn: "none" }).rotate().resize(32, 32, { fit: "fill" }).grayscale().raw().toBuffer();
}

export async function representativePicturesMatch(expectedUrl: string, actualUrl: string) {
  if (expectedUrl === actualUrl) return true;
  const [expected, actual] = await Promise.all([visualFingerprint(expectedUrl), visualFingerprint(actualUrl)]);
  if (expected.length !== actual.length || !expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference += Math.abs(expected[index] - actual[index]);
  // eBay가 JPEG를 다시 압축하고 크기를 바꾸므로 바이트 일치는 불가능하다.
  // 0~255 밝기 기준 평균 차이 12 이하는 같은 대표사진의 재인코딩으로 본다.
  return difference / expected.length <= 12;
}

export async function verifyEbayRepresentativePicture(account: EbayAccount, itemId: string, expectedUrl: string) {
  const config = getEbayConfig();
  const token = await getValidAccessToken(account);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${config.hosts.api}/ws/api.dll`, {
      method: "POST",
      headers: { "content-type": "text/xml;charset=UTF-8", "X-EBAY-API-COMPATIBILITY-LEVEL": "1193", "X-EBAY-API-CALL-NAME": "GetItem", "X-EBAY-API-SITEID": "0", "X-EBAY-API-IAF-TOKEN": token },
      body: `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${escapeXml(itemId)}</ItemID></GetItemRequest>`,
    });
    const currentXml = await response.text();
    if (response.ok && xmlValue(currentXml, "Ack") !== "Failure") {
      const pictureDetails = xmlValue(currentXml, "PictureDetails");
      const actualUrl = xmlValue(pictureDetails, "PictureURL") || xmlValue(pictureDetails, "ExternalPictureURL");
      if (actualUrl && await representativePicturesMatch(expectedUrl, actualUrl)) return;
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${itemId}: eBay 재조회에서 새 대표사진의 실제 반영을 확인하지 못했습니다.`);
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
  const message = messages.join(" / ") || ack;
  return { ack, hasError, message, rateLimited: /(?:call|request|usage|rate).{0,40}limit|temporarily blocked/iu.test(message) };
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
    body: buildReviseInventoryRequest(targets),
    signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
  });
  const xml = await response.text();
  if (!response.ok) {
    return { ok: false, rateLimited: response.status === 429, message: `HTTP ${response.status}: ${xml.slice(0, 200)}` };
  }
  const parsed = parseResponse(xml);
  return { ok: !parsed.hasError, rateLimited: parsed.rateLimited, message: parsed.message };
}

function xmlValue(xml: string, tag: string) {
  return new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, "i").exec(xml)?.[1]?.trim() ?? "";
}

function xmlBlocks(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, "gi"))].map((match) => match[1]);
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, run),
  );
  return results;
}

async function verifyTargets(account: EbayAccount, targets: ReviseTarget[]) {
  const config = getEbayConfig();
  const token = await getValidAccessToken(account);
  const failures = new Map<string, string>();
  const itemIds = [...new Set(targets.map((target) => target.itemId))];
  const verificationResults = await mapWithConcurrency(itemIds, EBAY_CONCURRENCY, async (itemId) => {
    let itemFailures = new Map<string, string>();
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
      itemFailures = new Map<string, string>();
      const itemTargets = targets.filter((row) => row.itemId === itemId);
      try {
        const response = await fetch(`${config.hosts.api}/ws/api.dll`, {
          method: "POST",
          headers: { "content-type": "text/xml;charset=UTF-8", "X-EBAY-API-COMPATIBILITY-LEVEL": "1193", "X-EBAY-API-CALL-NAME": "GetItem", "X-EBAY-API-SITEID": "0", "X-EBAY-API-IAF-TOKEN": token },
          body: `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${escapeXml(itemId)}</ItemID></GetItemRequest>`,
          signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
        });
        const xml = await response.text();
        if (!response.ok || xmlValue(xml, "Ack") === "Failure") {
          for (const target of itemTargets) itemFailures.set(reviseTargetKey(target), "eBay 반영 후 실제 상품을 다시 조회하지 못했습니다.");
        } else {
          const variations = xmlBlocks(xmlValue(xml, "Variations"), "Variation").map((block) => {
            const quantity = Number(xmlValue(block, "Quantity"));
            const quantitySold = Number(xmlValue(block, "QuantitySold") || 0);
            return { sku: xmlValue(block, "SKU"), price: Number(xmlValue(block, "StartPrice")), quantity, quantitySold, availableQuantity: quantity - quantitySold };
          });
          for (const target of itemTargets.filter((row) => row.sku)) {
            const actual = variations.find((row) => row.sku === target.sku);
            if (!actual) itemFailures.set(reviseTargetKey(target), `${target.sku}: eBay 재조회에서 옵션을 찾지 못했습니다.`);
            else if (target.price != null && (!Number.isFinite(actual.price) || Math.abs(actual.price - target.price) >= 0.005)) itemFailures.set(reviseTargetKey(target), `${target.sku}: eBay 실제 가격 ${actual.price || "확인 불가"} USD가 전송 가격 ${target.price.toFixed(2)} USD와 다릅니다.`);
            else if (target.quantity != null && (!Number.isFinite(actual.availableQuantity) || actual.availableQuantity !== Math.max(0, Math.trunc(target.quantity)))) itemFailures.set(reviseTargetKey(target), `${target.sku}: eBay 실제 판매 가능 수량 ${actual.availableQuantity}개(전체 ${actual.quantity} - 판매 ${actual.quantitySold})가 전송 수량 ${target.quantity}개와 다릅니다.`);
          }
          for (const target of itemTargets.filter((row) => !row.sku)) {
            const price = Number(xmlValue(currentItemXml(xml), "StartPrice"));
            const quantity = Number(xmlValue(currentItemXml(xml), "Quantity"));
            const quantitySold = Number(xmlValue(currentItemXml(xml), "QuantitySold") || 0);
            const availableQuantity = quantity - quantitySold;
            if (target.price != null && (!Number.isFinite(price) || Math.abs(price - target.price) >= 0.005)) itemFailures.set(reviseTargetKey(target), `${itemId}: eBay 실제 가격 ${price || "확인 불가"} USD가 전송 가격 ${target.price.toFixed(2)} USD와 다릅니다.`);
            else if (target.quantity != null && (!Number.isFinite(availableQuantity) || availableQuantity !== Math.max(0, Math.trunc(target.quantity)))) itemFailures.set(reviseTargetKey(target), `${itemId}: eBay 실제 판매 가능 수량 ${availableQuantity}개(전체 ${quantity} - 판매 ${quantitySold})가 전송 수량 ${target.quantity}개와 다릅니다.`);
          }
        }
      } catch (error) {
        const reason = error instanceof Error && error.name === "TimeoutError" ? "eBay 실제 상품 재조회가 20초 안에 응답하지 않았습니다." : "eBay 실제 상품 재조회 중 네트워크 오류가 발생했습니다.";
        for (const target of itemTargets) itemFailures.set(reviseTargetKey(target), reason);
      }
      if (!itemFailures.size) return itemFailures;
      if (attempt < VERIFY_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    return itemFailures;
  });
  for (const itemFailures of verificationResults) {
    for (const [key, reason] of itemFailures) failures.set(key, reason);
  }
  return failures;
}

function currentItemXml(xml: string) {
  return xmlValue(xml, "Item") || xml;
}

export async function reviseEbayPriceQuantity(
  account: EbayAccount,
  targets: ReviseTarget[],
): Promise<ReviseResult> {
  const result: ReviseResult = { requested: targets.length, succeeded: [], failed: [] };

  const chunks: ReviseTarget[][] = [];
  for (let offset = 0; offset < targets.length; offset += ITEMS_PER_CALL) chunks.push(targets.slice(offset, offset + ITEMS_PER_CALL));
  let rateLimitMessage: string | null = null;
  const chunkResults = await mapWithConcurrency(chunks, EBAY_CONCURRENCY, async (chunk) => {
    if (rateLimitMessage) return { chunk, outcome: { ok: false, rateLimited: true, message: rateLimitMessage } };
    try {
      const outcome = await reviseChunk(account, chunk);
      if (outcome.rateLimited) rateLimitMessage = `eBay 호출 한도 응답으로 남은 전송을 중지했습니다: ${outcome.message}`;
      return { chunk, outcome };
    } catch (error) {
      return { chunk, outcome: { ok: false, rateLimited: false, message: error instanceof Error && error.name === "TimeoutError" ? "eBay 전송이 20초 안에 응답하지 않았습니다." : error instanceof Error ? error.message : String(error) } };
    }
  });
  for (const { chunk, outcome } of chunkResults) {
    for (const target of chunk) {
      if (outcome.ok) result.succeeded.push(reviseTargetKey(target));
      // 한 번에 네 건을 함께 보내므로 어느 것이 실패했는지 eBay가 따로 알려 주지
      // 않을 수 있다. 그럴 때는 그 묶음 전체를 실패로 남겨 사람이 확인하게 한다.
      else result.failed.push({ itemId: target.itemId, targetKey: reviseTargetKey(target), reason: outcome.message });
    }
  }

  const initiallySucceeded = targets.filter((target) => result.succeeded.includes(reviseTargetKey(target)));
  const verificationFailures = await verifyTargets(account, initiallySucceeded);
  if (verificationFailures.size) {
    result.succeeded = result.succeeded.filter((key) => !verificationFailures.has(key));
    for (const target of initiallySucceeded) {
      const reason = verificationFailures.get(reviseTargetKey(target));
      if (reason) result.failed.push({ itemId: target.itemId, targetKey: reviseTargetKey(target), reason });
    }
  }

  safeLog("info", "ebay.revise.price_quantity", {
    requested: result.requested,
    succeeded: result.succeeded.length,
    failed: result.failed.length,
  });
  return result;
}
