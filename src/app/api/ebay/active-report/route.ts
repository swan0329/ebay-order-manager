import { asErrorMessage, jsonError } from "@/lib/http";
import {
  importEbayActiveReport,
  parseEbayActiveReport,
  rematchLatestEbayReport,
  unlinkEbayActiveListing,
} from "@/lib/ebay-active-report";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    const latest = await prisma.ebayReportImport.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        listings: {
          where: { matchStatus: { not: "MATCHED" } },
          select: {
            id: true,
            itemId: true,
            sku: true,
            title: true,
            matchStatus: true,
            product: { select: { productName: true, optionName: true } },
          },
          orderBy: { matchStatus: "asc" },
          take: 200,
        },
      },
    });
    return Response.json({ latest });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonError("보고서 파일이 필요합니다.", 422);
    if (file.size > 15 * 1024 * 1024) {
      return jsonError("보고서는 15MB 이하 파일만 사용할 수 있습니다.", 422);
    }
    const fileName = file.name || "ebay-active-report";
    if (!/\.(csv|xlsx|xls)$/i.test(fileName)) {
      return jsonError("CSV, XLSX 또는 XLS 파일만 사용할 수 있습니다.", 422);
    }

    const rows = parseEbayActiveReport(Buffer.from(await file.arrayBuffer()));
    const result = await importEbayActiveReport({
      userId: user.id,
      fileName,
      completeSnapshot: formData.get("completeSnapshot") === "true",
      rows,
    });
    return Response.json({ result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 422);
  }
}

export async function PATCH() {
  try {
    const user = await requireApiUser();
    const result = await rematchLatestEbayReport(user.id);
    if (!result) return jsonError("다시 연결할 보고서가 없습니다.", 404);
    return Response.json({ result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser();
    const listingId = new URL(request.url).searchParams.get("listingId");
    if (!listingId) return jsonError("listingId가 필요합니다.", 422);
    const result = await unlinkEbayActiveListing(user.id, listingId);
    if (!result) return jsonError("항목을 찾을 수 없습니다.", 404);
    return Response.json({ result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
