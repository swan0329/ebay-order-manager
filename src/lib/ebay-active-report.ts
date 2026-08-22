import "server-only";

import * as XLSX from "xlsx";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { isConfidentMarketCompTitle } from "@/lib/ebay-market-comps";
import { resolveOrderItemProductMatch } from "@/lib/product-matching";
import { variationEbayTitle } from "@/lib/variation-listing-groups";

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
  const seenItemIds = new Set<string>();
  const parsed: EbayActiveReportRow[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const itemId = text(row[indexes.itemId]);
    if (!itemId || seenItemIds.has(itemId)) continue;
    seenItemIds.add(itemId);

    const raw = Object.fromEntries(
      headers.map((header, index) => [String(header || `열${index + 1}`), String(row[index] ?? "")]),
    );
    parsed.push({
      itemId,
      sku: indexes.sku >= 0 ? text(row[indexes.sku]) : null,
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
type MatchingProduct = {
  id: string;
  sku: string;
  ebayItemId: string | null;
  productListings: Array<{ externalId: string }>;
};

function ebayItemIdOf(product: MatchingProduct) {
  return product.productListings[0]?.externalId ?? product.ebayItemId;
}

async function loadMatchingProducts(
  rows: ResolvableRow[],
): Promise<MatchingProduct[]> {
  const skus = [...new Set(rows.map((row) => row.sku).filter((sku): sku is string => Boolean(sku)))];
  const itemIds = [...new Set(rows.map((row) => row.itemId).filter(Boolean))];
  if (!skus.length && !itemIds.length) return [];
  return prisma.product.findMany({
    where: {
      OR: [
        ...(skus.length ? [{ sku: { in: skus } }] : []),
        ...(itemIds.length ? [{ ebayItemId: { in: itemIds } }] : []),
        ...(itemIds.length ? [{ productListings: { some: { channel: "EBAY", externalId: { in: itemIds } } } }] : []),
      ],
    },
    select: {
      id: true,
      sku: true,
      ebayItemId: true,
      productListings: { where: { channel: "EBAY" }, select: { externalId: true }, take: 1 },
    },
  });
}

function resolveActiveListingMatches<T extends ResolvableRow>(
  rows: T[],
  products: MatchingProduct[],
) {
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const productsByItemId = new Map<string, MatchingProduct[]>();
  for (const product of products) {
    const itemId = ebayItemIdOf(product);
    if (!itemId) continue;
    const list = productsByItemId.get(itemId) ?? [];
    list.push(product);
    productsByItemId.set(itemId, list);
  }
  const skuCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.sku) skuCounts.set(row.sku, (skuCounts.get(row.sku) ?? 0) + 1);
  }

  return rows.map((row) => {
    // 1) eBay Item ID로 우선 매칭한다. 이 프로그램에서 올린 상품은 등록 시
    //    ProductListing의 eBay Item ID가 가장 확실한 식별자다. 이전 상품 열은
    //    이관 전 데이터 호환용으로만 뒤에서 사용한다.
    const itemIdMatches = productsByItemId.get(row.itemId) ?? [];
    if (itemIdMatches.length === 1) {
      return { row, product: itemIdMatches[0] as MatchingProduct | null, matchStatus: "MATCHED" };
    }
    if (itemIdMatches.length > 1) {
      // 같은 Item ID가 여러 상품에 저장된 데이터 이상 → 사람 확인 필요
      return { row, product: null as MatchingProduct | null, matchStatus: "CONFLICT" };
    }

    // 2) Item ID로 연결되지 않으면 SKU(Custom Label) 완전일치로 매칭한다.
    const product = row.sku ? productBySku.get(row.sku) ?? null : null;
    let matchStatus = "MATCHED";
    if (!row.sku || !product) matchStatus = "UNMATCHED";
    else if ((skuCounts.get(row.sku) ?? 0) > 1) matchStatus = "DUPLICATE";
    else if (ebayItemIdOf(product) && ebayItemIdOf(product) !== row.itemId) {
      matchStatus = "CONFLICT";
    }
    return {
      row,
      product: (matchStatus === "MATCHED" ? product : null) as MatchingProduct | null,
      matchStatus,
    };
  });
}

async function applyMatchedProductUpdates(
  tx: Prisma.TransactionClient,
  updates: Array<{ productId: string; itemId: string; price: number | null; quantity: number | null }>,
) {
  if (!updates.length) return;
  const productIds = [...new Set(updates.map((update) => update.productId))];
  const existing = await tx.productListing.findMany({
    where: { productId: { in: productIds }, channel: "EBAY" },
    select: { productId: true },
  });
  const existingIds = new Set(existing.map((listing) => listing.productId));
  // 마이그레이션 이후 새로 수동 연결한 상품처럼 채널 행이 없는 예외도 보고서
  // 수집 시 한 번만 만들어 둔다. 기존 행의 메타데이터는 아래 UPDATE가 보존한다.
  const missing = updates.filter((update) => !existingIds.has(update.productId));
  if (missing.length) {
    await tx.productListing.createMany({
      data: missing.map((update) => ({
        productId: update.productId,
        channel: "EBAY",
        externalId: update.itemId,
        price: update.price,
        quantity: update.quantity,
        status: "ACTIVE",
        metadata: { source: "ebay_active_report" },
      })),
      skipDuplicates: true,
    });
  }
  // 가격(ebay_price)은 포카마켓가+마진 계산이 소유하므로 여기서 건드리지 않는다.
  // 연결 정보(Item ID)와 활성 상태만 갱신한다.
  for (let index = 0; index < updates.length; index += 500) {
    const chunk = updates.slice(index, index + 500);
    await tx.$executeRaw`
      UPDATE "products" AS p
      SET
        "ebay_item_id" = v."item_id",
        "listing_status" = 'ACTIVE',
        -- 활성상품 보고서의 SKU/Item ID가 정확히 일치한 경우에만, 내부의
        -- 미등록 상태를 활성 리스팅 상태로 자동 연결한다. 품절은 재고 상태라
        -- 덮어쓰지 않으며 명시적 판매중지도 되살리지 않는다.
        "status" = CASE WHEN LOWER(COALESCE(p."status", '')) = 'unlisted' THEN 'active' ELSE p."status" END,
        "updated_at" = CURRENT_TIMESTAMP
      FROM (
        VALUES ${Prisma.join(
          chunk.map(
            (update) => Prisma.sql`(${update.productId}, ${update.itemId})`,
          ),
        )}
      ) AS v("product_id", "item_id")
      WHERE p."id" = v."product_id"
    `;
    // 상품별 eBay 마지막 실제값도 같은 보고서에서 갱신한다. 마이그레이션으로
    // 이미 만들어진 ProductListing을 일괄 UPDATE하므로 수천 행 보고서도 요청
    // 시간 안에 처리하며, 개별 upsert로 인한 부분·지연 저장을 피한다.
    await tx.$executeRaw`
      UPDATE "product_listings" AS pl
      SET
        "external_id" = v."item_id",
        "price" = v."price",
        "quantity" = v."quantity",
        "status" = 'ACTIVE',
        "updated_at" = CURRENT_TIMESTAMP
      FROM (
        VALUES ${Prisma.join(
          chunk.map(
            (update) => Prisma.sql`(${update.productId}, ${update.itemId}, ${update.price}, ${update.quantity})`,
          ),
        )}
      ) AS v("product_id", "item_id", "price", "quantity")
      WHERE pl."product_id" = v."product_id" AND pl."channel" = 'EBAY'
    `;
  }
}

async function reconcileVariationListingStates(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    reportCreatedAt: Date;
    completeSnapshot: boolean;
    rows: Array<{ itemId: string; sku: string | null; title: string | null }>;
  },
) {
  const states = await tx.variationListingState.findMany({
    where: { userId: input.userId, lastExportedAt: { not: null } },
  });
  for (const state of states) {
    if (!state.lastExportedAt || state.lastExportedAt > input.reportCreatedAt) continue;
    const listing = input.rows.find((row) =>
      row.sku === state.parentSku ||
      (!row.sku && row.title?.trim() === variationEbayTitle(state.title)),
    );
    if (!listing) {
      if (!input.completeSnapshot || !state.ebayItemId) continue;
      await tx.variationListingState.update({
        where: { id: state.id },
        data: {
          ebayItemId: null,
          includedProductIds: [],
          pendingProductIds: [],
          lastConfirmedAt: input.reportCreatedAt,
        },
      });
      continue;
    }
    const included = Array.isArray(state.includedProductIds)
      ? state.includedProductIds.filter((id): id is string => typeof id === "string")
      : [];
    const pending = Array.isArray(state.pendingProductIds)
      ? state.pendingProductIds.filter((id): id is string => typeof id === "string")
      : [];
    await tx.variationListingState.update({
      where: { id: state.id },
      data: {
        ebayItemId: listing.itemId,
        includedProductIds: [...new Set([...included, ...pending])],
        pendingProductIds: [],
        lastConfirmedAt: input.reportCreatedAt,
      },
    });
  }
}

