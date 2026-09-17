import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/ebay',()=>({getValidAccessToken:vi.fn().mockResolvedValue('test-token')}));
vi.mock('@/lib/env',()=>({getEbayConfig:()=>({hosts:{api:'https://api.ebay.com'}})}));
import {ensureEbayOutOfStockControl} from './ebay-out-of-stock';
afterEach(()=>vi.unstubAllGlobals());
it('품절 유지가 이미 켜져 있으면 계정 설정을 다시 쓰지 않는다',async()=>{
 const fetchMock=vi.fn().mockResolvedValue(new Response('<GetUserPreferencesResponse><Ack>Success</Ack><OutOfStockControlPreference>true</OutOfStockControlPreference></GetUserPreferencesResponse>'));
 vi.stubGlobal('fetch',fetchMock);await ensureEbayOutOfStockControl({} as never);expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('수량 0으로 종료되지 않도록 설정 후 재조회까지 검증한다',async()=>{
 const response=(name:string,value:string)=>new Response(`<${name}Response><Ack>Success</Ack><OutOfStockControlPreference>${value}</OutOfStockControlPreference></${name}Response>`);
 const fetchMock=vi.fn().mockResolvedValueOnce(response('GetUserPreferences','false')).mockResolvedValueOnce(response('SetUserPreferences','true')).mockResolvedValueOnce(response('GetUserPreferences','true'));
 vi.stubGlobal('fetch',fetchMock);await ensureEbayOutOfStockControl({} as never);expect(fetchMock).toHaveBeenCalledTimes(3);
});
