import "server-only";

import * as XLSX from "xlsx";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { resolveOrderItemProductMatch } from "@/lib/product-matching";

type Cell = string | number | boolean | Date | null | undefined;

export type EbayActiveReportRow = {
  itemId: string;
  sku: string | null;
  title: string | null;
  price: number | null;
  quantity: number | null;
  currency: string | null;
  raw: Record<string, string>;
};

const aliases = {
  itemId: ["itemid", "itemnumber", "listingid", "상품번호", "아이템id"],
  sku: ["customlabelsku", "customlabel", "sku", "판매자sku", "맞춤라벨sku"],
  title: ["title", "listingtitle", "상품명", "제목"],
  price: ["price", "currentprice", "startprice", "buyitnowprice", "가격"],
  quantity: [
    "availablequantity",
    "quantityavailable",
    "quantity",
    "available",
    "수량",
  ],
  currency: ["currency", "통화"],
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

function numberValue(value: Cell) {
  const normalized = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function columnIndex(headers: Cell[], names: readonly string[]) {
  const normalized = headers.map(key);
  return normalized.findIndex((header) => names.includes(header));
}

export function parseEbayActiveReport(buffer: Buffer): EbayActiveReportRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("eBay 보고서 시트를 찾을 수 없습니다.");

  const rows = XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });
  const headerIndex = rows
    .slice(0, 30)
    .findIndex((row) => columnIndex(row, aliases.itemId) >= 0);
  if (headerIndex < 0) {
    throw new Error(
      "Item ID 열을 찾을 수 없습니다. eBay 전체 활성상품 보고서인지 확인해 주세요.",
    );
  }

  const headers = rows[headerIndex];
  const indexes = {
    itemId: columnIndex(headers, aliases.itemId),
    sku: columnIndex(headers, aliases.sku),
    title: columnIndex(headers, aliases.title),
    price: columnIndex(headers, aliases.price),
    quantity: columnIndex(headers, aliases.quantity),
    currency: columnIndex(headers, aliases.currency),
  };
  const seenRows = new Set<string>();
  const parsed: EbayActiveReportRow[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const itemId = text(row[indexes.itemId]);
    const sku = indexes.sku >= 0 ? text(row[indexes.sku]) : null;
    const rowKey = `${itemId}\u0000${sku ?? ""}`;
    if (!itemId || seenRows.has(rowKey)) continue;
    seenRows.add(rowKey);

    const raw = Object.fromEntries(
      headers.map((header, index) => [String(header || `열${index + 1}`), String(row[index] ?? "")]),
    );
    parsed.push({
      itemId,
      sku,
      title: indexes.title >= 0 ? text(row[indexes.title]) : null,
      price: indexes.price >= 0 ? numberValue(row[indexes.price]) : null,
      quantity:
        indexes.quantity >= 0
          ? Math.max(0, Math.trunc(numberValue(row[indexes.quantity]) ?? 0))
          : null,
      currency: indexes.currency >= 0 ? text(row[indexes.currency]) : null,
      raw,
    });
  }

  if (!parsed.length) {
    throw new Error("활성상품 행을 찾을 수 없습니다.");
  }
  return parsed;
}

type ResolvableRow = { itemId: string; sku: string | null };
type MatchingProduct = { id: string; sku: string; ebayItemId: string | null };

