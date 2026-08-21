import "server-only";

import { gunzipSync, inflateRawSync } from "node:zlib";
import type { EbayActiveReportRow } from "@/lib/ebay-active-report";
import { importEbayActiveReport, parseEbayActiveReport } from "@/lib/ebay-active-report";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { prisma } from "@/lib/prisma";
import { safeLog } from "@/lib/safe-log";
import { getActiveEbayInventoryAccount, ebayApiRawRequest, ebayApiRequest } from "@/lib/services/ebayApiService";

const activeReportType = "LMS_ACTIVE_INVENTORY_REPORT";
const terminalFailureStatuses = new Set(["COMPLETED_WITH_ERROR", "FAILED", "CANCELED", "CANCELLED", "PARTIALLY_PROCESSED"]);

function valueOf(input: unknown, names: string[]) {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) {
    if (names.includes(key.replace(/[^a-z0-9]/gi, "").toLowerCase()) && value !== null && value !== undefined) return String(value).trim() || null;
  }
  return null;
}

function numberOf(input: unknown, names: string[]) {
  const raw = valueOf(input, names);
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function collectObjects(input: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(input)) for (const value of input) collectObjects(value, output);
  else if (input && typeof input === "object") {
    const object = input as Record<string, unknown>;
    if (valueOf(object, ["itemid", "itemnumber", "listingid"])) output.push(object);
    for (const value of Object.values(object)) collectObjects(value, output);
  }
  return output;
}

function xmlRecords(text: string) {
  const records: Record<string, string>[] = [];
  // LMS ActiveInventoryReport uses SKUDetails (not Item).  Namespace prefixes
  // are optional, so only compare the local element name here.
  for (const match of text.matchAll(/<(?:[\w-]+:)?(?:SKUDetails|Item|ItemArray|ItemDetails|ActiveInventoryReportItem)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?(?:SKUDetails|Item|ItemArray|ItemDetails|ActiveInventoryReportItem)>/gi)) {
    const row: Record<string, string> = {};
    // A multi-variation listing has nested Variation elements.  This report
    // import stores the active parent Item ID; nested values must not overwrite
    // its parent SKU/price/quantity snapshot.
    const topLevel = match[1].replace(/<(?:[\w-]+:)?Variations\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?Variations>/gi, "");
    for (const cell of topLevel.matchAll(/<([A-Za-z][\w:-]*)\b([^>]*)>([^<]*)<\/\1>/g)) {
      row[cell[1].split(":").at(-1) ?? cell[1]] = cell[3].trim();
      if (/^price$/i.test(cell[1])) {
        const currency = /\bcurrencyID=["']([^"']+)["']/i.exec(cell[2])?.[1];
        if (currency) row.currency = currency;
      }
    }
    if (valueOf(row, ["itemid", "itemnumber", "listingid"])) records.push(row);
  }
  return records;
}

type ZipEntry = { name: string; content: Buffer };

function readZipEntries(input: Buffer): ZipEntry[] {
  // Feed API reports are ZIP archives.  Do not rely on a transitive ZIP
  // dependency: Vercel production pruning could remove it.  The central
  // directory gives us the exact size even when the local header has a data
  // descriptor, and LMS reports use the standard STORE/DEFLATE methods.
  const eocd = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const end = input.lastIndexOf(eocd);
  if (end < 0 || end + 22 > input.length) throw new Error("eBay ZIP 보고서의 중앙 디렉터리를 찾지 못했습니다.");
  const total = input.readUInt16LE(end + 10);
  let offset = input.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < total; index += 1) {
    if (offset + 46 > input.length || input.readUInt32LE(offset) !== 0x02014b50) throw new Error("eBay ZIP 보고서의 항목 정보가 올바르지 않습니다.");
    const method = input.readUInt16LE(offset + 10);
    const compressedSize = input.readUInt32LE(offset + 20);
    const uncompressedSize = input.readUInt32LE(offset + 24);
    const nameLength = input.readUInt16LE(offset + 28);
    const extraLength = input.readUInt16LE(offset + 30);
    const commentLength = input.readUInt16LE(offset + 32);
    const localOffset = input.readUInt32LE(offset + 42);
    const name = input.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (uncompressedSize > 50 * 1024 * 1024) throw new Error("eBay 보고서 파일이 허용 크기를 초과했습니다.");
    if (localOffset + 30 > input.length || input.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("eBay ZIP 보고서의 파일 항목을 읽지 못했습니다.");
    const localNameLength = input.readUInt16LE(localOffset + 26);
    const localExtraLength = input.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = input.subarray(start, start + compressedSize);
    if (compressed.length !== compressedSize) throw new Error("eBay ZIP 보고서 파일이 불완전합니다.");
    const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!content) throw new Error("eBay ZIP 보고서의 지원하지 않는 압축 방식입니다.");
    if (content.length !== uncompressedSize) throw new Error("eBay ZIP 보고서의 압축 해제 크기가 올바르지 않습니다.");
    entries.push({ name, content });
  }
  return entries;
}

