import type { EbayAccount } from "@/generated/prisma";
import { EbayApiError, getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { XMLParser } from "fast-xml-parser";
import { ebayApiRequest } from "@/lib/services/ebayApiService";
import { exactPublishedOffer } from "@/lib/ebay-sales-hold";
import type { EbayFeedTarget } from "@/lib/ebay-feed-xml";
import { ensureEbayOutOfStockControl } from "@/lib/ebay-out-of-stock";

type Node = Record<string, unknown>;
const node = (value: unknown): Node => value && typeof value === "object" ? value as Node : {};
export function ebayTargetMatchesGetItem(value: unknown, target: EbayFeedTarget) {
  const item = node(value);
  if (item.ItemID !== target.itemId) return false;
  const status = node(item.SellingStatus).ListingStatus;
  if (status !== undefined && status !== "Active") return false;
  const raw = node(item.Variations).Variation;
  const variations = raw == null ? [] : (Array.isArray(raw) ? raw : [raw]).map(node);
  const matches = variations.length ? variations.filter(row => row.SKU === target.sku) :
    target.useSku === false || item.SKU === target.sku ? [item] : [];
  if (matches.length !== 1 || variations.length > 0 && target.useSku === false) return false;
  const row = matches[0];
  if (row.Quantity == null || String(row.Quantity).trim() === "") return false;
  const quantity = Number(row.Quantity), sold = Number(node(row.SellingStatus).QuantitySold ?? 0);
  if (!Number.isInteger(quantity) || !Number.isInteger(sold) || quantity < 0 || sold < 0 || Math.max(0, quantity - sold) !== (target.quantity ?? 0)) return false;
  if (!target.price) return true;
  const price = node(variations.length ? row.StartPrice : node(item.SellingStatus).CurrentPrice ?? item.StartPrice);
  return price["@_currencyID"] === "USD" && Number.isFinite(Number(price["#text"])) &&
    Math.abs(Number(price["#text"]) - Number(target.price)) < 0.01;
}

/** eBay Trading 응답의 오류 코드와 문구를 사람이 읽을 수 있게 모은다. */
function ebayErrorText(result: unknown) {
  const raw = result && typeof result === "object" ? (result as { Errors?: unknown }).Errors : undefined;
  const rows = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
  const parts = rows.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const message = String(row.LongMessage ?? row.ShortMessage ?? "").trim();
    if (!message) return [];
    const code = String(row.ErrorCode ?? "").trim();
    return [code ? `${message} (오류코드 ${code})` : message];
  });
  return parts.length ? parts.join(" / ") : `Ack=${(result as { Ack?: unknown })?.Ack ?? "없음"}`;
}

async function verifyActualListing(account: EbayAccount, target: EbayFeedTarget) {
  const token = await getValidAccessToken(account);
  const itemId = target.itemId.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 750));
    const response = await fetch(new URL("/ws/api.dll", getEbayConfig().hosts.api), {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(25000),
      headers: { "Content-Type": "text/xml", "X-EBAY-API-CALL-NAME": "GetItem", "X-EBAY-API-SITEID": "0", "X-EBAY-API-COMPATIBILITY-LEVEL": "1423", "X-EBAY-API-IAF-TOKEN": token },
      body: `<?xml version="1.0" encoding="UTF-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${itemId}</ItemID><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>`,
    });
    const result = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(await response.text()).GetItemResponse;
    if (response.ok && ["Success", "Warning"].includes(result?.Ack) && ebayTargetMatchesGetItem(result.Item, target)) return;
    if (!response.ok || !["Success", "Warning"].includes(result?.Ack)) {
      lastError = `GetItem 실패 (HTTP ${response.status}) · ${ebayErrorText(result)}`;
      // 호출 한도를 넘긴 상태라면 두 번 더 불러도 같은 답이다. 한도만 더 태운다.
      if (lastError.includes("518")) break;
    }
  }
  throw new Error(
    `${target.sku}: eBay 실제 판매 가격·수량을 확인하지 못했습니다` +
    (lastError ? ` · ${lastError}` : " · 목표값과 일치하지 않습니다"),
  );
}

