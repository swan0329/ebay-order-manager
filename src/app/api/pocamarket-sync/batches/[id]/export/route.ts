import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const batch = await prisma.pocamarketSyncBatch.findFirst({
      where: { id, userId: user.id },
      include: {
        items: {
          orderBy: { productNumber: "asc" },
          include: {
            product: { select: { sku: true, productName: true } },
          },
        },
      },
    });
    if (!batch) return jsonError("최신화 작업을 찾을 수 없습니다.", 404);

    const rows = [
      [
        "SKU",
        "상품명",
        "포카마켓 상품번호",
        "이전 가격",
        "확인 가격",
        "이전 매물 수",
        "확인 매물 수",
        "상태",
        "오류 코드",
        "오류",
        "확인 시각",
      ],
      ...batch.items.map((item) => [
        item.product.sku,
        item.product.productName,
        item.productNumber,
        item.previousPrice?.toString() ?? "",
        item.observedPrice?.toString() ?? "",
        item.previousAvailableCount ?? "",
        item.observedAvailableCount ?? "",
        item.status,
        item.errorCode ?? "",
        item.errorMessage ?? "",
        item.observedAt?.toISOString() ?? "",
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="pocamarket-sync-${id}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(
      error instanceof Error ? error.message : "결과 파일을 만들지 못했습니다.",
      500,
    );
  }
}
