import "server-only";

import type { EbayAccount } from "@/generated/prisma";
import { getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig } from "@/lib/env";

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function endEbayListing(account: EbayAccount, itemId: string) {
  const config = getEbayConfig();
  const token = await getValidAccessToken(account);
  const response = await fetch(`${config.hosts.api}/ws/api.dll`, {
    method: "POST",
    headers: {
      "content-type": "text/xml;charset=UTF-8",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-CALL-NAME": "EndFixedPriceItem",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${escapeXml(itemId)}</ItemID><EndingReason>NotAvailable</EndingReason>
</EndFixedPriceItemRequest>`,
  });
  const xml = await response.text();
  const ack = /<Ack>([^<]+)<\/Ack>/.exec(xml)?.[1] ?? "Unknown";
  const errors = [...xml.matchAll(/<LongMessage>([^<]*)<\/LongMessage>/g)].map((match) => match[1]);
  if (!response.ok || ack === "Failure") {
    throw new Error(errors.join(" / ") || `eBay 리스팅 종료 실패 (HTTP ${response.status})`);
  }
  return { itemId, ack };
}
