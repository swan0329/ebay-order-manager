import type { EbayAccount } from '@/generated/prisma';
import { getValidAccessToken } from '@/lib/ebay';
import { getEbayConfig } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { XMLParser } from 'fast-xml-parser';

/**
 * 확인 결과를 믿고 다시 묻지 않는 기간.
 *
 * 이 설정은 사람이 eBay에서 직접 끄지 않는 한 바뀌지 않는다. 그런데 변동처리마다
 * 물어보다가 Trading API 일일 호출 한도를 넘겨(오류 518) 모든 수량 변경이 막혔다.
 * 한 번 켜진 것을 확인했으면 하루 동안은 그 사실을 믿는다.
 */
const CONFIRMATION_TRUST_MS = 24 * 60 * 60 * 1000;
/** eBay가 호출 한도 초과를 알리는 코드 */
const USAGE_LIMIT_ERROR_CODE = '518';

// A zero-quantity GTC listing must remain resumable instead of being ended.
// 변동처리는 항상 수량 0으로 제출하므로 이 설정이 꺼져 있으면 리스팅이 끝난다.
// 그래서 확인에 실패하면 건너뛰지 않고 멈춘다. 다만 왜 실패했는지는 말해 준다.

type EbayCallResult = {
  call: string;
  ok: boolean;
  httpStatus: number;
  ack: string;
  enabled: boolean | null;
  errors: Array<{ code: string; severity: string; message: string }>;
  /** 응답이 XML조차 아니었을 때 사람이 볼 수 있게 앞부분만 남긴다. */
  rawExcerpt: string | null;
};

function list(value: unknown) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseErrors(data: unknown) {
  if (!data || typeof data !== 'object') return [];
  return list((data as { Errors?: unknown }).Errors).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const message = String(row.LongMessage ?? row.ShortMessage ?? '').trim();
    return message
      ? [{
          code: String(row.ErrorCode ?? '').trim(),
          severity: String(row.SeverityCode ?? '').trim(),
          message,
        }]
      : [];
  });
}

/** eBay가 돌려준 내용을 그대로 담아 돌려준다. 던지지 않는다. */
async function callUserPreferences(
  account: EbayAccount,
  name: string,
  fields: string,
): Promise<EbayCallResult> {
  const token = await getValidAccessToken(account);
  const response = await fetch(new URL('/ws/api.dll', getEbayConfig().hosts.api), {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'text/xml', 'X-EBAY-API-CALL-NAME': name,
      'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '1423', 'X-EBAY-API-IAF-TOKEN': token },
    body: `<?xml version="1.0" encoding="UTF-8"?><${name}Request xmlns="urn:ebay:apis:eBLBaseComponents">${fields}</${name}Request>`,
  });
  const text = await response.text();
  let data: Record<string, unknown> | undefined;
  try {
    data = new XMLParser().parse(text)?.[`${name}Response`];
  } catch {
    data = undefined;
  }
  const ack = String(data?.Ack ?? '').trim();
  const preference = data?.OutOfStockControlPreference;
  return {
    call: name,
    ok: response.ok && ['Success', 'Warning'].includes(ack),
    httpStatus: response.status,
    ack: ack || '(응답에 Ack 없음)',
    enabled: typeof preference === 'boolean' ? preference : null,
    errors: parseErrors(data),
    rawExcerpt: data ? null : text.slice(0, 300),
  };
}

function describe(result: EbayCallResult) {
  const reasons = result.errors.map((error) =>
    `${error.message}${error.code ? ` (오류코드 ${error.code})` : ''}`,
  );
  if (!reasons.length && result.rawExcerpt) reasons.push(`eBay 응답을 해석하지 못했습니다: ${result.rawExcerpt}`);
  if (!reasons.length) reasons.push(`eBay 응답 Ack=${result.ack}`);
  return `${result.call} 실패 (HTTP ${result.httpStatus}) · ${reasons.join(' / ')}`;
}

/** 읽기만 한다. 진단 화면이 쓸 수 있도록 던지지 않고 결과를 돌려준다. */
export async function readEbayOutOfStockPreference(account: EbayAccount) {
  return callUserPreferences(
    account,
    'GetUserPreferences',
    '<ShowOutOfStockControlPreference>true</ShowOutOfStockControlPreference>',
  );
}

function hitUsageLimit(result: EbayCallResult) {
  return result.errors.some((error) => error.code === USAGE_LIMIT_ERROR_CODE);
}

