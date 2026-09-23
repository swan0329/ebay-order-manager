export type EbayFeedOperation = "revise" | "end";
export type EbayFeedTarget = {
  productId: string;
  sku: string;
  productName: string;
  itemId: string;
  price?: string;
  quantity?: number;
  resultStatus?: "ACTIVE" | "OUT_OF_STOCK" | "ENDED";
  priceChanged?: boolean;
  quantityChanged?: boolean;
  verificationMissing?: boolean;
  useSku?: boolean;
  inventoryApplied?: boolean;
  inventoryError?: string;
};
export type EbayFeedFailure = { productId: string; sku: string; itemId: string; message: string };
export const ebayFeedSchemaVersion = "1355";

function xml(value: string | number) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`, "i"));
  return match ? decodeXml(match[1].trim()) : null;
}

export function buildEbayFeedXml(operation: EbayFeedOperation, targets: EbayFeedTarget[]) {
  const requests = targets.map((target) => {
    const messageId = `<MessageID>${xml(target.productId)}</MessageID>`;
    if (operation === "end") return `<EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel><Version>${ebayFeedSchemaVersion}</Version>${messageId}<ItemID>${xml(target.itemId)}</ItemID><EndingReason>NotAvailable</EndingReason></EndFixedPriceItemRequest>`;
    const price = target.price == null ? "" : `<StartPrice currencyID="USD">${xml(target.price)}</StartPrice>`;
    // A seller's internal SKU need not match an ItemID-managed single listing.
    // Only variations need SKU in addition to their shared parent ItemID.
    const sku = target.useSku === false ? "" : `<SKU>${xml(target.sku)}</SKU>`;
    return `<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel><Version>${ebayFeedSchemaVersion}</Version>${messageId}<InventoryStatus><ItemID>${xml(target.itemId)}</ItemID>${sku}${price}<Quantity>${xml(target.quantity ?? 0)}</Quantity></InventoryStatus></ReviseInventoryStatusRequest>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><BulkDataExchangeRequests>${requests.join("")}</BulkDataExchangeRequests>`;
}

export function parseEbayFeedResult(resultXml: string, targets: EbayFeedTarget[]) {
  const blocks = [...resultXml.matchAll(/<(?:[\w.-]+:)?(ReviseInventoryStatus|EndFixedPriceItem)Response\b[\s\S]*?<\/(?:[\w.-]+:)?\1Response>/gi)].map((match) => match[0]);
  const byProductId = new Map(targets.map((target) => [target.productId, target]));
  const succeeded = new Set<string>();
  const failuresByProduct = new Map<string, EbayFeedFailure>();
  const unmatchedErrors = new Set<string>();
  for (const block of blocks) {
    const itemId = tag(block, "ItemID") ?? "";
    const sku = tag(block, "SKU") ?? "";
    const correlationId = tag(block, "CorrelationID");
    // Failure responses can omit InventoryStatus entirely. MessageID is echoed
    // even then. Legacy results may only use an unambiguous listing identity;
    // a shared parent ItemID must never pick an arbitrary variation.
    const candidates = targets.filter((target) =>
      (itemId || sku) && (!itemId || target.itemId === itemId) && (!sku || target.sku === sku),
    );
    const target = correlationId
      ? byProductId.get(correlationId)
      : candidates.length === 1 ? candidates[0] : undefined;
    const ack = (tag(block, "Ack") ?? "").toUpperCase();
    const messages = [...block.matchAll(/<(?:[\w.-]+:)?(?:ShortMessage|LongMessage)>[\s\S]*?<\/(?:[\w.-]+:)?(?:ShortMessage|LongMessage)>/gi)].map((match) => match[0].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    const message = decodeXml(messages.join(" / ") || `eBay 처리 실패 (${ack || "응답 없음"})`);
    if (!target) {
      if (ack !== "SUCCESS" && ack !== "WARNING") unmatchedErrors.add(message);
      continue;
    }
    if (ack === "SUCCESS" || ack === "WARNING") {
      if (!failuresByProduct.has(target.productId)) succeeded.add(target.productId);
      continue;
    }
    succeeded.delete(target.productId);
    failuresByProduct.set(target.productId, { productId: target.productId, sku: target.sku, itemId: target.itemId, message });
  }
  return { succeeded, failures: [...failuresByProduct.values()], unmatchedErrors: [...unmatchedErrors], responseCount: blocks.length };
}