export async function importEbayActiveReport(input: {
  userId: string;
  fileName: string;
  completeSnapshot: boolean;
  rows: EbayActiveReportRow[];
}) {
  const products = await loadMatchingProducts(input.rows);
  const resolved = resolveActiveListingMatches(input.rows, products);
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
      await tx.productListing.updateMany({
        where: {
          channel: "EBAY",
          externalId: { notIn: importedItemIds },
          OR: [
            { status: null },
            { status: { in: ["ACTIVE", "PUBLISHED", "LISTED"] } },
          ],
        },
        data: { status: "ENDED" },
      });
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

    await reconcileVariationListingStates(tx, {
      userId: input.userId,
      reportCreatedAt: report.createdAt,
      completeSnapshot: input.completeSnapshot,
      rows: input.rows,
    });

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
          price: true,
          quantity: true,
          productId: true,
          matchStatus: true,
        },
      },
    },
  });
  if (!report) return null;

  const products = await loadMatchingProducts(report.listings);
  const resolved = resolveActiveListingMatches(report.listings, products);

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
        productListings: { where: { channel: "EBAY" }, select: { externalId: true }, take: 1 },
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
        entry.product = {
          id: match.product.id,
          sku: match.product.sku,
          ebayItemId: match.product.ebayItemId,
          productListings: match.product.productListings,
        };
        // 제목 매칭은 완전일치보다 확신도가 낮아 사람이 확인하도록 별도 상태로 남긴다.
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
          price: row.price == null ? null : Number(row.price),
          quantity: row.quantity,
        })),
      );
      await reconcileVariationListingStates(tx, {
        userId,
        reportCreatedAt: report.createdAt,
        completeSnapshot: report.completeSnapshot,
        rows: report.listings,
      });
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
    requireCompatibleTitle?: boolean;
  },
) {
  const latestReport = await prisma.ebayReportImport.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latestReport) {
    throw new EbayListingLinkError(
      "연결에 사용할 활성상품 보고서가 없습니다. 최신 보고서를 먼저 가져와 주세요.",
    );
  }
  const listing = await prisma.ebayActiveListing.findFirst({
    where: { importId: latestReport.id, itemId: input.itemId },
    select: {
      id: true,
      itemId: true,
      productId: true,
      title: true,
      price: true,
      quantity: true,
    },
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
      select: {
        id: true,
        status: true,
        ebayItemId: true,
        brand: true,
        category: true,
        optionName: true,
        productName: true,
        ebayTitle: true,
        productListings: {
          where: { channel: "EBAY" },
          select: { externalId: true, status: true },
        },
      },
    }),
    prisma.product.findFirst({
      where: {
        id: { not: input.productId },
        OR: [
          { ebayItemId: input.itemId },
          {
            productListings: {
              some: {
                channel: "EBAY",
                externalId: input.itemId,
                OR: [
                  { status: null },
                  { status: { in: ["ACTIVE", "PUBLISHED", "LISTED"] } },
                ],
              },
            },
          },
        ],
      },
      select: { id: true, sku: true },
    }),
  ]);
  if (!product) {
    throw new EbayListingLinkError("상품을 찾을 수 없습니다.");
  }
  if (
    input.requireCompatibleTitle &&
    (!listing.title || !isConfidentMarketCompTitle(product, listing.title))
  ) {
    throw new EbayListingLinkError(
      "선택한 리스팅은 이 카드의 그룹·멤버·앨범과 충분히 일치하지 않아 연결할 수 없습니다.",
    );
  }
  // ProductListing이 현재 채널의 기준이다. UNLINKED/ENDED는 과거 이력이라
  // 대표 연결로 쓰지 않고, 이전 열은 아직 이관되지 않은 상품의 호환값으로만 쓴다.
  const linkedListing = product.productListings?.find(
    (candidate) =>
      candidate.status == null ||
      ["ACTIVE", "PUBLISHED", "LISTED"].includes(candidate.status),
  );
  const primaryItemId = linkedListing?.externalId ?? product.ebayItemId;
  const otherItemId =
    primaryItemId && primaryItemId !== input.itemId ? primaryItemId : null;
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
      data: { productId: product.id, matchStatus: "MATCHED", linkedAt: new Date() },
    });
    // 여러 활성 리스팅을 하나의 카드에 "함께 연결"할 때는 ProductListing의
    // 대표 외부 ID를 바꾸지 않는다. 그 추가 연결은 EbayActiveListing에만 남는다.
    if (!addedAlongside) {
      await tx.productListing.upsert({
        where: {
          productId_channel: { productId: product.id, channel: "EBAY" },
        },
        update: {
          externalId: listing.itemId,
          price: listing.price,
          quantity: listing.quantity,
          status: "ACTIVE",
        },
        create: {
          productId: product.id,
          channel: "EBAY",
          externalId: listing.itemId,
          price: listing.price,
          quantity: listing.quantity,
          status: "ACTIVE",
          metadata: { source: "manual_active_listing_link" },
        },
      });
    }
    await tx.product.update({
      where: { id: product.id },
      // 함께 연결이면 대표 상품번호는 먼저 붙은 것을 그대로 둔다. 상품이 지닐 수
      // 있는 값은 하나뿐이라 덮어쓰면 예전 리스팅의 대표성이 사라진다.
      data: addedAlongside
        ? { listingStatus: "ACTIVE", ...(product.status === "unlisted" ? { status: "active" } : {}) }
        : { ebayItemId: listing.itemId, listingStatus: "ACTIVE", ...(product.status === "unlisted" ? { status: "active" } : {}) },
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
      const [channelListing, replacement] = await Promise.all([
        tx.productListing.findUnique({
          where: {
            productId_channel: { productId: listing.productId, channel: "EBAY" },
          },
          select: { externalId: true },
        }),
        // 같은 카드에 연결된 다른 활성 리스팅이 있으면 대표 연결을 그쪽으로
        // 넘긴다. 한 옵션을 해제했다고 카드 전체 연결이 사라지지 않게 한다.
        tx.ebayActiveListing.findFirst({
          where: {
            productId: listing.productId,
            id: { not: listing.id },
            status: "ACTIVE",
            matchStatus: "MATCHED",
          },
          orderBy: { createdAt: "desc" },
          select: { itemId: true, price: true, quantity: true },
        }),
      ]);

      if (channelListing?.externalId === listing.itemId) {
        if (replacement) {
          await tx.productListing.update({
            where: {
              productId_channel: { productId: listing.productId, channel: "EBAY" },
            },
            data: {
              externalId: replacement.itemId,
              price: replacement.price,
              quantity: replacement.quantity,
              status: "ACTIVE",
            },
          });
          await tx.product.update({
            where: { id: listing.productId },
            data: { ebayItemId: replacement.itemId, listingStatus: "ACTIVE" },
          });
        } else {
          // 명시적 연결 해제의 이력은 보존한다. 다음 활성상품 보고서에서 다시
          // 확인·연결하기 전까지는 어떤 화면이나 자동 반영에도 쓰이지 않는다.
          await tx.productListing.update({
            where: {
              productId_channel: { productId: listing.productId, channel: "EBAY" },
            },
            data: { status: "UNLINKED", quantity: null },
          });
          await tx.product.update({
            where: { id: listing.productId },
            data: { ebayItemId: null, listingStatus: null },
          });
        }
      } else if (channelListing) {
        // ProductListing이 다른 대표 번호를 가리키는 경우에는, 해제하는 보조
        // 리스팅 때문에 대표 연결을 건드리지 않고 남아 있던 이전 열만 바로잡는다.
        await tx.product.update({
          where: { id: listing.productId },
          data: {
            ebayItemId: channelListing.externalId,
            listingStatus: "ACTIVE",
          },
        });
      } else {
        // ProductListing 도입 전 데이터는 이전 열을 기준으로 동일한 안전 규칙을
        // 적용한다. 이 경로는 채널 레코드를 임의로 만들지 않는다.
        const legacyProduct = await tx.product.findUnique({
          where: { id: listing.productId },
          select: { ebayItemId: true },
        });
        if (legacyProduct?.ebayItemId === listing.itemId) {
          await tx.product.update({
            where: { id: listing.productId },
            data: replacement
              ? { ebayItemId: replacement.itemId, listingStatus: "ACTIVE" }
              : { ebayItemId: null, listingStatus: null },
          });
        }
      }
    }
    await tx.ebayActiveListing.update({
      where: { id: listing.id },
      data: { productId: null, matchStatus: "UNMATCHED", linkedAt: null },
    });
  });

  return { id: listing.id };
}
