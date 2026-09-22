import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/ebay', () => ({ getValidAccessToken: vi.fn().mockResolvedValue('test-token') }));
vi.mock('@/lib/env', () => ({ getEbayConfig: () => ({ hosts: { api: 'https://api.ebay.com' } }) }));
vi.mock('@/lib/prisma', () => ({ prisma: { ebayAccount: { update: vi.fn() } } }));
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

// 호출 한도를 넘겨(518) 설정을 읽지 못해도, 전에 켜진 것을 확인한 계정은 멈추지 않는다.
// 확인을 못 한다는 이유로 판매 반영을 통째로 멈추는 편이 더 해롭다.
it('최근에 확인했으면 eBay에 다시 묻지 않는다', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await ensureEbayOutOfStockControl({ id: 'a1', outOfStockControlAt: new Date() } as never);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('호출 한도를 넘겨도 전에 확인한 계정은 진행한다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(
    '<GetUserPreferencesResponse><Ack>Failure</Ack><Errors><ErrorCode>518</ErrorCode><LongMessage>usage limit</LongMessage></Errors></GetUserPreferencesResponse>',
  )));
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await expect(
    ensureEbayOutOfStockControl({ id: 'a1', outOfStockControlAt: old } as never),
  ).resolves.toBeUndefined();
});

it('한 번도 확인한 적 없으면 한도 초과라도 멈춘다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(
    '<GetUserPreferencesResponse><Ack>Failure</Ack><Errors><ErrorCode>518</ErrorCode><LongMessage>usage limit</LongMessage></Errors></GetUserPreferencesResponse>',
  )));
  await expect(
    ensureEbayOutOfStockControl({ id: 'a1', outOfStockControlAt: null } as never),
  ).rejects.toThrow(/518/);
});
