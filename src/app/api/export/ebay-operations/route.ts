import * as XLSX from "xlsx";
import { ebayReviseCsvRow } from "@/lib/ebay-operations-csv";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { planEbayInventoryPush } from "@/lib/services/ebayInventoryPush";

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

    // End 파일은 옵션의 부모 리스팅까지 내릴 수 있어 더 이상 만들지 않는다.
    // 품절은 통합 운영 화면에서 옵션 SKU 또는 단품 수량을 0으로 수정한다.
    if (type === "end") return jsonError("판매 종료 Excel은 안전하지 않아 중단되었습니다. 변동·품단종 관리에서 미리보기 후 수량 0 처리를 사용해 주세요.", 409);

    if (type !== "revise") return jsonError("지원하지 않는 Excel 유형입니다.", 422);

    const plan = await planEbayInventoryPush({ userId: user.id });
    const rows = plan.rows.flatMap((row) => {
      // 포카마켓 정보가 없거나 오래된 행은 파일로도 전송하지 않는다.
      if (!row.actionable) return [];
      const priceChanged = row.price !== null && (row.previousPrice === null || Math.abs(row.price - row.previousPrice) >= 0.005);
      const quantityChanged = row.previousQuantity === null || row.previousQuantity !== row.quantity;
      // 묶음 옵션은 부모 Item ID + 옵션 SKU 조합만 수정한다. 마지막 전송값이
      // 없는 옵션은 부모 전체를 잘못 덮을 수 있으므로 운영 화면에서 확인한다.
      if (row.listingType === "VARIATION_OPTION" && row.previousQuantity === null && row.previousPrice === null) return [];
      // eBay 일괄 파일의 빈 가격이 "가격 삭제/오류"로 해석되는 것을 막는다.
      // 가격을 못 정한 수량 변경은 운영 화면의 수량 전용 API 미리보기로 처리한다.
      if (row.price === null) return [];
      if (!priceChanged && !quantityChanged) return [];
      return [{
        "*Action": "Revise",
        ItemID: row.itemId,
        CustomLabel: row.sku,
        "*Quantity": row.quantity,
        "*BuyItNowPrice": row.price?.toFixed(2) ?? "",
        SKU: row.sku,
        상품명: row.parentTitle ?? row.productName,
        "리스팅 유형": row.listingType === "VARIATION_OPTION" ? "묶음 옵션 (부모 유지)" : "단품",
        "변경 사유": [priceChanged ? "가격" : "", quantityChanged ? "수량" : ""].filter(Boolean).join("·"),
        "내 재고": row.stock,
        "주문 예약": row.reserved,
        "안전재고": row.safetyStock,
        "포카 빠른구매": row.pocamarketFresh ? row.pocamarketAvailableCount ?? "" : "확인 필요",
        "판정": row.availabilityStatus,
        "현재 가격": row.previousPrice?.toFixed(2) ?? "",
        "현재 수량": row.previousQuantity ?? "",
      }];
    });
    const limited = rowLimit ? rows.slice(0, rowLimit) : rows;
    if (asCsv) {
      // 기존 리스팅은 Item number로 지목한다. Action 헤더에 Country=US를
      // 넣으면 상품 소재지가 미국이라는 뜻이 되어 한국 판매자의 해외 창고
      // 정책 차단을 유발하므로 가격·수량 수정 파일에는 소재지를 선언하지 않는다.
      return csvResponse(
        limited.map((row) =>
          ebayReviseCsvRow({
            itemId: row.ItemID,
            sku: String(row.SKU),
            price: row["*BuyItNowPrice"],
            quantity: row["*Quantity"],
          }),
        ),
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
