import * as XLSX from "xlsx";
import { jsonError } from "@/lib/http";
import { getOperationalProductIds } from "@/lib/product-operations";
import { prisma } from "@/lib/prisma";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

function workbookResponse(rows: Record<string, string | number>[], name: string) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 12 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 45 },
    { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "eBay 작업");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}

// eBay 일괄 업로드에 그대로 올릴 수 있는 CSV. 신규등록 파일과 같은 규칙을 쓴다:
// 구분자 텍스트 + UTF-8 BOM, 그리고 eBay가 아는 열만 남긴다(한글 검토용 열 제외).
function csvResponse(rows: Record<string, string | number>[], name: string) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const escape = (value: string | number) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  const body = [headers, ...rows.map((row) => headers.map((key) => row[key] ?? ""))]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");

  return new Response(`﻿${body}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "x-row-count": String(rows.length),
      "cache-control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    // format=csv면 업로드용, 아니면 기존 검토용 XLSX.
    const asCsv = url.searchParams.get("format") === "csv";
    // 처음 올릴 때 몇 줄만 시험해 볼 수 있게 한다.
    const limitParam = Number(url.searchParams.get("limit"));
    const rowLimit =
      Number.isInteger(limitParam) && limitParam > 0 ? limitParam : null;
    const date = new Date().toISOString().slice(0, 10);

    if (type === "review") {
      const latest = await prisma.ebayReportImport.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: {
          listings: {
            where: { matchStatus: { not: "MATCHED" } },
            orderBy: [{ matchStatus: "asc" }, { sku: "asc" }],
          },
        },
      });
      const rows = (latest?.listings ?? []).map((listing) => ({
        판정: listing.matchStatus,
        SKU: listing.sku ?? "",
        ItemID: listing.itemId,
        제목: listing.title ?? "",
        "확인 사항":
          listing.matchStatus === "UNMATCHED"
            ? "프로그램 SKU와 연결"
            : listing.matchStatus === "DUPLICATE"
              ? "동일 SKU의 중복 등록 확인"
              : "기존 Item ID와 보고서 Item ID 확인",
      }));
      return workbookResponse(rows, `ebay-link-review-${date}.xlsx`);
    }

    if (type === "end") {
      const ids = await getOperationalProductIds("stop_required");
      const products = await prisma.product.findMany({
        where: { id: { in: ids }, ebayItemId: { not: null } },
        orderBy: { sku: "asc" },
      });
      return workbookResponse(
        products.map((product) => ({
          "*Action": "End",
          ItemID: product.ebayItemId ?? "",
          CustomLabel: product.sku,
          SKU: product.sku,
          상품명: product.productName,
          "권장 조치": "내 재고와 포카마켓 매물이 모두 없어 판매중단",
        })),
        `ebay-end-listings-${date}.xlsx`,
      );
    }

    if (type !== "revise") return jsonError("지원하지 않는 Excel 유형입니다.", 422);

    const [ids, settings, latest] = await Promise.all([
      getOperationalProductIds("sellable"),
      prisma.pricingSettings.findUnique({ where: { id: "default" } }),
      prisma.ebayReportImport.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (!settings) return jsonError("가격 설정을 먼저 저장해 주세요.", 422);
    const products = await prisma.product.findMany({
      where: {
        id: { in: ids },
        ebayItemId: { not: null },
        listingStatus: { in: ["ACTIVE", "PUBLISHED", "LISTED"] },
        // 가격 판정은 신규등록과 같은 규칙(@/lib/listing-price)에 맡긴다.
        // 여기서 포카마켓가 있는 상품만 거르면 수동 판매가로 파는 카드는
        // 가격을 바꿔도 eBay에 영영 반영되지 않는다.
      },
      orderBy: { sku: "asc" },
    });
    const snapshots = latest
      ? await prisma.ebayActiveListing.findMany({
          where: {
            importId: latest.id,
            productId: { in: products.map((product) => product.id) },
            matchStatus: "MATCHED",
          },
        })
      : [];
    const snapshotByProduct = new Map(
      snapshots.map((snapshot) => [snapshot.productId, snapshot]),
    );
    const rows = products.flatMap((product) => {
      const current = snapshotByProduct.get(product.id);
      if (!current) return [];
      // 포카마켓 가격이 있으면 마진 계산가, 없으면 사람이 넣은 판매가.
      const resolved = resolveListingPriceUsd(product, settings);
      if (!resolved) return [];
      const targetPrice = resolved.priceUsd;
      const targetQuantity =
        product.stockQuantity > 0 ? product.stockQuantity : 1;
      const priceChanged =
        current.price === null ||
        Math.abs(Number(current.price) - Number(targetPrice)) >= 0.01;
      const quantityChanged =
        current.quantity === null || current.quantity !== targetQuantity;
      if (!priceChanged && !quantityChanged) return [];
      return [
        {
          "*Action": "Revise",
          ItemID: product.ebayItemId ?? current.itemId,
          CustomLabel: product.sku,
          "*Quantity": targetQuantity,
          "*BuyItNowPrice": targetPrice.toString(),
          SKU: product.sku,
          상품명: product.productName,
          "변경 사유": [
            priceChanged ? "가격" : "",
            quantityChanged ? "수량" : "",
          ]
            .filter(Boolean)
            .join("·"),
          "현재 가격": current.price?.toString() ?? "",
          "현재 수량": current.quantity ?? "",
          // 이 가격이 어디서 나왔는지 검토용 파일에서 바로 보이게 한다.
          "가격 기준": resolved.source === "pocamarket" ? "포카마켓 계산가" : "수동 입력가",
        },
      ];
    });
    const limited = rowLimit ? rows.slice(0, rowLimit) : rows;
    if (asCsv) {
      // eBay가 아는 열만 남긴다. 신규등록 CSV와 같은 Action 헤더를 쓰고,
      // 리스팅은 상품번호로 지목한다(SKU는 대조용으로 함께 넣는다).
      return csvResponse(
        limited.map((row) => ({
          "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)": "Revise",
          "Item number": row.ItemID,
          "Custom label (SKU)": row.SKU,
          "Start price": row["*BuyItNowPrice"],
          Quantity: row["*Quantity"],
        })),
        `ebay-revise-${date}.csv`,
      );
    }
    return workbookResponse(limited, `ebay-revise-listings-${date}.xlsx`);
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(
      error instanceof Error ? error.message : "eBay 작업 Excel 생성 실패",
      500,
    );
  }
}
