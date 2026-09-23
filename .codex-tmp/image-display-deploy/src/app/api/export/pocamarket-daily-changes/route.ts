import * as XLSX from "xlsx";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

type DailyChangeRow = {
  sku: string;
  productName: string;
  stockQuantity: number;
  ebayPrice: { toString(): string } | null;
  previousPrice: { toString(): string } | null;
  observedPrice: { toString(): string } | null;
  previousAvailableCount: number | null;
  observedAvailableCount: number | null;
  observedAt: Date | null;
  imageReady: boolean;
  ebayItemId: string | null;
  listingStatus: string | null;
};

export async function GET() {
  try {
    await requireApiUser();
    const rows = await prisma.$queryRaw<DailyChangeRow[]>`
      SELECT DISTINCT ON (i."product_id")
        p."sku",
        p."product_name" AS "productName",
        p."stock_quantity" AS "stockQuantity",
        p."ebay_price" AS "ebayPrice",
        p."ebay_item_id" AS "ebayItemId",
        p."listing_status" AS "listingStatus",
        i."previous_price" AS "previousPrice",
        i."observed_price" AS "observedPrice",
        i."previous_available_count" AS "previousAvailableCount",
        i."observed_available_count" AS "observedAvailableCount",
        i."observed_at" AS "observedAt",
        (
          COALESCE(p."user_front_image_url",'') <> ''
          OR p."image_source" IN ('r2_user_uploaded','lens_workbench')
        ) AS "imageReady"
      FROM "pocamarket_sync_items" i
      JOIN "products" p ON p."id"=i."product_id"
      WHERE i."applied_at" IS NOT NULL
        AND i."observed_at">=NOW()-INTERVAL '24 hours'
        AND (
          i."previous_price" IS DISTINCT FROM i."observed_price"
          OR i."previous_available_count" IS DISTINCT FROM i."observed_available_count"
        )
      ORDER BY i."product_id",i."observed_at" DESC NULLS LAST`;

    const data = rows.map((row) => {
      const hasLocalStock = row.stockQuantity > 0;
      const hasPocamarketStock = (row.observedAvailableCount ?? 0) > 0;
      const procurementReady = !hasLocalStock && hasPocamarketStock && row.imageReady;
      const sellable = (hasLocalStock || hasPocamarketStock) && row.imageReady;
      const priceChanged =
        row.previousPrice?.toString() !== row.observedPrice?.toString();
      const action = !sellable
        ? hasPocamarketStock
          ? "이미지 준비 필요"
          : "판매 종료 검토"
        : priceChanged
          ? "판매가 재계산·검토"
          : "판매 유지";
      return {
        "*Action": row.ebayItemId
          ? sellable
            ? "Revise"
            : "End"
          : "ItemID 연결 필요",
        ItemID: row.ebayItemId ?? "",
        CustomLabel: row.sku,
        "*Quantity": sellable
          ? hasLocalStock
            ? row.stockQuantity
            : 1
          : 0,
        "*BuyItNowPrice": row.ebayPrice?.toString() ?? "",
        SKU: row.sku,
        상품명: row.productName,
        "권장 조치": action,
        "판매 가능": sellable ? "가능" : "불가/검토",
        "판매 경로": hasLocalStock
          ? "보유재고"
          : procurementReady
            ? "포카마켓 조달"
            : "-",
        "보유 재고": row.stockQuantity,
        "이미지 준비": row.imageReady ? "완료" : "미완료",
        "기존 포카 가격": row.previousPrice?.toString() ?? "",
        "최신 포카 가격": row.observedPrice?.toString() ?? "",
        "현재 eBay 가격(USD)": row.ebayPrice?.toString() ?? "",
        "기존 포카 매물 수": row.previousAvailableCount ?? "",
        "최신 포카 매물 수": row.observedAvailableCount ?? "",
        "확인 시각": row.observedAt?.toISOString() ?? "",
      };
    });

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet["!cols"] = [
      { wch: 18 },
      { wch: 42 },
      { wch: 20 },
      { wch: 12 },
      { wch: 16 },
      { wch: 12 },
      { wch: 14 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 18 },
      { wch: 18 },
      { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, "일일 변경 검토");
    const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(output), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="pocamarket-daily-changes-${date}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(
      error instanceof Error ? error.message : "일일 변경 엑셀 생성 실패",
      500,
    );
  }
}