// eBay 보고서의 SKU가 비어 있어도, 이 사이트가 업로드 성공 시 함께 남긴
// 등록 초안과 연결 원장이 같은 Item ID·SKU·상품을 가리키면 신뢰할 수 있다.
// Product.ebayItemId 하나만으로 복구하지 않으므로 과거 오연결(3646)은 되살아나지 않는다.
async function loadTrustedSiteUploadMatches(
  userId: string,
  rows: ResolvableRow[],
): Promise<Map<string, MatchingProduct>> {
  const itemIds = [...new Set(rows.map((row) => row.itemId).filter(Boolean))];
  if (!itemIds.length) return new Map();

  const [drafts, links] = await Promise.all([
    prisma.listingDraft.findMany({
      where: {
        userId,
        status: "uploaded",
        ebayItemId: { in: itemIds },
      },
      select: { ebayItemId: true, sku: true, sourceInventoryId: true },
    }),
    prisma.inventoryListingLink.findMany({
      where: { ebayItemId: { in: itemIds } },
      select: {
        inventoryId: true,
        sku: true,
        ebayItemId: true,
        inventory: { select: { id: true, sku: true, ebayItemId: true } },
      },
    }),
  ]);

  const draftsByItemId = new Map<string, typeof drafts>();
  for (const draft of drafts) {
    if (!draft.ebayItemId) continue;
    const current = draftsByItemId.get(draft.ebayItemId) ?? [];
    current.push(draft);
    draftsByItemId.set(draft.ebayItemId, current);
  }

  const productsByItemId = new Map<string, MatchingProduct[]>();
  for (const link of links) {
    if (!link.ebayItemId || link.sku !== link.inventory.sku) continue;
    const matchingDraft = (draftsByItemId.get(link.ebayItemId) ?? []).some(
      (draft) =>
        draft.sku === link.sku &&
        (!draft.sourceInventoryId || draft.sourceInventoryId === link.inventoryId),
    );
    if (!matchingDraft) continue;
    const current = productsByItemId.get(link.ebayItemId) ?? [];
    current.push(link.inventory);
    productsByItemId.set(link.ebayItemId, current);
  }

  const trusted = new Map<string, MatchingProduct>();
  for (const [itemId, products] of productsByItemId) {
    const unique = [...new Map(products.map((product) => [product.id, product])).values()];
    if (unique.length === 1) trusted.set(itemId, unique[0]!);
  }
  return trusted;
}

// 사람이 사진을 보고 확정한 연결도 다음 활성상품 보고서로 승계한다. 중간에 생성된
// 자동 보고서 행이 수동 확정 증거를 가리지 않게 하고, 현재 Product의 Item ID까지
// 같은 경우만 신뢰하므로 이후 사용자가 연결을 해제한 항목은 다시 살아나지 않는다.
async function loadLatestManualMatches(
  userId: string,
  rows: ResolvableRow[],
  excludeReportId?: string,
): Promise<Map<string, MatchingProduct>> {
  const itemIds = [...new Set(rows.map((row) => row.itemId).filter(Boolean))];
  if (!itemIds.length) return new Map();

  const history = await prisma.ebayActiveListing.findMany({
    where: {
      itemId: { in: itemIds },
      matchStatus: "MANUALLY_VERIFIED",
      productId: { not: null },
      reportImport: {
        userId,
        ...(excludeReportId ? { id: { not: excludeReportId } } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      itemId: true,
      productId: true,
      matchStatus: true,
      product: { select: { id: true, sku: true, ebayItemId: true } },
    },
  });

  const latestByItemId = new Map<string, (typeof history)[number]>();
  for (const entry of history) {
    if (!latestByItemId.has(entry.itemId)) latestByItemId.set(entry.itemId, entry);
  }

  const trusted = new Map<string, MatchingProduct>();
  for (const [itemId, entry] of latestByItemId) {
    if (
      entry.productId &&
      entry.product &&
      entry.product.ebayItemId === itemId
    ) {
      trusted.set(itemId, entry.product);
    }
  }
  return trusted;
}

function mergeTrustedMatches(
  ...sources: Array<Map<string, MatchingProduct>>
): Map<string, MatchingProduct> {
  const candidates = new Map<string, MatchingProduct[]>();
  for (const source of sources) {
    for (const [itemId, product] of source) {
      const current = candidates.get(itemId) ?? [];
      current.push(product);
      candidates.set(itemId, current);
    }
  }

  const merged = new Map<string, MatchingProduct>();
  for (const [itemId, products] of candidates) {
    const unique = [...new Map(products.map((product) => [product.id, product])).values()];
    if (unique.length === 1) merged.set(itemId, unique[0]!);
  }
  return merged;
}

async function loadMatchingProducts(
  rows: ResolvableRow[],
): Promise<MatchingProduct[]> {
  const skus = [...new Set(rows.map((row) => row.sku).filter((sku): sku is string => Boolean(sku)))];
  // Item ID는 과거에 잘못 저장된 값도 그대로 다시 정답처럼 보이게 만든다.
  // 활성상품 보고서의 자동 연결 근거는 eBay Custom label(SKU) 완전일치만 쓴다.
  if (!skus.length) return [];
  return prisma.product.findMany({
    where: {
      sku: { in: skus },
    },
    select: { id: true, sku: true, ebayItemId: true },
  });
}

export function resolveActiveListingMatches<T extends ResolvableRow>(
  rows: T[],
  products: MatchingProduct[],
  trustedSiteUploads: Map<string, MatchingProduct> = new Map(),
) {
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const skuCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.sku) skuCounts.set(row.sku, (skuCounts.get(row.sku) ?? 0) + 1);
  }

  return rows.map((row) => {
    // 옵션 상품은 여러 SKU가 하나의 Item ID를 공유하므로 SKU 완전일치가 먼저다.
    const skuProduct = row.sku ? productBySku.get(row.sku) ?? null : null;
    if (row.sku && skuProduct) {
      if ((skuCounts.get(row.sku) ?? 0) > 1) {
        return { row, product: null as MatchingProduct | null, matchStatus: "DUPLICATE" };
      }
      if (skuProduct.ebayItemId && skuProduct.ebayItemId !== row.itemId) {
        return { row, product: null as MatchingProduct | null, matchStatus: "CONFLICT" };
      }
      return { row, product: skuProduct as MatchingProduct | null, matchStatus: "MATCHED" };
    }

    // 보고서 SKU가 비어 있는 단품만 사이트 업로드 원장으로 복구한다. 보고서에
    // 다른 SKU가 명시돼 있으면 충돌 가능성이 있으므로 사람이 확인하게 남긴다.
    const trustedUpload = !row.sku ? trustedSiteUploads.get(row.itemId) ?? null : null;
    if (trustedUpload) {
      return { row, product: trustedUpload, matchStatus: "MATCHED" };
    }

    return {
      row,
      product: null as MatchingProduct | null,
      matchStatus: "UNMATCHED",
    };
  });
}

