import "server-only";

import type { EbayAccount } from "@/generated/prisma";
import { getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { withVariationListingMetadata } from "@/lib/variation-listing-products";
import { buildVariationListingGroups } from "@/lib/variation-listing-groups";

export type UnitRepair = { itemId: string; sku: string; currentName: string; desiredName: string; productId: string; quantitySold: number };

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (value: string) => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const rawValue = (xml: string, tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml)?.[1]?.trim() ?? "";
const value = (xml: string, tag: string) => unesc(rawValue(xml, tag));
const blocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g"))].map((match) => match[1]);
const unitValue = (name: string) => /^(?:unit|유닛)(?:\s+\d+)?$/iu.test(name.trim());

async function trading(account: EbayAccount, call: string, body: string) {
  const config = getEbayConfig();
  const response = await fetch(`${config.hosts.api}/ws/api.dll`, { method: "POST", headers: { "content-type": "text/xml;charset=UTF-8", "X-EBAY-API-COMPATIBILITY-LEVEL": "1193", "X-EBAY-API-CALL-NAME": call, "X-EBAY-API-SITEID": "0", "X-EBAY-API-IAF-TOKEN": await getValidAccessToken(account) }, body });
  const xml = await response.text();
  const ack = value(xml, "Ack");
  if (!response.ok || ack === "Failure" || blocks(xml, "SeverityCode").some((item) => item.includes("Error"))) throw new Error(value(xml, "LongMessage") || `eBay ${call} 실패 (HTTP ${response.status})`);
  return xml;
}

async function getItem(account: EbayAccount, itemId: string) {
  const xml = await trading(account, "GetItem", `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${esc(itemId)}</ItemID><IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeWatchCount>false</IncludeWatchCount></GetItemRequest>`);
  const variations = blocks(rawValue(xml, "Variations"), "Variation").map((block) => ({ sku: value(block, "SKU"), price: value(block, "StartPrice"), quantity: value(block, "Quantity"), quantitySold: Number(value(block, "QuantitySold") || 0), specifics: blocks(rawValue(block, "VariationSpecifics"), "NameValueList").map((specific) => ({ name: value(specific, "Name"), value: value(specific, "Value") })) }));
  return { xml, variations, picturesXml: rawValue(xml, "Pictures") };
}

async function accountFor(userId: string) {
  const environment = getEbayConfig().environment === "production" ? "PRODUCTION" : "SANDBOX";
  const account = await prisma.ebayAccount.findFirst({ where: { userId, environment }, orderBy: { updatedAt: "desc" } });
  if (!account) throw new Error("eBay 계정이 연결되어 있지 않습니다.");
  return account;
}

async function desiredByItem(userId: string) {
  const latest = await prisma.ebayReportImport.findFirst({ where: { userId, completeSnapshot: true }, orderBy: { createdAt: "desc" }, select: { listings: { where: { status: "ACTIVE" }, select: { itemId: true } } } });
  const activeItemIds = latest?.listings.map((listing) => listing.itemId) ?? [];
  if (!activeItemIds.length) return new Map<string, Array<{ productId: string; sku: string; desiredName: string }>>();
  const states = await prisma.variationListingState.findMany({ where: { userId, ebayItemId: { in: activeItemIds } }, select: { ebayItemId: true, groupKey: true, includedProductIds: true } });
  const ids = [...new Set(states.flatMap((state) => Array.isArray(state.includedProductIds) ? state.includedProductIds.filter((id): id is string => typeof id === "string") : []))];
  const products = await withVariationListingMetadata(await prisma.product.findMany({ where: { id: { in: ids } } }));
  const byId = new Map(products.map((product) => [product.id, product]));
  const output = new Map<string, Array<{ productId: string; sku: string; desiredName: string }>>();
  for (const state of states) {
    if (!state.ebayItemId) continue;
    const members = (Array.isArray(state.includedProductIds) ? state.includedProductIds : []).flatMap((id) => typeof id === "string" && byId.has(id) ? [byId.get(id)!] : []);
    const group = buildVariationListingGroups(members).groups.find((candidate) => candidate.key === state.groupKey);
    if (!group) continue;
    const units = group.products.filter((product) => /^(?:unit|유닛)$/iu.test(String(product.optionName ?? "").trim()) && product.featuredMembers).map((product) => ({ productId: product.id, sku: product.sku, desiredName: product.variationName }));
    if (units.length) output.set(state.ebayItemId, units);
  }
  return output;
}

export async function scanEbayUnitOptionRepairs(userId: string) {
  const desired = await desiredByItem(userId); const account = await accountFor(userId); const repairs: UnitRepair[] = [];
  for (const [itemId, targets] of desired) {
    const current = await getItem(account, itemId);
    for (const target of targets) {
      const variation = current.variations.find((row) => row.sku === target.sku);
      const currentName = variation?.specifics.find((specific) => unitValue(specific.value))?.value;
      if (currentName && currentName !== target.desiredName) repairs.push({ itemId, sku: target.sku, currentName, desiredName: target.desiredName, productId: target.productId, quantitySold: variation?.quantitySold ?? 0 });
    }
  }
  return repairs;
}

export async function applyEbayUnitOptionRepairs(userId: string, requested: UnitRepair[]) {
  const account = await accountFor(userId); const grouped = new Map<string, UnitRepair[]>();
  for (const repair of requested) grouped.set(repair.itemId, [...(grouped.get(repair.itemId) ?? []), repair]);
  const results: Array<UnitRepair & { error?: string }> = [];
  for (const [itemId, repairs] of grouped) {
    try {
      const current = await getItem(account, itemId); const bySku = new Map(repairs.map((repair) => [repair.sku, repair]));
      const revisedSpecifics = current.variations.map((variation) => {
        const repair = bySku.get(variation.sku);
        return variation.specifics.map((specific) => ({ ...specific, value: repair && unitValue(specific.value) ? repair.desiredName : specific.value }));
      });
      const variationXml = current.variations.flatMap((variation) => {
        const repair = bySku.get(variation.sku); if (!repair) return [];
        if (!variation.price || !variation.quantity) throw new Error(`${variation.sku}: eBay 현재 가격 또는 수량을 확인하지 못했습니다.`);
        if (variation.quantitySold > 0) throw new Error(`${variation.sku}: 이미 ${variation.quantitySold}개 판매된 옵션은 eBay가 삭제를 허용하지 않아 자동으로 이름을 바꾸지 않았습니다.`);
        const oldSpecifics = variation.specifics.map((specific) => `<NameValueList><Name>${esc(specific.name)}</Name><Value>${esc(specific.value)}</Value></NameValueList>`).join("");
        const newSpecifics = variation.specifics.map((specific) => ({ ...specific, value: unitValue(specific.value) ? repair.desiredName : specific.value })).map((specific) => `<NameValueList><Name>${esc(specific.name)}</Name><Value>${esc(specific.value)}</Value></NameValueList>`).join("");
        return [`<Variation><Delete>true</Delete><SKU>${esc(variation.sku)}</SKU><StartPrice>${esc(variation.price)}</StartPrice><Quantity>${esc(variation.quantity)}</Quantity><VariationSpecifics>${oldSpecifics}</VariationSpecifics></Variation><Variation><SKU>${esc(variation.sku)}</SKU><StartPrice>${esc(variation.price)}</StartPrice><Quantity>${esc(variation.quantity)}</Quantity><VariationSpecifics>${newSpecifics}</VariationSpecifics></Variation>`];
      }).join("");
      if (!variationXml) throw new Error("eBay 현재 옵션에서 해당 SKU를 찾지 못했습니다.");
      const specificNames = [...new Set(revisedSpecifics.flat().map((specific) => specific.name))];
      const setXml = specificNames.map((name) => `<NameValueList><Name>${esc(name)}</Name>${[...new Set(revisedSpecifics.flat().filter((specific) => specific.name === name).map((specific) => specific.value))].map((item) => `<Value>${esc(item)}</Value>`).join("")}</NameValueList>`).join("");
      let picturesXml = current.picturesXml;
      for (const repair of repairs) picturesXml = picturesXml.replaceAll(`<VariationSpecificValue>${esc(repair.currentName)}</VariationSpecificValue>`, `<VariationSpecificValue>${esc(repair.desiredName)}</VariationSpecificValue>`);
      await trading(account, "ReviseFixedPriceItem", `<?xml version="1.0" encoding="utf-8"?><ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><Item><ItemID>${esc(itemId)}</ItemID><Variations>${variationXml}${picturesXml ? `<Pictures>${picturesXml}</Pictures>` : ""}<VariationSpecificsSet>${setXml}</VariationSpecificsSet></Variations></Item></ReviseFixedPriceItemRequest>`);
      const verified = await getItem(account, itemId);
      for (const repair of repairs) {
        const variation = verified.variations.find((row) => row.sku === repair.sku);
        if (!variation || !variation.specifics.some((specific) => specific.value === repair.desiredName) || variation.specifics.some((specific) => unitValue(specific.value))) throw new Error(`${repair.sku}: eBay 응답 후 다시 조회했지만 옵션명이 실제로 바뀌지 않았습니다.`);
      }
      results.push(...repairs);
    } catch (error) { results.push(...repairs.map((repair) => ({ ...repair, error: error instanceof Error ? error.message : "옵션명 수정 실패" }))); }
  }
  return results;
}
