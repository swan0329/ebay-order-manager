import { isDeepStrictEqual } from "node:util";
import type { EbayAccount } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
import { ebayApiRequest } from "@/lib/services/ebayApiService";
import { exactPublishedOffer } from "@/lib/ebay-sales-hold";

type Remote = Record<string, unknown>;
export const inventoryImageLocale = (locale: unknown) => typeof locale === "string" ? locale.replaceAll("_", "-") : "en-US";
const pick = (value: Remote, keys: string[]) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
export function inventoryImageBody(value: Remote, urls: string[], group = false): Remote {
  if (!urls.length || urls.some(url => !url.startsWith("https://"))) throw new Error("승인된 이미지 URL이 필요합니다.");
  if (group) return { ...pick(value, ["aspects", "description", "subtitle", "title", "variantSKUs", "variesBy"]), imageUrls: urls };
  if (!value.product || typeof value.product !== "object") throw new Error("기존 Inventory 상품 정보를 확인하지 못했습니다.");
  return { ...pick(value, ["availability", "condition", "conditionDescription", "conditionDescriptors", "packageWeightAndSize"]), product: { ...value.product, imageUrls: urls } };
}
export function sameImageGroup(remote: unknown, skus: string[]) {
  return Array.isArray(remote) && remote.length === skus.length && new Set(remote).size === skus.length && skus.every(sku => remote.includes(sku));
}
// GET/merge/PUT is required by eBay's replacement API. Preserve all writable
// non-image fields; never regenerate inventory, offers, policies or options.
export async function repairInventoryImages(account: EbayAccount, itemId: string, rows: Array<{ sku: string; urls: string[] }>, parentUrls: string[], groupKeyHint?: string | null) {
  let offers: Parameters<typeof exactPublishedOffer>[0];
  try {
    const response = await ebayApiRequest(account, { path: "/sell/inventory/v1/offer", query: { sku: rows[0].sku, limit: 100 } });
    offers = (response.body as { offers?: typeof offers })?.offers ?? [];
  } catch (error) { if (error instanceof EbayApiError && error.status === 404) return false; throw error; }
  if (!offers.length) return false;
  exactPublishedOffer(offers, rows[0].sku, itemId);
  const read = async (path: string) => (await ebayApiRequest(account, { path })).body as Remote;
  const first = await read(`/sell/inventory/v1/inventory_item/${encodeURIComponent(rows[0].sku)}`);
  const keys = Array.isArray(first.groupIds) ? first.groupIds : Array.isArray(first.inventoryItemGroupKeys) ? first.inventoryItemGroupKeys : [];
  let groupPath: string | undefined;
  if (rows.length > 1 || groupKeyHint || keys.length) {
    const candidates = [...new Set([...keys.filter(key => typeof key === "string"), ...(groupKeyHint ? [groupKeyHint] : [])])] as string[];
    for (const key of candidates) {
      const path = `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(key)}`;
      const group = await read(path);
      if (sameImageGroup(group.variantSKUs, rows.map(row => row.sku))) { groupPath = path; break; }
    }
    if (!groupPath) throw new Error("Inventory 묶음의 전체 SKU 연결이 일치하지 않습니다.");
  }
  const replace = async (path: string, urls: string[], group = false) => {
    const before = await read(path);
    const payload = inventoryImageBody(before, urls, group);
    const existing = group ? before.imageUrls : (before.product as Remote)?.imageUrls;
    if (isDeepStrictEqual(existing, urls)) return;
    await ebayApiRequest(account, { method: "PUT", path, body: payload, contentLanguage: inventoryImageLocale(before.locale) });
    const after = await read(path);
    if (!isDeepStrictEqual(inventoryImageBody(after, urls, group), payload)) throw new Error("Inventory 이미지 변경 후 다른 판매 정보가 바뀌었습니다. 대조 확인이 필요합니다.");
    const actual = group ? after.imageUrls : (after.product as Remote)?.imageUrls;
    if (!isDeepStrictEqual(actual, urls)) throw new Error("Inventory 이미지 URL 반영 확인 대기 중입니다.");
  };
  for (const row of rows) await replace(`/sell/inventory/v1/inventory_item/${encodeURIComponent(row.sku)}`, row.urls);
  if (groupPath) await replace(groupPath, parentUrls, true);
  return true;
}