// 과거 데이터에는 등록 작업 이력 없이 ebay_item_id만 저장된 경우가 있다. 이 값은
// 실제 다른 카드의 Item ID여도 이후 보고서 동기화에서 계속 되살아날 수 있으므로,
// 현재 보고서의 SKU 완전일치·새 화면에서 이미지 확인된 수동 연결 중 하나가 없는
// 활성 연결은 외부 변경 대상에서 즉시 제외한다. eBay에는 어떤 요청도 보내지 않는다.
export async function quarantineUnverifiedEbayLinks(userId: string) {
  const variationStates = await prisma.variationListingState.findMany({
    where: { userId, ebayItemId: { not: null } },
    select: { includedProductIds: true, pendingProductIds: true },
  });
  const variationProductIds = new Set<string>();
  for (const state of variationStates) {
    for (const value of [state.includedProductIds, state.pendingProductIds]) {
      if (!Array.isArray(value)) continue;
      for (const id of value) if (typeof id === "string") variationProductIds.add(id);
    }
  }
  // 옵션 묶음 구성원은 부모 eBay Item ID를 공유하는 정상 연결이다. 이전 점검에서
  // REVIEW_REQUIRED로 잘못 분류된 행을 먼저 복구한다.
  if (variationProductIds.size) {
    await prisma.product.updateMany({
      where: { id: { in: [...variationProductIds] }, listingStatus: "REVIEW_REQUIRED" },
      data: { listingStatus: "ACTIVE" },
    });
  }
  const activeProducts = await prisma.product.findMany({
    where: {
      ebayItemId: { not: null },
      listingStatus: { in: ["ACTIVE", "PUBLISHED", "LISTED"] },
    },
    select: { id: true, sku: true, ebayItemId: true },
  });
  if (!activeProducts.length) return { scanned: 0, quarantined: 0, trusted: 0 };

  const latestReport = await prisma.ebayReportImport.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const reportRows = latestReport
    ? await prisma.ebayActiveListing.findMany({
        where: { importId: latestReport.id },
        select: { itemId: true, sku: true },
      })
    : [];
  const exactListingSkus = new Set(reportRows.filter((row) => row.sku).map((row) => `${row.itemId}\u0000${row.sku}`));
  // 과거 linkedAt/MATCHED 및 offer ID는 오연결이 생기던 시기의 값일 수 있다.
  // 새 검토 화면에서 이미지 대조 후 확정한 MANUALLY_VERIFIED만 사람 확인의
  // 증거로 인정한다.
  const manuallyVerifiedProductIds = new Set(
    (
      await prisma.ebayActiveListing.findMany({
        where: {
          productId: { in: activeProducts.map((product) => product.id) },
          matchStatus: "MANUALLY_VERIFIED",
          reportImport: { userId },
        },
        select: { productId: true },
      })
    ).map((row) => row.productId),
  );
  const unverifiedIds = activeProducts
    .filter((product) => {
      if (variationProductIds.has(product.id)) return false;
      const exactSkuInLatestReport = exactListingSkus.has(`${product.ebayItemId}\u0000${product.sku}`);
      return !manuallyVerifiedProductIds.has(product.id) && !exactSkuInLatestReport;
    })
    .map((product) => product.id);

  if (unverifiedIds.length) {
    await prisma.product.updateMany({
      where: { id: { in: unverifiedIds } },
      data: { listingStatus: "REVIEW_REQUIRED" },
    });
  }
  return {
    scanned: activeProducts.length,
    quarantined: unverifiedIds.length,
    trusted: activeProducts.length - unverifiedIds.length,
  };
}

