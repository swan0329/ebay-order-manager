import { XMLParser } from "fast-xml-parser";
import type { EbayAccount } from "@/generated/prisma";
import { getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";

const list = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const xml = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
async function trading(account: EbayAccount, name: string, body: string) {
  const token = await getValidAccessToken(account);
  const response = await fetch(new URL('/ws/api.dll', getEbayConfig().hosts.api), {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'text/xml', 'X-EBAY-API-CALL-NAME': name, 'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '1423', 'X-EBAY-API-IAF-TOKEN': token },
    body: `<?xml version="1.0" encoding="UTF-8"?><${name}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${name}Request>`,
  });
  const data = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(await response.text())[`${name}Response`];
  if (!response.ok || !['Success','Warning'].includes(data?.Ack)) throw new Error(`eBay ${name}: ${list<{LongMessage?:string;ShortMessage?:string}>(data?.Errors).map(e=>e.LongMessage||e.ShortMessage).join('; ') || response.status}`);
  return data;
}
export async function ensureLegacyListingSku(account: EbayAccount, itemId: string, sku: string) {
  if (!/^\d+$/.test(itemId) || !sku.trim()) throw new Error("기존 eBay 상품 연결을 확인할 수 없습니다.");
  const read = async () => (await trading(account,'GetItem',`<ItemID>${itemId}</ItemID><DetailLevel>ReturnAll</DetailLevel>`)).Item;
  const item = await read();
  if (item?.ItemID !== itemId || item.Variations) throw new Error(`${sku}: 기존 단품 연결과 옵션 구성이 일치하지 않습니다.`);
  if (item.SKU === sku) return;
  if (item.SKU) throw new Error(`${sku}: 기존 eBay SKU(${item.SKU})가 달라 자동 변경을 중단했습니다.`);
  await trading(account,'ReviseItem',`<Item><ItemID>${itemId}</ItemID><SKU>${xml(sku)}</SKU></Item>`);
  if ((await read())?.SKU !== sku) throw new Error(`${sku}: 기존 상품 SKU 저장을 확인하지 못했습니다.`);
}
export async function readExistingVariationNames(account: EbayAccount, itemId: string) {
  if (!/^\d+$/.test(itemId)) throw new Error("eBay 묶음 상품번호를 확인할 수 없습니다.");
  const data = await trading(account,'GetItem',`<ItemID>${itemId}</ItemID><DetailLevel>ReturnAll</DetailLevel>`);
  if (data.Item?.ItemID !== itemId) throw new Error("기존 eBay 옵션 상품번호가 일치하지 않습니다.");
  const names = new Map<string,string>();
  for (const v of list<{SKU: string; VariationSpecifics?: {NameValueList?: {Name: string; Value: string} | Array<{Name: string; Value: string}>}}>(data.Item?.Variations?.Variation)) {
    const specs = list(v.VariationSpecifics?.NameValueList);
    if (!v.SKU || specs.length !== 1 || specs[0].Name !== 'Card' || typeof specs[0].Value !== 'string') throw new Error("기존 eBay 옵션 형식이 달라 자동 변경을 중단했습니다.");
    names.set(v.SKU,specs[0].Value);
  }
  return names;
}
