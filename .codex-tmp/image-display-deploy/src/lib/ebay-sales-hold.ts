import { randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { prisma } from "@/lib/prisma";
import { ebayApiRequest, getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";
import { EbayApiError, getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { listingQuantity } from "@/lib/listing-quantity";
import { ensureEbayOutOfStockControl } from "@/lib/ebay-out-of-stock";

type Offer = { offerId?: string; sku?: string; status?: string; availableQuantity?: number; listing?: { listingId?: string } };
export function exactPublishedOffer(offers: Offer[], sku: string, itemId: string) {
  const matches = offers.filter(offer => offer.sku === sku && offer.status === "PUBLISHED" && offer.listing?.listingId === itemId);
  if (matches.length !== 1 || !matches[0].offerId) throw new Error("eBay Inventory 판매 연결을 확정하지 못했습니다.");
  return matches[0];
}
type Variation = { SKU?: string; Quantity?: string; SellingStatus?: { QuantitySold?: string } };
type Item = Variation & { ItemID?: string; Variations?: { Variation?: Variation | Variation[] } };
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function observedEbayAvailable(item: Item, sku: string) {
  const variants = item.Variations?.Variation;
  const rows = variants ? Array.isArray(variants) ? variants : [variants] : [];
  const match = rows.length ? rows.filter(row => row.SKU === sku) : item.SKU === sku ? [item] : [];
  if (match.length !== 1) throw new Error("eBay 상품번호 연결을 확인하지 못했습니다.");
  const quantity = Number(match[0].Quantity), sold = Number(match[0].SellingStatus?.QuantitySold ?? 0);
  if (!Number.isFinite(quantity) || !Number.isFinite(sold)) throw new Error("eBay 수량 응답을 확인하지 못했습니다.");
  return { available: Math.max(0, quantity - sold), variation: rows.length > 0 };
}

// Emergency zero-only correction after a feed/report disagrees with GetItem.
// It cannot set a price, reopen stock, or end a shared variation parent.
export async function ensureEbayProductSalesHold(userId: string, productId: string) {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const settings = await prisma.pricingSettings.findUnique({ where: { id: "default" } });
  if (!product.ebayItemId) throw new Error("eBay 연결이 없습니다.");
  if (resolveListingPriceUsd(product, settings ?? undefined) && listingQuantity(product) > 0) throw new Error("현재 판매 가능 상품입니다. 품절·가격 보류 대상만 수량 0으로 정정할 수 있습니다.");
  const account = await getActiveEbayInventoryAccount(userId), token = await getValidAccessToken(account);
  const call = async (name: string, fields: string) => {
    const response = await fetch(new URL("/ws/api.dll", getEbayConfig().hosts.api), { method: "POST", cache: "no-store", signal: AbortSignal.timeout(25000),
      headers: { "Content-Type": "text/xml", "X-EBAY-API-CALL-NAME": name, "X-EBAY-API-SITEID": "0", "X-EBAY-API-COMPATIBILITY-LEVEL": "1423", "X-EBAY-API-IAF-TOKEN": token },
      body: `<?xml version="1.0" encoding="UTF-8"?><${name}Request xmlns="urn:ebay:apis:eBLBaseComponents"><MessageID>${randomUUID()}</MessageID>${fields}</${name}Request>` });
    const data = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(await response.text())[`${name}Response`];
    if (!response.ok || !["Success", "Warning"].includes(data?.Ack)) throw new Error("eBay 판매 보류 요청을 확인하지 못했습니다.");
    return data;
  };
  const read = async () => {
    const item = (await call("GetItem", `<ItemID>${xml(product.ebayItemId!)}</ItemID><DetailLevel>ReturnAll</DetailLevel>`)).Item as Item;
    if (item.ItemID !== product.ebayItemId) throw new Error("eBay 판매상품 연결이 다릅니다.");
    return observedEbayAvailable(item, product.sku);
  };
  const before = await read();
  if (before.available === 0) return { sku: product.sku, available: 0, verified: true, changed: false };
  await ensureEbayOutOfStockControl(account);
  const log = await prisma.syncLog.create({ data: { userId, type: "EBAY_SALES_HOLD", status: "PARTIAL", message: `${product.sku}: 판매 수량 0 정정 요청`, rawJson: { productId, itemId: product.ebayItemId, before: before.available } } });
  let offers: Offer[] | null = null;
  try {
    const response = await ebayApiRequest(account, { path: "/sell/inventory/v1/offer", query: { sku: product.sku, limit: 100 } });
    const body = response.body as { offers?: Offer[]; total?: number };
    if ((body.total ?? 0) > 100) throw new Error("eBay offer 조회 범위를 초과했습니다.");
    offers = body.offers ?? [];
  } catch (error) { if (!(error instanceof EbayApiError && error.status === 404)) throw error; }
  let inventoryVerified = false;
  if (offers?.length) {
    const offer = exactPublishedOffer(offers, product.sku, product.ebayItemId);
    const result = await ebayApiRequest(account, { method: "POST", path: "/sell/inventory/v1/bulk_update_price_quantity", body: { requests: [{ sku: product.sku, shipToLocationAvailability: { quantity: 0 }, offers: [{ offerId: offer.offerId, availableQuantity: 0 }] }] } });
    const rows = (result.body as { responses?: Array<{ sku?: string; statusCode?: number }> }).responses;
    if (!rows?.length || rows.some(row => row.sku !== product.sku || !row.statusCode || row.statusCode >= 300)) throw new Error("eBay Inventory 수량 정정이 완료되지 않았습니다.");
    const check = await ebayApiRequest(account, { path: `/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId!)}` });
    const saved = exactPublishedOffer([check.body as Offer], product.sku, product.ebayItemId);
    const inventory = await ebayApiRequest(account, { path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(product.sku)}` });
    const quantity = (inventory.body as { availability?: { shipToLocationAvailability?: { quantity?: number } } }).availability?.shipToLocationAvailability?.quantity;
    inventoryVerified = saved.availableQuantity === 0 && quantity === 0;
    if (!inventoryVerified) throw new Error("eBay Inventory 실제 수량 0을 확인하지 못했습니다.");
    await prisma.product.update({ where: { id: product.id }, data: { ebayOfferId: offer.offerId } });
  } else {
    await call("ReviseInventoryStatus", `<InventoryStatus><ItemID>${xml(product.ebayItemId)}</ItemID>${before.variation ? `<SKU>${xml(product.sku)}</SKU>` : ""}<Quantity>0</Quantity></InventoryStatus>`);
  }
  const after = await read();
  await prisma.syncLog.update({ where: { id: log.id }, data: { status: after.available === 0 ? "SUCCESS" : "FAILED", message: `${product.sku}: 실제 판매 가능 수량 ${after.available}`, rawJson: { productId, itemId: product.ebayItemId, before: before.available, after: after.available, inventoryVerified } } });
  if (after.available !== 0) throw new Error(`${product.sku}: eBay 응답과 실제 수량이 아직 일치하지 않습니다.`);
  return { sku: product.sku, available: 0, verified: true, changed: true };
}