async function applyMatchedProductUpdates(
  tx: Prisma.TransactionClient,
  updates: Array<{
    productId: string;
    itemId: string;
    price?: number | Prisma.Decimal | null;
    quantity?: number | null;
  }>,
) {
  // 계산 판매가는 건드리지 않고 eBay가 실제로 보고한 기준값만 갱신한다.
  for (let index = 0; index < updates.length; index += 500) {
    const chunk = updates.slice(index, index + 500);
    await tx.$executeRaw`
      UPDATE "products" AS p
      SET
        "ebay_item_id" = v."item_id",
        "listing_status" = CASE WHEN v."quantity" = 0 THEN 'OUT_OF_STOCK' ELSE 'ACTIVE' END,
        "ebay_last_synced_price" = COALESCE(v."price", p."ebay_last_synced_price"),
        "ebay_last_synced_quantity" = COALESCE(v."quantity", p."ebay_last_synced_quantity"),
        "updated_at" = CURRENT_TIMESTAMP
      FROM (
        VALUES ${Prisma.join(
          chunk.map(
            (update) => Prisma.sql`(
              ${update.productId}::text,
              ${update.itemId}::text,
              ${update.price ?? null}::numeric,
              ${update.quantity ?? null}::integer
            )`,
          ),
        )}
      ) AS v("product_id", "item_id", "price", "quantity")
      WHERE p."id" = v."product_id"
    `;
  }
}

