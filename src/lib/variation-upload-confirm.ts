import "server-only";

import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

// eBay에 옵션 추가 CSV를 올리면 eBay가 처리 결과 파일을 돌려준다. 그 파일에는
// 행마다 처리 결과와, 새로 만들어진 상품의 Item number가 들어 있다.
//
// 이 파일만 올리면 부모 옵션상품의 Item number를 확정할 수 있으므로, 수천 행짜리
// 전체 활성상품 보고서를 다시 받아올 필요가 없다. eBay API는 한 번도 호출하지
// 않는다(요청이 잦으면 판매 계정이 정지될 수 있어 파일로만 주고받는다).

export type EbayUploadResultRow = {
  action: string | null;
  itemId: string | null;
  sku: string | null;
  succeeded: boolean;
  message: string | null;
};

type Cell = string | number | boolean | Date | null | undefined;

const aliases = {
  action: ["action", "작업", "처리"],
  itemId: ["itemid", "itemnumber", "listingid", "상품번호", "아이템id"],
  sku: ["customlabelsku", "customlabel", "sku", "판매자sku", "맞춤라벨sku"],
  status: ["status", "result", "processingstatus", "상태", "결과"],
  error: [
    "errorcode",
    "errormessage",
    "error",
    "errorsandwarnings",
    "errorswarnings",
    "message",
    "오류",
    "오류메시지",
  ],
} as const;

function key(value: Cell) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "");
}

function text(value: Cell) {
  const result = String(value ?? "").trim();
  return result || null;
}

function columnIndex(headers: Cell[], names: readonly string[]) {
  const normalized = headers.map(key);
  return normalized.findIndex((header) => names.includes(header));
}

// 실패한 행은 Item number가 비어 있으므로, SKU 열만 있어도 제목 줄로 인정한다.
function headerRowIndex(rows: Cell[][]) {
  return rows
    .slice(0, 30)
    .findIndex(
      (row) => columnIndex(row, aliases.itemId) >= 0 || columnIndex(row, aliases.sku) >= 0,
    );
}

// 처리 결과 열의 표기는 eBay 도구마다 다르므로, 명확히 실패라고 적힌 경우에만
// 실패로 본다.
function succeededFrom(status: string | null, error: string | null) {
  const failedStatus = /fail|error|reject|invalid|실패|거부|오류/i;
  if (status && failedStatus.test(status)) return false;
  if (error && !/^(0|none|no error|성공)$/i.test(error)) return false;
  return true;
}

export function parseEbayUploadResult(buffer: Buffer): EbayUploadResultRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("결과 파일에서 시트를 찾을 수 없습니다.");

  const rows = XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });
  const headerIndex = headerRowIndex(rows);
  if (headerIndex < 0) {
    throw new Error(
      "Item number 또는 Custom label 열을 찾을 수 없습니다. eBay가 준 처리 결과 파일인지 확인해 주세요.",
    );
  }

  const headers = rows[headerIndex];
  const indexes = {
    action: columnIndex(headers, aliases.action),
    itemId: columnIndex(headers, aliases.itemId),
    sku: columnIndex(headers, aliases.sku),
    status: columnIndex(headers, aliases.status),
    error: columnIndex(headers, aliases.error),
  };

  const parsed: EbayUploadResultRow[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const itemId = indexes.itemId >= 0 ? text(row[indexes.itemId]) : null;
    const sku = indexes.sku >= 0 ? text(row[indexes.sku]) : null;
    if (!itemId && !sku) continue;

    const status = indexes.status >= 0 ? text(row[indexes.status]) : null;
    const error = indexes.error >= 0 ? text(row[indexes.error]) : null;
    parsed.push({
      action: indexes.action >= 0 ? text(row[indexes.action]) : null,
      itemId: itemId && /^\d+$/.test(itemId) ? itemId : null,
      sku,
      succeeded: succeededFrom(status, error),
      message: error ?? status,
    });
  }

  if (!parsed.length) {
    throw new Error("처리 결과 행을 찾을 수 없습니다.");
  }
  return parsed;
}

export type VariationUploadConfirmResult = {
  confirmedGroups: number;
  newParentListings: number;
  addedOptions: number;
  endedSingles: number;
  // 결과 파일에서 찾지 못한 묶음. eBay가 아직 처리 중이거나 다른 파일을 올린 것이다.
  pendingGroups: Array<{ title: string; parentSku: string }>;
  // 부모 상품번호가 확정됐는데 아직 활성 단품이 남은 묶음. 여기서 바로 종료 CSV를 받는다.
  endableGroupKeys: string[];
  // eBay가 실패라고 알려 준 행. 사람이 그대로 보고 고칠 수 있게 원문을 남긴다.
  failures: Array<{ sku: string | null; itemId: string | null; message: string | null }>;
};

