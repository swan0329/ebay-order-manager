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
type MatchingProduct = { id: string; sku: string; ebayItemId: string | null };

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
      ],
    },
    select: { id: true, sku: true, ebayItemId: true },
  });
}

function resolveActiveListingMatches<T extends ResolvableRow>(
  rows: T[],
  products: MatchingProduct[],
) {
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const productsByItemId = new Map<string, MatchingProduct[]>();
  for (const product of products) {
    if (!product.ebayItemId) continue;
    const list = productsByItemId.get(product.ebayItemId) ?? [];
    list.push(product);
    productsByItemId.set(product.ebayItemId, list);
  }
  const skuCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.sku) skuCounts.set(row.sku, (skuCounts.get(row.sku) ?? 0) + 1);
  }

  return rows.map((row) => {
    // 1) eBay Item ID로 우선 매칭한다. 이 프로그램에서 올린 상품은 등록 시
    //    product.ebayItemId에 eBay Item ID가 저장되므로 가장 확실한 식별자다.
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
    else if (product.ebayItemId && product.ebayItemId !== row.itemId) {
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
  updates: Array<{ productId: string; itemId: string }>,
) {
  // 가격(ebay_price)은 포카마켓가+마진 계산이 소유하므로 여기서 건드리지 않는다.
  // 연결 정보(Item ID)와 활성 상태만 갱신한다.
  for (let index = 0; index < updates.length; index += 500) {
    const chunk = updates.slice(index, index + 500);
    await tx.$executeRaw`
      UPDATE "products" AS p
      SET
        "ebay_item_id" = v."item_id",
        "listing_status" = 'ACTIVE',
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
      })),
    );

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
  input: { productId: string; itemId: string },
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
  if (product.ebayItemId && product.ebayItemId !== input.itemId) {
    throw new EbayListingLinkError(
      `이 상품에는 이미 다른 상품번호(${product.ebayItemId})가 연결되어 있습니다.`,
    );
  }
  if (otherClaim) {
    throw new EbayListingLinkError(
      `이 상품번호는 이미 다른 상품(${otherClaim.sku})에 연결되어 있습니다.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.ebayActiveListing.update({
      where: { id: listing.id },
      data: { productId: product.id, matchStatus: "MATCHED" },
    });
    await tx.product.update({
      where: { id: product.id },
      data: { ebayItemId: listing.itemId, listingStatus: "ACTIVE" },
    });
  });

  return { productId: product.id, itemId: listing.itemId };
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
      data: { productId: null, matchStatus: "UNMATCHED" },
    });
  });

  return { id: listing.id };
}