export async function importEbayActiveReport(input: {
  userId: string;
  fileName: string;
  completeSnapshot: boolean;
  rows: EbayActiveReportRow[];
}) {
  const [products, trustedSiteUploads, trustedManualMatches] = await Promise.all([
    loadMatchingProducts(input.rows),
    loadTrustedSiteUploadMatches(input.userId, input.rows),
    loadLatestManualMatches(input.userId, input.rows),
  ]);
  const resolved = resolveActiveListingMatches(
    input.rows,
    products,
    mergeTrustedMatches(trustedSiteUploads, trustedManualMatches),
  );
  const matched = resolved.filter((item) => item.product);
  const importedItemIds = input.rows.map((row) => row.itemId);

  return prisma.$transaction(async (tx) => {
    let endedCount = 0;
    if (input.completeSnapshot) {
      const ended = await tx.product.updateMany({
        where: {
          ebayItemId: { not: null, notIn: importedItemIds },
          OR: [
            { listingStatus: null },
            { listingStatus: { in: ["ACTIVE", "PUBLISHED", "LISTED"] } },
          ],
        },
        data: { listingStatus: "ENDED" },
      });
      endedCount = ended.count;
    }

    const report = await tx.ebayReportImport.create({
      data: {
        userId: input.userId,
        fileName: input.fileName,
        completeSnapshot: input.completeSnapshot,
        rowCount: input.rows.length,
        matchedCount: matched.length,
        unmatchedCount: resolved.filter((item) => item.matchStatus === "UNMATCHED").length,
        duplicateCount: resolved.filter((item) =>
          ["DUPLICATE", "CONFLICT"].includes(item.matchStatus),
        ).length,
        endedCount,
      },
    });

    await tx.ebayActiveListing.createMany({
      data: resolved.map(({ row, product, matchStatus }) => ({
        importId: report.id,
        productId: product?.id ?? null,
        itemId: row.itemId,
        sku: row.sku,
        title: row.title,
        price: row.price,
        quantity: row.quantity,
        currency: row.currency,
        status: "ACTIVE",
        matchStatus,
        rawJson: row.raw,
      })),
    });

    await applyMatchedProductUpdates(
      tx,
      matched.map(({ row, product }) => ({
        productId: product!.id,
        itemId: row.itemId,
        price: row.price,
        quantity: row.quantity,
      })),
    );

    const variationStates = await tx.variationListingState.findMany({
      where: { userId: input.userId, lastExportedAt: { not: null } },
    });
    for (const state of variationStates) {
      const listing = input.rows.find((row) =>
        row.sku === state.parentSku ||
        (!row.sku && row.title?.trim() === state.title.trim()),
      );
      if (!listing || !state.lastExportedAt || state.lastExportedAt > report.createdAt) continue;
      const included = Array.isArray(state.includedProductIds) ? state.includedProductIds.filter((id): id is string => typeof id === "string") : [];
      const pending = Array.isArray(state.pendingProductIds) ? state.pendingProductIds.filter((id): id is string => typeof id === "string") : [];
      await tx.variationListingState.update({
        where: { id: state.id },
        data: {
          ebayItemId: listing.itemId,
          includedProductIds: [...new Set([...included, ...pending])],
          pendingProductIds: [],
          lastConfirmedAt: report.createdAt,
        },
      });
    }

    return {
      id: report.id,
      rowCount: report.rowCount,
      matchedCount: report.matchedCount,
      unmatchedCount: report.unmatchedCount,
      duplicateCount: report.duplicateCount,
      endedCount,
    };
  }, { maxWait: 10_000, timeout: 120_000 });
}