async function rememberConfirmation(account: EbayAccount) {
  await prisma.ebayAccount.update({
    where: { id: account.id },
    data: { outOfStockControlAt: new Date() },
  });
}

export async function ensureEbayOutOfStockControl(account: EbayAccount) {
  const confirmedAt = account.outOfStockControlAt?.getTime() ?? 0;
  // 최근에 확인했으면 묻지 않는다. 호출 한도를 아껴야 수량 변경이 막히지 않는다.
  if (Date.now() - confirmedAt < CONFIRMATION_TRUST_MS) return;

  const current = await readEbayOutOfStockPreference(account);
  // 한도를 넘겨 물어보지 못했을 뿐이라면, 전에 켜진 것을 확인한 계정은 그대로 진행한다.
  // 확인을 못 한다는 이유로 판매 반영을 통째로 멈추는 편이 더 해롭다.
  if (!current.ok && hitUsageLimit(current) && confirmedAt > 0) return;
  if (!current.ok) {
    throw new Error(
      `eBay 판매 보류·재개 설정을 확인하지 못해 수량 변경을 중단했습니다. ${describe(current)}` +
      ' · eBay 판매자 설정에서 "품절 시 리스팅 유지(Out of Stock Control)"를 직접 켜면 바로 진행할 수 있습니다.',
    );
  }
  if (current.enabled === true) {
    await rememberConfirmation(account);
    return;
  }

  const applied = await callUserPreferences(
    account,
    'SetUserPreferences',
    '<OutOfStockControlPreference>true</OutOfStockControlPreference>',
  );
  if (!applied.ok) {
    throw new Error(
      `eBay 판매 보류·재개 설정을 켜지 못해 수량 변경을 중단했습니다. ${describe(applied)}` +
      ' · eBay 판매자 설정에서 "품절 시 리스팅 유지(Out of Stock Control)"를 직접 켜면 바로 진행할 수 있습니다.',
    );
  }
  const confirmed = await readEbayOutOfStockPreference(account);
  if (confirmed.enabled === true) {
    await rememberConfirmation(account);
    return;
  }
  {
    throw new Error(
      'eBay 판매 보류 설정이 적용되지 않았습니다. eBay 판매자 설정에서 "품절 시 리스팅 유지"를 직접 켠 뒤 다시 실행해 주세요.' +
      (confirmed.ok ? '' : ` ${describe(confirmed)}`),
    );
  }
}

/**
 * eBay가 허용한 호출 횟수와 지금까지 쓴 횟수를 읽는다. 518 오류가 났을 때 무엇이
 * 얼마나 남았는지 사람이 직접 보고 판단할 수 있어야 한다. 읽기만 한다.
 */
export async function readEbayApiAccessRules(account: EbayAccount) {
  const token = await getValidAccessToken(account);
  try {
    const response = await fetch(new URL('/ws/api.dll', getEbayConfig().hosts.api), {
      method: 'POST', signal: AbortSignal.timeout(25000),
      headers: { 'Content-Type': 'text/xml', 'X-EBAY-API-CALL-NAME': 'GetAPIAccessRules',
        'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '1423', 'X-EBAY-API-IAF-TOKEN': token },
      body: '<?xml version="1.0" encoding="UTF-8"?><GetAPIAccessRulesRequest xmlns="urn:ebay:apis:eBLBaseComponents"/>',
    });
    const data = new XMLParser().parse(await response.text())?.GetAPIAccessRulesResponse;
    const rules = list(data?.APIAccessRule).map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      return {
        callName: String(row.CallName ?? '전체'),
        dailyLimit: Number(row.DailyHardLimit ?? 0),
        dailyUsage: Number(row.DailyUsage ?? 0),
        hourlyLimit: Number(row.HourlyHardLimit ?? 0),
        hourlyUsage: Number(row.HourlyUsage ?? 0),
      };
    });
    return {
      ok: ['Success', 'Warning'].includes(String(data?.Ack ?? '')),
      // 한도에 가까운 것부터 보여 준다.
      rules: rules
        .filter((rule) => rule.dailyLimit > 0 || rule.dailyUsage > 0)
        .sort((a, b) => (b.dailyUsage / (b.dailyLimit || 1)) - (a.dailyUsage / (a.dailyLimit || 1)))
        .slice(0, 15),
    };
  } catch (error) {
    return { ok: false, rules: [], error: error instanceof Error ? error.message : '조회 실패' };
  }
}