function jsonIds(value: unknown) {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

const ACTIVE_LISTING_STATUSES = ["ACTIVE", "PUBLISHED", "LISTED"];

// eBay가 End 처리했다고 알려 준 상품번호만 판매 종료로 바꾼다. 우리가 무엇을
// 요청했는지가 아니라 eBay가 무엇을 처리했는지가 근거이므로, 실패한 종료를
// 종료됐다고 잘못 적을 일이 없다.
export function endedItemIdsFrom(rows: EbayUploadResultRow[]) {
  return [
    ...new Set(
      rows
        .filter((row) => row.succeeded && row.itemId && /end/i.test(row.action ?? ""))
        .map((row) => row.itemId as string),
    ),
  ];
}

async function markEndedListings(rows: EbayUploadResultRow[]) {
  const endedItemIds = endedItemIdsFrom(rows);
  if (!endedItemIds.length) return 0;

  const updated = await prisma.product.updateMany({
    where: {
      ebayItemId: { in: endedItemIds },
      OR: [{ listingStatus: null }, { listingStatus: { in: ACTIVE_LISTING_STATUSES } }],
    },
    data: { listingStatus: "ENDED" },
  });
  return updated.count;
}

// 부모 상품번호가 확정된 묶음 중 아직 활성 단품이 남은 것을 고른다. 신규 묶음은
// 등록 결과를 모르는 동안에는 단품을 끝내지 않으므로, 등록 성공이 확인된 지금이
// 남은 단품을 안전하게 끝낼 수 있는 시점이다.
async function endableGroupKeysFor(userId: string, groupKeys: string[]) {
  if (!groupKeys.length) return [];
  const states = await prisma.variationListingState.findMany({
    where: { userId, groupKey: { in: groupKeys }, ebayItemId: { not: null } },
    select: { groupKey: true, ebayItemId: true, includedProductIds: true },
  });

  const endable: string[] = [];
  for (const state of states) {
    const ids = jsonIds(state.includedProductIds);
    if (!ids.length) continue;
    const activeSingles = await prisma.product.count({
      where: {
        id: { in: ids },
        ebayItemId: { not: null, notIn: [state.ebayItemId as string] },
        listingStatus: { in: ACTIVE_LISTING_STATUSES },
      },
    });
    if (activeSingles > 0) endable.push(state.groupKey);
  }
  return endable;
}

// 처리 결과 파일로 옵션상품의 등록 결과를 확정한다. 전체 활성상품 보고서 가져오기와
// 달리 판매 종료를 전체 스냅샷으로 판정하지 않고, 이 파일에서 eBay가 실제로 처리한
// 행만 반영한다.
export async function confirmVariationUploadResult(
  userId: string,
  rows: EbayUploadResultRow[],
) {
  const states = await prisma.variationListingState.findMany({
    where: { userId, lastExportedAt: { not: null } },
  });

  const result: VariationUploadConfirmResult = {
    confirmedGroups: 0,
    newParentListings: 0,
    addedOptions: 0,
    endedSingles: await markEndedListings(rows),
    pendingGroups: [],
    endableGroupKeys: [],
    failures: rows
      .filter((row) => !row.succeeded)
      .slice(0, 50)
      .map((row) => ({ sku: row.sku, itemId: row.itemId, message: row.message })),
  };

  const confirmedKeys: string[] = [];
  for (const state of states) {
    const pending = jsonIds(state.pendingProductIds);
    if (!pending.length) continue;

    const parentRow = rows.find(
      (row) => row.succeeded && row.itemId && row.sku === state.parentSku,
    );
    if (!parentRow?.itemId) {
      result.pendingGroups.push({ title: state.title, parentSku: state.parentSku });
      continue;
    }

    await prisma.variationListingState.update({
      where: { id: state.id },
      data: {
        ebayItemId: parentRow.itemId,
        includedProductIds: [...new Set([...jsonIds(state.includedProductIds), ...pending])],
        pendingProductIds: [],
        lastConfirmedAt: new Date(),
      },
    });

    confirmedKeys.push(state.groupKey);
    result.confirmedGroups += 1;
    result.addedOptions += pending.length;
    if (!state.ebayItemId) result.newParentListings += 1;
  }

  result.endableGroupKeys = await endableGroupKeysFor(userId, confirmedKeys);
  return result;
}