// 이미 가져온 최신 보고서를, 파일 재업로드 없이 현재 상품 데이터 기준으로 다시 연결한다.
// 판매 종료(ENDED) 판정은 원본 스냅샷 조건이 필요하므로 건드리지 않고, 연결만 갱신한다.
export async function rematchLatestEbayReport(userId: string) {
  const report = await prisma.ebayReportImport.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      listings: {
        select: {
          id: true,
          itemId: true,
          sku: true,
          title: true,
          productId: true,
          matchStatus: true,
          price: true,
          quantity: true,
        },
      },
    },
  });
  if (!report) return null;

  const [products, trustedSiteUploads, trustedManualMatches] = await Promise.all([
    loadMatchingProducts(report.listings),
    loadTrustedSiteUploadMatches(userId, report.listings),
    loadLatestManualMatches(userId, report.listings, report.id),
  ]);
  const resolved = resolveActiveListingMatches(
    report.listings,
    products,
    mergeTrustedMatches(trustedSiteUploads, trustedManualMatches),
  );

  // Item ID·SKU로 못 붙은 항목은 제목(그룹·멤버·앨범) 유사도로 보강한다.
  // 애매하거나 후보가 여럿이면 엔진이 자동 연결하지 않으므로 오연결 위험이 낮다.
  const leftovers = resolved.filter(
    (item) => !item.product && item.matchStatus === "UNMATCHED",
  );
  let titleLinked = 0;
  if (leftovers.length) {
    const candidates = await prisma.product.findMany({
      // eBay에 올렸다면 이미지가 준비돼 있으므로, 이미지 없는 상품은
      // 제목 매칭 후보에서 제외해 오연결과 애매성을 줄인다.
      where: {
        status: { not: "inactive" },
        OR: [
          { ebayImageUrls: { isEmpty: false } },
          { AND: [{ imageUrl: { not: null } }, { imageUrl: { not: "" } }] },
        ],
      },
      select: {
        id: true,
        sku: true,
        ebayItemId: true,
        productName: true,
        optionName: true,
        category: true,
        brand: true,
        memo: true,
      },
    });
    for (const entry of leftovers) {
      if (!entry.row.title) continue;
      const match = resolveOrderItemProductMatch(
        {
          id: entry.row.id,
          title: entry.row.title,
          sku: entry.row.sku,
          rawJson: null,
        },
        candidates,
      );
      if (match.product) {
        // 제목 유사도는 후보를 보여주는 용도일 뿐, Item ID를 상품에 쓰거나
        // productId를 자동 연결하면 안 된다. 사진이 다른 카드도 제목은 매우
        // 비슷할 수 있으므로 이 상태는 연결 대기 목록에서 사람이 선택한다.
        entry.matchStatus = "TITLE_MATCHED";
        titleLinked += 1;
      }
    }
  }

  // matched: 상품 업데이트 대상(완전일치 + 제목 매칭 모두 포함)
  const matched = resolved.filter((item) => item.product);
  // matchedCount: "연결" 집계는 확정 연결(완전일치)만. 제목 매칭은 titleLinked로 따로 센다.
  const matchedCount = resolved.filter((item) => item.matchStatus === "MATCHED").length;
  const unmatchedCount = resolved.filter((item) => item.matchStatus === "UNMATCHED").length;
  const duplicateCount = resolved.filter((item) =>
    ["DUPLICATE", "CONFLICT"].includes(item.matchStatus),
  ).length;
  let newlyLinked = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const { row, product, matchStatus } of resolved) {
        // 새 검토 화면에서 사람이 이미지까지 확인한 연결은 이후 보고서에 SKU가
        // 비어 있어도 자동 재매칭이 다시 미연결로 낮추지 않는다.
        if (row.matchStatus === "MANUALLY_VERIFIED" && row.productId) {
          continue;
        }
        const nextProductId = product?.id ?? null;
        if (row.matchStatus === matchStatus && row.productId === nextProductId) {
          continue;
        }
        if (nextProductId && row.productId !== nextProductId) newlyLinked += 1;
        await tx.ebayActiveListing.update({
          where: { id: row.id },
          data: { productId: nextProductId, matchStatus },
        });
      }

      await tx.ebayReportImport.update({
        where: { id: report.id },
        data: { matchedCount, unmatchedCount, duplicateCount },
      });

      await applyMatchedProductUpdates(
        tx,
        matched.map(({ row, product }) => ({
          productId: product!.id,
          itemId: row.itemId,
          price: row.price,
          quantity: row.quantity,
        })),
      );
    },
    { maxWait: 10_000, timeout: 120_000 },
  );

  return {
    id: report.id,
    rowCount: report.rowCount,
    matchedCount,
    unmatchedCount,
    duplicateCount,
    endedCount: report.endedCount,
    newlyLinked,
    titleLinked,
  };
}

export class EbayListingLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EbayListingLinkError";
  }
}

