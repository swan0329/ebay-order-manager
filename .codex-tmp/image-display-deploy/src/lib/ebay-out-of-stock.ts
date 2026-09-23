import type { EbayAccount } from '@/generated/prisma';
import { getValidAccessToken } from '@/lib/ebay';
import { getEbayConfig } from '@/lib/env';
import { XMLParser } from 'fast-xml-parser';

// A zero-quantity GTC listing must remain resumable instead of being ended.
export async function ensureEbayOutOfStockControl(account: EbayAccount) {
  const token = await getValidAccessToken(account);
  const call = async (name: string, fields: string) => {
    const response = await fetch(new URL('/ws/api.dll', getEbayConfig().hosts.api), {
      method: 'POST', signal: AbortSignal.timeout(25000),
      headers: { 'Content-Type': 'text/xml', 'X-EBAY-API-CALL-NAME': name,
        'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '1423', 'X-EBAY-API-IAF-TOKEN': token },
      body: `<?xml version="1.0" encoding="UTF-8"?><${name}Request xmlns="urn:ebay:apis:eBLBaseComponents">${fields}</${name}Request>`,
    });
    const data = new XMLParser().parse(await response.text())[`${name}Response`];
    if (!response.ok || !['Success', 'Warning'].includes(data?.Ack)) {
      throw new Error('eBay 판매 보류·재개 설정을 확인하지 못했습니다. 수량 변경을 중단했습니다.');
    }
    return data;
  };
  const read = () => call('GetUserPreferences', '<ShowOutOfStockControlPreference>true</ShowOutOfStockControlPreference>');
  if ((await read()).OutOfStockControlPreference === true) return;
  await call('SetUserPreferences', '<OutOfStockControlPreference>true</OutOfStockControlPreference>');
  if ((await read()).OutOfStockControlPreference !== true) throw new Error('eBay 판매 보류 설정이 적용되지 않았습니다.');
}