function decodeDownloadedReport(input: Buffer) {
  const gzip = input.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]));
  const decoded = gzip ? gunzipSync(input) : input;
  const zip = decoded.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (!zip) return { content: decoded, format: gzip ? "GZIP" : "원본 파일" };
  const entries = readZipEntries(decoded);
  // XLSX itself is a ZIP.  Leave it intact for SheetJS rather than extracting
  // its workbook XML as though it were an LMS report.
  if (entries.some((entry) => entry.name === "[Content_Types].xml")) return { content: decoded, format: "XLSX" };
  const report = entries.find((entry) => /\.(xml|csv|txt|json)$/i.test(entry.name)) ?? entries[0];
  if (!report) throw new Error("eBay ZIP 보고서에 읽을 수 있는 파일이 없습니다.");
  return { content: report.content, format: `ZIP/${report.name.split(".").at(-1)?.toUpperCase() ?? "파일"}` };
}

/** Accepts CSV/XLSX, JSON and the XML flavour of eBay's downloadable report. */
export function parseDownloadedActiveReport(input: Buffer): EbayActiveReportRow[] {
  const decoded = decodeDownloadedReport(input);
  try { return parseEbayActiveReport(decoded.content); } catch { /* Feed can be JSON or XML. */ }
  const text = decoded.content.toString("utf8").replace(/^\uFEFF/, "").trim();
  let records: Record<string, unknown>[] = [];
  try { records = collectObjects(JSON.parse(text)); } catch { records = xmlRecords(text); }
  const rows = records.map((raw) => {
    const itemId = valueOf(raw, ["itemid", "itemnumber", "listingid"]);
    return itemId ? {
      itemId,
      sku: valueOf(raw, ["sku", "customlabelsku", "customlabel"]),
      title: valueOf(raw, ["title", "listingtitle"]),
      price: numberOf(raw, ["price", "currentprice", "startprice", "buyitnowprice"]),
      quantity: (() => { const value = numberOf(raw, ["availablequantity", "quantityavailable", "quantity", "available"]); return value === null ? null : Math.max(0, Math.trunc(value)); })(),
      currency: valueOf(raw, ["currency"]),
      raw: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, String(value ?? "")])),
    } : null;
  }).filter((row): row is EbayActiveReportRow => Boolean(row));
  const unique = [...new Map(rows.map((row) => [row.itemId, row])).values()];
  if (!unique.length) {
    const ebayError = /<(?:[\w-]+:)?(?:ShortMessage|LongMessage)\b[^>]*>([^<]+)/i.exec(text)?.[1]?.trim();
    throw new Error(ebayError
      ? `eBay가 활성상품 보고서 대신 오류를 반환했습니다: ${ebayError}`
      : `eBay 활성상품 결과에서 Item ID를 찾지 못했습니다 (${decoded.format}). 기존 목록은 변경하지 않았습니다.`);
  }
  return unique;
}

