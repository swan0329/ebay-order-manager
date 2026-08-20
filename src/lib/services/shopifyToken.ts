import "server-only";

import type { ShopifyConfig } from "@/lib/env";

// Dev Dashboard 앱은 토큰을 화면에 보여 주지 않고, 자격 증명으로 그때그때 발급받는다.
// 그렇게 받은 토큰은 24시간 뒤 만료되므로 고정 토큰을 환경변수에 넣어 두면 하루가
// 지난 뒤부터 모든 Shopify 호출이 실패한다. 여기서 발급과 갱신을 맡는다.

type CachedToken = { token: string; expiresAt: number };

const cache = new Map<string, CachedToken>();

// 만료 직전에 쓰다가 도중에 죽는 일이 없도록 조금 일찍 새로 받는다.
const RENEW_BEFORE_MS = 5 * 60 * 1000;

export function resetShopifyTokenCache() {
  cache.clear();
}

export async function getShopifyAccessToken(
  config: ShopifyConfig,
  now: () => number = Date.now,
): Promise<string> {
  // 고정 토큰을 넣어 둔 환경은 그대로 둔다. 예전 설정을 깨지 않기 위해서다.
  if (config.accessToken) return config.accessToken;

  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Shopify 접속 설정이 없습니다. SHOPIFY_ADMIN_ACCESS_TOKEN 또는 SHOPIFY_CLIENT_ID와 SHOPIFY_CLIENT_SECRET을 넣어 주세요.",
    );
  }

  const cached = cache.get(config.storeDomain);
  if (cached && cached.expiresAt - RENEW_BEFORE_MS > now()) {
    return cached.token;
  }

  const response = await fetch(`https://${config.storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    // 자격 증명 자체는 남기지 않는다. 실패 사유만 그대로 보여 준다.
    throw new Error(`Shopify 토큰 발급 실패(${response.status}): ${text.slice(0, 200)}`);
  }

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Shopify 토큰 응답을 읽지 못했습니다.");
  }
  if (!parsed.access_token) {
    throw new Error("Shopify 토큰 응답에 액세스 토큰이 없습니다.");
  }

  const lifetimeMs = Math.max(60, Number(parsed.expires_in) || 0) * 1000;
  cache.set(config.storeDomain, {
    token: parsed.access_token,
    expiresAt: now() + lifetimeMs,
  });
  return parsed.access_token;
}