// 사람이 고른 활성상품 리스팅을 상품에 연결한다. 수동으로 올려 SKU가 맞지 않는
// 리스팅을 엑셀을 거치지 않고 화면에서 바로 연결하기 위한 경로다.
// 사람의 확정이므로 이후 자동 매칭이 덮어쓰지 않도록 MATCHED로 남긴다
// (docs/business-rules.md: 사람이 확정한 연결이 자동 결과보다 우선한다).
export async function linkEbayActiveListing(
  userId: string,
  input: {
    productId: string;
    itemId: string;
    // 상품에 이미 다른 상품번호가 붙어 있을 때, 그 연결을 풀고 이것으로 바꾼다.
    // 예전 연결이 낡았을 때 쓴다.
    replaceExisting?: boolean;
    // 기존 연결을 그대로 두고 이 리스팅도 같은 상품에 붙인다. 같은 카드를 eBay에
    // 두 건으로 올린 경우이며, 둘 다 그 상품이 맞다.
    // 상품이 지닐 수 있는 상품번호는 하나뿐이라 대표값은 먼저 붙은 것을 유지한다.
    allowMultiple?: boolean;
  },
) {
  const listing = await prisma.ebayActiveListing.findFirst({
    where: { itemId: input.itemId, reportImport: { userId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, itemId: true, productId: true },
  });
  if (!listing) {
    throw new EbayListingLinkError(
      "이 상품번호가 활성상품 보고서에 없습니다. 최신 보고서를 먼저 가져와 주세요.",
    );
  }
  if (listing.productId && listing.productId !== input.productId) {
    throw new EbayListingLinkError("이 리스팅은 이미 다른 상품에 연결되어 있습니다.");
  }

  const [product, otherClaim] = await Promise.all([
    prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true, ebayItemId: true },
    }),
    prisma.product.findFirst({
      where: { ebayItemId: input.itemId, id: { not: input.productId } },
      select: { id: true, sku: true },
    }),
  ]);
  if (!product) {
    throw new EbayListingLinkError("상품을 찾을 수 없습니다.");
  }
  const otherItemId =
    product.ebayItemId && product.ebayItemId !== input.itemId ? product.ebayItemId : null;
  if (otherItemId && !input.replaceExisting && !input.allowMultiple) {
    throw new EbayListingLinkError(
      `이 상품에는 이미 다른 상품번호(${otherItemId})가 연결되어 있습니다.`,
    );
  }
  // 바꾸기일 때만 예전 것을 풀고 대표 상품번호를 넘긴다. 함께 연결이면 그대로 둔다.
  const replacedItemId = input.replaceExisting ? otherItemId : null;
  const addedAlongside = Boolean(otherItemId && !input.replaceExisting);
  if (otherClaim) {
    throw new EbayListingLinkError(
      `이 상품번호는 이미 다른 상품(${otherClaim.sku})에 연결되어 있습니다.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // 바꾸는 경우, 이 상품을 가리키던 예전 리스팅을 먼저 놓아준다. 그러지 않으면
    // 리스팅 두 건이 같은 상품을 가리킨 채 남는다.
    if (replacedItemId) {
      await tx.ebayActiveListing.updateMany({
        where: { itemId: replacedItemId, productId: product.id },
        data: { productId: null, matchStatus: "UNMATCHED", linkedAt: null },
      });
    }

    await tx.ebayActiveListing.update({
      where: { id: listing.id },
      data: {
        productId: product.id,
        matchStatus: "MANUALLY_VERIFIED",
        linkedAt: new Date(),
      },
    });
    await tx.product.update({
      where: { id: product.id },
      // 함께 연결이면 대표 상품번호는 먼저 붙은 것을 그대로 둔다. 상품이 지닐 수
      // 있는 값은 하나뿐이라 덮어쓰면 예전 리스팅의 대표성이 사라진다.
      data: addedAlongside
        ? { listingStatus: "ACTIVE" }
        : { ebayItemId: listing.itemId, listingStatus: "ACTIVE" },
    });
  });

  return {
    productId: product.id,
    itemId: listing.itemId,
    replacedItemId,
    addedAlongside,
  };
}

// 잘못 연결된 활성상품 항목을 연결 해제한다. 제목 매칭으로 상품에 써넣은
// eBay Item ID도, 이 항목이 써넣은 값이 맞을 때만 함께 되돌린다.
export async function unlinkEbayActiveListing(userId: string, listingId: string) {
  const listing = await prisma.ebayActiveListing.findFirst({
    where: { id: listingId, reportImport: { userId } },
    select: { id: true, itemId: true, productId: true },
  });
  if (!listing) return null;

  await prisma.$transaction(async (tx) => {
    if (listing.productId) {
      await tx.product.updateMany({
        where: { id: listing.productId, ebayItemId: listing.itemId },
        data: { ebayItemId: null, listingStatus: null },
      });
    }
    await tx.ebayActiveListing.update({
      where: { id: listing.id },
      data: { productId: null, matchStatus: "UNMATCHED", linkedAt: null },
    });
  });

  return { id: listing.id };
}