export async function requestEbayActiveReport(userId: string) {
  const existing = await prisma.ebayActiveReportSync.findFirst({
    where: { userId, status: { in: ["QUEUED", "IN_PROCESS"] } }, orderBy: { requestedAt: "desc" },
  });
  if (existing) {
    safeLog("info", "ebay.active_report.request.reused", { userId, status: existing.status, ebayTaskId: existing.ebayTaskId });
    return existing;
  }
  const account = await getActiveEbayInventoryAccount(userId);
  const result = await ebayApiRequest(account, {
    method: "POST", path: "/sell/feed/v1/inventory_task", contentLanguage: "en-US",
    headers: { "x-ebay-c-marketplace-id": process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US" },
    body: { schemaVersion: "1.0", feedType: activeReportType },
  });
  const location = result.headers.get("location");
  const ebayTaskId = location?.split("/").filter(Boolean).at(-1);
  if (!ebayTaskId) throw new Error("eBay가 활성상품 보고서 작업 번호를 반환하지 않았습니다.");
  const sync = await prisma.ebayActiveReportSync.create({ data: { userId, ebayTaskId, status: "QUEUED" } });
  safeLog("info", "ebay.active_report.request.created", { userId, ebayTaskId });
  return sync;
}

export async function refreshEbayActiveReportSync(userId: string) {
  const sync = await prisma.ebayActiveReportSync.findFirst({ where: { userId }, orderBy: { requestedAt: "desc" } });
  if (!sync || ["COMPLETED", "FAILED"].includes(sync.status)) return sync;
  const account = await getActiveEbayInventoryAccount(userId);
  const task = await ebayApiRequest(account, { path: `/sell/feed/v1/inventory_task/${encodeURIComponent(sync.ebayTaskId)}` });
  const payload = task.body as Record<string, unknown>;
  const status = String(payload.status ?? "IN_PROCESS").toUpperCase();
  if (terminalFailureStatuses.has(status)) {
    safeLog("warn", "ebay.active_report.failed", { userId, ebayTaskId: sync.ebayTaskId, ebayStatus: status });
    return prisma.ebayActiveReportSync.update({ where: { id: sync.id }, data: { status: "FAILED", errorMessage: `eBay 보고서 작업 상태: ${status}`, completedAt: new Date() } });
  }
  if (status !== "COMPLETED") {
    safeLog("info", "ebay.active_report.processing", { userId, ebayTaskId: sync.ebayTaskId, ebayStatus: status });
    return prisma.ebayActiveReportSync.update({ where: { id: sync.id }, data: { status: "IN_PROCESS" } });
  }
  try {
    const response = await ebayApiRawRequest(account, { path: `/sell/feed/v1/task/${encodeURIComponent(sync.ebayTaskId)}/download_result_file` });
    const rows = parseDownloadedActiveReport(Buffer.from(await response.arrayBuffer()));
    const imported = await importEbayActiveReport({ userId, fileName: `ebay-feed-active-${sync.ebayTaskId}`, completeSnapshot: true, rows });
    const completed = await prisma.ebayActiveReportSync.update({ where: { id: sync.id }, data: { status: "COMPLETED", reportImportId: imported.id, completedAt: new Date(), errorMessage: null } });
    safeLog("info", "ebay.active_report.completed", { userId, ebayTaskId: sync.ebayTaskId, reportImportId: imported.id, rowCount: imported.rowCount });
    return completed;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "보고서를 가져오지 못했습니다.";
    safeLog("warn", "ebay.active_report.download_failed", { userId, ebayTaskId: sync.ebayTaskId, errorMessage });
    return prisma.ebayActiveReportSync.update({ where: { id: sync.id }, data: { status: "FAILED", errorMessage, completedAt: new Date() } });
  }
}

export async function runEbayActiveReportSync(now = new Date()) {
  const accounts = await prisma.ebayAccount.findMany({ where: { environment: currentEbayEnvironment() }, distinct: ["userId"], select: { userId: true } });
  const results = [];
  for (const { userId } of accounts) {
    const current = await refreshEbayActiveReportSync(userId);
    if (!current || ["COMPLETED", "FAILED"].includes(current.status)) {
      const latest = await prisma.ebayActiveReportSync.findFirst({ where: { userId, status: "COMPLETED" }, orderBy: { completedAt: "desc" } });
      if (!latest?.completedAt || now.getTime() - latest.completedAt.getTime() >= 25 * 60 * 1000) results.push(await requestEbayActiveReport(userId));
      else results.push(latest);
    } else results.push(current);
  }
  return results;
}