// Trading updates alone can leave the Inventory stock pool unchanged. Mirror
// only the exact published offer; never create, withdraw, or republish a listing.
async function reflectTarget(account: EbayAccount, target: EbayFeedTarget) {
  let body: { offers?: Parameters<typeof exactPublishedOffer>[0]; total?: number };
  try {
    const response = await ebayApiRequest(account, { path: "/sell/inventory/v1/offer", query: { sku: target.sku, limit: 100 } });
    body = (response.body ?? {}) as typeof body;
  } catch (error) {
    if (error instanceof EbayApiError && error.status === 404) {
      return reflectLegacyTarget(account, target);
    }
    throw error;
  }
  if (!body.offers?.length) {
    return reflectLegacyTarget(account, target);
  }
  if ((body.total ?? 0) > 100) throw new Error("eBay offer 조회 범위를 초과했습니다.");
  const offer = exactPublishedOffer(body.offers, target.sku, target.itemId);
  const quantity = target.quantity ?? 0;
  const response = await ebayApiRequest(account, { method: "POST", path: "/sell/inventory/v1/bulk_update_price_quantity", body: {
    requests: [{ sku: target.sku, shipToLocationAvailability: { quantity }, offers: [{ offerId: offer.offerId, availableQuantity: quantity,
      ...(target.price ? { price: { value: target.price, currency: "USD" } } : {}) }] }],
  } });
  const rows = (response.body as { responses?: Array<{ sku?: string; statusCode?: number }> } | null)?.responses;
  if (!rows?.length || rows.some(row => row.sku !== target.sku || !row.statusCode || row.statusCode >= 300)) throw new Error("eBay Inventory 가격·수량 반영을 확인하지 못했습니다.");
  await verifyActualListing(account, target);
  return { legacy: false, offerId: offer.offerId };
}

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
async function reflectLegacyTarget(account: EbayAccount, target: EbayFeedTarget) {
  const token = await getValidAccessToken(account);
  const call = async (name: string, fields: string) => {
    const response = await fetch(new URL("/ws/api.dll", getEbayConfig().hosts.api), {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(25000),
      headers: { "Content-Type": "text/xml", "X-EBAY-API-CALL-NAME": name, "X-EBAY-API-SITEID": "0", "X-EBAY-API-COMPATIBILITY-LEVEL": "1423", "X-EBAY-API-IAF-TOKEN": token },
      body: `<?xml version="1.0" encoding="UTF-8"?><${name}Request xmlns="urn:ebay:apis:eBLBaseComponents">${fields}</${name}Request>`,
    });
    const result = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(await response.text())[`${name}Response`];
    if (!response.ok || !["Success", "Warning"].includes(result?.Ack)) {
      // eBay가 말한 이유를 버리면 호출 한도 초과인지 리스팅 문제인지 알 수 없다.
      throw new Error(`${name} 실패 (HTTP ${response.status}) · ${ebayErrorText(result)}`);
    }
    return result;
  };
  const item = node((await call("GetItem", `<ItemID>${escapeXml(target.itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel>`)).Item);
  const raw = node(item.Variations).Variation;
  const rows = raw == null ? [] : (Array.isArray(raw) ? raw : [raw]).map(node);
  if (item.ItemID !== target.itemId || (rows.length ? target.useSku === false || rows.filter(row => row.SKU === target.sku).length !== 1 : target.useSku !== false && item.SKU !== target.sku)) {
    throw new Error("eBay 정확한 판매 옵션을 확인하지 못해 변경하지 않았습니다.");
  }
  await call("ReviseInventoryStatus", `<InventoryStatus><ItemID>${escapeXml(target.itemId)}</ItemID>${rows.length ? `<SKU>${escapeXml(target.sku)}</SKU>` : ""}${target.price ? `<StartPrice currencyID="USD">${escapeXml(target.price)}</StartPrice>` : ""}<Quantity>${target.quantity ?? 0}</Quantity></InventoryStatus>`);
  await verifyActualListing(account, target);
  return { legacy: true };
}

export async function holdEbayInventoryTarget(account: EbayAccount, target: EbayFeedTarget) {
  await ensureEbayOutOfStockControl(account);
  return reflectTarget(account, { ...target, quantity: 0, price: undefined });
}

export async function reflectEbayInventoryTarget(account: EbayAccount, target: EbayFeedTarget) {
  try {
    await ensureEbayOutOfStockControl(account);
    // Read back the new price while this exact option has no available stock.
    const held = await reflectTarget(account, { ...target, quantity: 0 });
    if (!(target.quantity && target.quantity > 0)) return held;
    if (!target.price || !Number.isFinite(Number(target.price)) || Number(target.price) <= 0) throw new Error("판매 재개 가격이 없습니다.");
    return await reflectTarget(account, target);
  } catch (error) {
    const cause = error instanceof Error ? error.message : "가격·수량 반영 실패";
    try { await holdEbayInventoryTarget(account, target); }
    catch (holdError) {
      throw new Error(
        `${target.sku}: 가격·수량 반영도 판매 수량 0도 확인하지 못했습니다 · 반영 실패: ${cause}` +
        ` · 보류 실패: ${holdError instanceof Error ? holdError.message : "알 수 없음"}`,
      );
    }
    throw new Error(`${error instanceof Error ? error.message : "가격·수량 반영 실패"} 해당 옵션 판매 수량 0 확인 완료`);
  }
}
