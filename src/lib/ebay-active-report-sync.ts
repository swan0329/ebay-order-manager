import "server-only";

import { XMLParser } from "fast-xml-parser";
import {
  type EbayActiveReportRow,
  importEbayActiveReport,
} from "@/lib/ebay-active-report";
import { prisma } from "@/lib/prisma";
import { ebayApiRawRequest } from "@/lib/services/ebayApiService";
import { decodeEbayFeedXml } from "@/lib/ebay-feed-file";
import {
  listEbayInventoryTasks,
  listEbayReportSyncUsers,
  requestEbayActiveReport,
} from "@/lib/ebay-active-report-task";

export { listEbayReportSyncUsers, requestEbayActiveReport };

type XmlNode = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function node(value: unknown): XmlNode {
  return value && typeof value === "object" ? value as XmlNode : {};
}

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const record = value as XmlNode;
    return scalar(record["#text"] ?? record.value);
  }
  const result = String(value).trim();
  return result || null;
}

function numeric(value: unknown): number | null {
  const text = scalar(value);
  if (!text) return null;
  const result = Number(text.replace(/,/g, ""));
  return Number.isFinite(result) ? result : null;
}

async function reportPredatesLatestCompletedFeed(userId: string, creationDate?: string) {
  const reportCreatedAt = Date.parse(creationDate ?? "");
  if (!Number.isFinite(reportCreatedAt)) return false;
  const latestCompletedFeed = await prisma.ebayFeedJob.findFirst({
    where: {
      userId,
      status: { in: ["COMPLETED", "COMPLETED_WITH_ERROR"] },
      completedAt: { not: null },
    },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
  return Boolean(
    latestCompletedFeed?.completedAt &&
    latestCompletedFeed.completedAt.getTime() > reportCreatedAt,
  );
}

export function parseEbayActiveInventoryArchive(buffer: Buffer): EbayActiveReportRow[] {
  const xml = decodeEbayFeedXml(buffer);
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
  }).parse(xml) as XmlNode;
  const root = node(parsed.BulkDataExchangeResponses ?? parsed);
  const report = node(root.ActiveInventoryReport);
  const details = asArray(report.SKUDetails);
  const rows: EbayActiveReportRow[] = [];

  for (const detailValue of details) {
    const detail = node(detailValue);
    const itemId = scalar(detail.ItemID);
    if (!itemId) continue;
    const variations = asArray(node(detail.Variations).Variation);
    const sourceRows = variations.length ? variations.map(node) : [detail];
    for (const source of sourceRows) {
      const priceNode = source.Price ?? detail.Price;
      const quantity = numeric(source.Quantity ?? detail.Quantity);
      rows.push({
        itemId,
        sku: scalar(source.SKU ?? detail.SKU),
        title: scalar(detail.Title),
        price: numeric(priceNode),
        quantity: quantity === null ? null : Math.max(0, Math.trunc(quantity)),
        currency: scalar(node(priceNode)["@currencyID"]),
        raw: {
          ItemID: itemId,
          SKU: scalar(source.SKU ?? detail.SKU) ?? "",
          Title: scalar(detail.Title) ?? "",
          Price: scalar(priceNode) ?? "",
          Quantity: scalar(source.Quantity ?? detail.Quantity) ?? "",
        },
      });
    }
  }

  if (!rows.length) {
    throw new Error("eBay 자동 보고서에서 활성상품 행을 찾지 못해 현황을 변경하지 않았습니다.");
  }
  return rows;
}

export async function syncEbayActiveReport(userId: string) {
  const { account, tasks } = await listEbayInventoryTasks(userId);
  const latestAutomaticImport = await prisma.ebayReportImport.findFirst({
    where: { userId, fileName: { startsWith: "ebay-feed-active-task-" } },
    orderBy: { createdAt: "desc" },
    select: { fileName: true, createdAt: true },
  });
  const latestImportedTaskId = latestAutomaticImport?.fileName.replace("ebay-feed-active-task-", "");
  const latestImportedTask = tasks.find((task) => task.taskId === latestImportedTaskId);
  // Import only the newest completed snapshot. Walking backward through older
  // unimported tasks reverts confirmed prices/quantities on every later poll.
  const task = tasks.filter((candidate) => String(candidate.status).toUpperCase() === "COMPLETED")
    .sort((a, b) => Date.parse(b.creationDate ?? "") - Date.parse(a.creationDate ?? ""))[0];
  const baselineTime = latestImportedTask?.creationDate
    ? Date.parse(latestImportedTask.creationDate)
    : latestAutomaticImport?.createdAt.getTime();
  const shouldImport = task && task.taskId !== latestImportedTaskId &&
    (baselineTime === undefined || Date.parse(task.creationDate ?? "") > baselineTime);
  if (shouldImport) {
    const fileName = `ebay-feed-active-task-${task.taskId}`;

    const file = await ebayApiRawRequest(account, {
      path: `/sell/feed/v1/task/${encodeURIComponent(task.taskId!)}/download_result_file`,
      responseType: "buffer",
    });
    const rows = parseEbayActiveInventoryArchive(file.body);
    const result = await importEbayActiveReport({
      userId,
      fileName,
      completeSnapshot: true,
      rows,
    });
    // A report task that was already pending when a Feed update completed can
    // contain the pre-update snapshot. In that case importing it must schedule
    // one more report created after the Feed completion; otherwise the stale
    // snapshot keeps every successfully changed listing in the pending count.
    const needsPostFeedVerification = await reportPredatesLatestCompletedFeed(
      userId,
      task.creationDate,
    );
    await requestEbayActiveReport(userId, needsPostFeedVerification);
    return { status: "IMPORTED" as const, taskId: task.taskId!, result };
  }

  // Also recover when the stale report was imported by an older deployment:
  // match the most recent automatic import back to its eBay task and compare
  // task creation time (not local import time) with the Feed completion.
  const needsPostFeedVerification = await reportPredatesLatestCompletedFeed(
    userId,
    latestImportedTask?.creationDate,
  );
  return requestEbayActiveReport(userId, needsPostFeedVerification);
}
