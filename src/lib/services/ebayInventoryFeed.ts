import "server-only";

import { decodeDownloadedEbayFile } from "@/lib/services/ebayActiveReportSync";
import { safeLog } from "@/lib/safe-log";
import { ebayApiRawRequest, ebayApiRequest, getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";

const FEED_TYPE = "LMS_REVISE_INVENTORY_STATUS";
const SCHEMA_VERSION = "1193";

export type EbayInventoryFeedTarget = {
  correlationId: string;
  itemId: string;
  sku: string | null;
  quantity: number;
  price: number | null;
};

export type EbayInventoryFeedResult = {
  correlationId: string;
  success: boolean;
  message: string;
};

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function xmlValue(xml: string, tag: string) {
  return new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, "i").exec(xml)?.[1]?.trim() ?? "";
}

export function buildEbayInventoryFeed(targets: EbayInventoryFeedTarget[]) {
  const requests = targets.map((target) => `<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel><Version>${SCHEMA_VERSION}</Version>
  <MessageID>${escapeXml(target.correlationId)}</MessageID>
  <InventoryStatus><ItemID>${escapeXml(target.itemId)}</ItemID>${target.sku ? `<SKU>${escapeXml(target.sku)}</SKU>` : ""}<Quantity>${Math.max(0, Math.trunc(target.quantity))}</Quantity>${target.price == null ? "" : `<StartPrice>${target.price.toFixed(2)}</StartPrice>`}</InventoryStatus>
</ReviseInventoryStatusRequest>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<BulkDataExchangeRequests xmlns="urn:ebay:apis:eBLBaseComponents">
  <Header><Version>${SCHEMA_VERSION}</Version><SiteID>0</SiteID></Header>
${requests}
</BulkDataExchangeRequests>`;
}

export function parseEbayInventoryFeedResult(input: Buffer): EbayInventoryFeedResult[] {
  const xml = decodeDownloadedEbayFile(input).content.toString("utf8");
  const blocks = [...xml.matchAll(/<(?:[\w-]+:)?ReviseInventoryStatusResponse\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?ReviseInventoryStatusResponse>/gi)].map((match) => match[1]);
  return blocks.map((block) => {
    const correlationId = xmlValue(block, "CorrelationID") || xmlValue(block, "MessageID");
    const ack = xmlValue(block, "Ack").toUpperCase();
    const errors = [...block.matchAll(/<(?:[\w-]+:)?LongMessage\b[^>]*>([^<]*)<\/(?:[\w-]+:)?LongMessage>/gi)].map((match) => match[1].trim()).filter(Boolean);
    return { correlationId, success: ack === "SUCCESS" || ack === "WARNING", message: errors.join(" / ") || (ack || "eBay 결과 없음") };
  }).filter((row) => row.correlationId);
}

export async function createEbayInventoryFeedTask(userId: string) {
  const account = await getActiveEbayInventoryAccount(userId);
  const marketplace = process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US";
  const created = await ebayApiRequest(account, {
    method: "POST",
    path: "/sell/feed/v1/task",
    headers: { "x-ebay-c-marketplace-id": marketplace },
    body: { schemaVersion: SCHEMA_VERSION, feedType: FEED_TYPE },
  });
  const taskId = created.headers.get("location")?.split("/").filter(Boolean).at(-1);
  if (!taskId) throw new Error("eBay가 가격·재고 대량작업 번호를 반환하지 않았습니다.");
  safeLog("info", "ebay.inventory_feed.created", { taskId });
  return taskId;
}

export async function uploadEbayInventoryFeedFile(userId: string, taskId: string, targets: EbayInventoryFeedTarget[]) {
  const account = await getActiveEbayInventoryAccount(userId);
  const marketplace = process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US";
  const xml = buildEbayInventoryFeed(targets);
  const form = new FormData();
  form.append("file", new Blob([xml], { type: "text/xml" }), `inventory-${taskId}.xml`);
  form.append("fileName", `inventory-${taskId}.xml`);
  form.append("name", "file");
  form.append("type", "form-data");
  await ebayApiRawRequest(account, {
    method: "POST",
    path: `/sell/feed/v1/task/${encodeURIComponent(taskId)}/upload_file`,
    headers: { "x-ebay-c-marketplace-id": marketplace },
    body: form,
  });
  safeLog("info", "ebay.inventory_feed.submitted", { taskId, requested: targets.length });
}

export async function getEbayInventoryFeedStatus(userId: string, taskId: string) {
  const account = await getActiveEbayInventoryAccount(userId);
  const response = await ebayApiRequest(account, { path: `/sell/feed/v1/task/${encodeURIComponent(taskId)}` });
  const body = response.body as Record<string, unknown>;
  const summary = body.uploadSummary && typeof body.uploadSummary === "object" ? body.uploadSummary as Record<string, unknown> : {};
  const result = { status: String(body.status ?? "UNKNOWN").toUpperCase(), successCount: Number(summary.successCount ?? 0), failureCount: Number(summary.failureCount ?? 0) };
  safeLog("info", "ebay.inventory_feed.status", { taskId, ...result });
  return result;
}

export async function downloadEbayInventoryFeedResult(userId: string, taskId: string) {
  const account = await getActiveEbayInventoryAccount(userId);
  const response = await ebayApiRawRequest(account, { path: `/sell/feed/v1/task/${encodeURIComponent(taskId)}/download_result_file` });
  const results = parseEbayInventoryFeedResult(Buffer.from(await response.arrayBuffer()));
  safeLog("info", "ebay.inventory_feed.results", { taskId, succeeded: results.filter((row) => row.success).length, failed: results.filter((row) => !row.success).length });
  return results;
}
