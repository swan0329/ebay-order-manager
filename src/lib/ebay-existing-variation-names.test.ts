import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/ebay',()=>({getValidAccessToken:async()=> 'test-token'}));
vi.mock('@/lib/env',()=>({getEbayConfig:()=>({hosts:{api:'https://api.ebay.com'}})}));
import {ensureLegacyListingSku,readExistingVariationNames} from './ebay-existing-variation-names';
afterEach(()=>vi.restoreAllMocks());
const item=(sku:string)=>new Response(`<GetItemResponse><Ack>Success</Ack><Item><ItemID>123456789012</ItemID><SKU>${sku}</SKU></Item></GetItemResponse>`);
describe('기존 eBay 연결 보존',()=>{
 it('비어 있는 SKU만 기록하고 재조회하며 가격·수량을 보내지 않는다',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(item('')).mockResolvedValueOnce(new Response('<ReviseItemResponse><Ack>Success</Ack></ReviseItemResponse>')).mockResolvedValueOnce(item('182232'));
  await ensureLegacyListingSku({} as never,'123456789012','182232');
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[1][1]?.body).toContain('<SKU>182232</SKU>');
  expect(fetcher.mock.calls[1][1]?.body).not.toMatch(/Quantity|Price|Picture/);
 });
 it('다른 SKU가 있으면 변경하지 않는다',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(item('999'));
  await expect(ensureLegacyListingSku({} as never,'123456789012','182232')).rejects.toThrow('달라');
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('단일 XML 옵션 노드와 쉼표 이름을 그대로 읽는다',async()=>{
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>123456789012</ItemID><Variations><Variation><SKU>276408</SKU><VariationSpecifics><NameValueList><Name>Card</Name><Value>CHANGBIN, LEE KNOW</Value></NameValueList></VariationSpecifics></Variation></Variations></Item></GetItemResponse>'));
  expect(await readExistingVariationNames({} as never,'123456789012')).toEqual(new Map([['276408','CHANGBIN, LEE KNOW']]));
 });
});
