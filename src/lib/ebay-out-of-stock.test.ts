import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/ebay', () => ({ getValidAccessToken: vi.fn().mockResolvedValue('test-token') }));
vi.mock('@/lib/env', () => ({ getEbayConfig: () => ({ hosts: { api: 'https://api.ebay.com' } }) }));
import { ensureEbayOutOfStockControl, readEbayOutOfStockPreference } from './ebay-out-of-stock';
afterEach(() => vi.unstubAllGlobals());

const preference = (name: string, value: string) =>
  new Response(`<${name}Response><Ack>Success</Ack><OutOfStockControlPreference>${value}</OutOfStockControlPreference></${name}Response>`);

it('품절 유지가 이미 켜져 있으면 계정 설정을 다시 쓰지 않는다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(preference('GetUserPreferences', 'true'));
  vi.stubGlobal('fetch', fetchMock);
  await ensureEbayOutOfStockControl({} as never);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('수량 0으로 종료되지 않도록 설정 후 재조회까지 검증한다', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(preference('GetUserPreferences', 'false'))
    .mockResolvedValueOnce(preference('SetUserPreferences', 'true'))
    .mockResolvedValueOnce(preference('GetUserPreferences', 'true'));
  vi.stubGlobal('fetch', fetchMock);
  await ensureEbayOutOfStockControl({} as never);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

// 실패 메시지가 원인을 감추면 사람이 손쓸 수 없다. eBay가 말한 것을 그대로 옮긴다.
it('조회 실패 시 eBay가 준 오류 코드와 문구를 그대로 알려 준다', async () => {
  // 응답 본문은 한 번만 읽을 수 있다. 호출마다 새로 만들어야 두 번 검사할 수 있다.
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(
    '<GetUserPreferencesResponse><Ack>Failure</Ack><Errors><ErrorCode>21917053</ErrorCode><SeverityCode>Error</SeverityCode><ShortMessage>짧게</ShortMessage><LongMessage>토큰에 이 호출 권한이 없습니다.</LongMessage></Errors></GetUserPreferencesResponse>',
  )));
  await expect(ensureEbayOutOfStockControl({} as never)).rejects.toThrow(/21917053/);
  await expect(ensureEbayOutOfStockControl({} as never)).rejects.toThrow(/토큰에 이 호출 권한이 없습니다/);
});

it('설정 쓰기가 막히면 어느 호출이 막혔는지 밝힌다', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(preference('GetUserPreferences', 'false'))
    .mockResolvedValueOnce(new Response(
      '<SetUserPreferencesResponse><Ack>Failure</Ack><Errors><ErrorCode>931</ErrorCode><LongMessage>권한 없음</LongMessage></Errors></SetUserPreferencesResponse>',
    )));
  await expect(ensureEbayOutOfStockControl({} as never)).rejects.toThrow(/SetUserPreferences 실패/);
});

it('XML이 아닌 응답이면 받은 내용을 잘라서 보여 준다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response('<html>service unavailable</html>', { status: 503 }),
  ));
  await expect(ensureEbayOutOfStockControl({} as never)).rejects.toThrow(/HTTP 503/);
});

it('진단용 조회는 던지지 않고 결과를 돌려준다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(preference('GetUserPreferences', 'true')));
  const result = await readEbayOutOfStockPreference({} as never);
  expect(result).toMatchObject({ ok: true, enabled: true, ack: 'Success', errors: [] });
});
