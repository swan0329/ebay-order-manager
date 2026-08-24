import "server-only";

import type { EbayAccount } from "@/generated/prisma";
import { getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";
import { safeLog } from "@/lib/safe-log";
import { getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";

const COMPATIBILITY_LEVEL = "1193";

function preferenceXml(showOnly: boolean) {
  return showOnly
    ? `<?xml version="1.0" encoding="utf-8"?><GetUserPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ShowOutOfStockControlPreference>true</ShowOutOfStockControlPreference></GetUserPreferencesRequest>`
    : `<?xml version="1.0" encoding="utf-8"?><SetUserPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><OutOfStockControlPreference>true</OutOfStockControlPreference></SetUserPreferencesRequest>`;
}

function xmlValue(xml: string, tag: string) {
  return new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, "i").exec(xml)?.[1]?.trim() ?? "";
}

export function parseOutOfStockControl(xml: string) {
  const ack = xmlValue(xml, "Ack").toUpperCase();
  const messages = [...xml.matchAll(/<(?:[\w-]+:)?LongMessage\b[^>]*>([^<]*)<\/(?:[\w-]+:)?LongMessage>/gi)].map((match) => match[1].trim()).filter(Boolean);
  if (ack === "FAILURE" || ack === "PARTIALFAILURE") throw new Error(messages.join(" / ") || "eBay 품절 유지 설정을 확인하지 못했습니다.");
  return xmlValue(xml, "OutOfStockControlPreference").toLowerCase() === "true";
}

async function tradingPreferenceRequest(account: EbayAccount, callName: "GetUserPreferences" | "SetUserPreferences") {
  const config = getEbayConfig();
  const token = await getValidAccessToken(account);
  const response = await fetch(`${config.hosts.api}/ws/api.dll`, {
    method: "POST",
    headers: {
      "content-type": "text/xml;charset=UTF-8",
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: preferenceXml(callName === "GetUserPreferences"),
    signal: AbortSignal.timeout(20_000),
  });
  const xml = await response.text();
  if (!response.ok) throw new Error(`eBay 품절 유지 설정 요청 실패 (HTTP ${response.status})`);
  return xml;
}

export async function getEbayOutOfStockControl(userId: string) {
  const account = await getActiveEbayInventoryAccount(userId);
  return parseOutOfStockControl(await tradingPreferenceRequest(account, "GetUserPreferences"));
}

export async function enableEbayOutOfStockControl(userId: string) {
  const account = await getActiveEbayInventoryAccount(userId);
  const xml = await tradingPreferenceRequest(account, "SetUserPreferences");
  const ack = xmlValue(xml, "Ack").toUpperCase();
  if (ack === "FAILURE" || ack === "PARTIALFAILURE") throw new Error(xmlValue(xml, "LongMessage") || "eBay 품절 유지 설정을 켜지 못했습니다.");
  const enabled = parseOutOfStockControl(await tradingPreferenceRequest(account, "GetUserPreferences"));
  if (!enabled) throw new Error("eBay 응답 후 품절 유지 설정이 켜진 것을 확인하지 못했습니다.");
  safeLog("info", "ebay.out_of_stock_control.enabled", { userId });
  return true;
}
