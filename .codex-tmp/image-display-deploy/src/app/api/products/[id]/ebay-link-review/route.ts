import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ action: z.enum(["confirm", "disconnect", "request_reconnect", "cancel_reconnect", "reopen_review"]) });

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const { action } = schema.parse(await request.json());
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true, ebayItemId: true, listingStatus: true } });
    if (!product) return jsonError("상품을 찾을 수 없습니다.", 404);
    if (action === "reopen_review") {
      if (!product.ebayItemId) return jsonError("다시 검토할 eBay 연결이 없습니다.", 409);
      await prisma.product.update({ where: { id }, data: { listingStatus: "REVIEW_REQUIRED" } });
      return Response.json({ ok: true, action, itemId: product.ebayItemId });
    }
    if (action === "request_reconnect") {
      if (product.ebayItemId) return jsonError("이미 eBay 상품번호가 연결돼 있습니다.", 409);
      await prisma.product.update({ where: { id }, data: { listingStatus: "REVIEW_REQUIRED" } });
      return Response.json({ ok: true, action });
    }
    if (action === "cancel_reconnect") {
      if (product.ebayItemId || product.listingStatus !== "REVIEW_REQUIRED") {
        return jsonError("취소할 연결 복구 검토가 없습니다.", 409);
      }
      await prisma.product.update({ where: { id }, data: { listingStatus: null } });
      return Response.json({ ok: true, action });
    }
    if (!product.ebayItemId) return jsonError("검토할 eBay 연결이 없습니다.", 404);
    if (product.listingStatus !== "REVIEW_REQUIRED") return jsonError("이미 처리된 연결입니다.", 409);

    if (action === "confirm") {
      const latestListing = await prisma.ebayActiveListing.findFirst({
        where: { itemId: product.ebayItemId, reportImport: { userId: user.id } },
        orderBy: { reportImport: { createdAt: "desc" } },
        select: { status: true },
      });
      // 정상 확정은 검토 표시만 해제하는 작업이다. 종료된 리스팅까지 ACTIVE로
      // 되살리면 자동 반영 대상이 잘못되므로 최신 eBay 상태를 그대로 복원한다.
      const confirmedStatus = latestListing?.status === "ENDED" ? "ENDED" : "ACTIVE";
      await prisma.$transaction([
        prisma.product.update({ where: { id }, data: { listingStatus: confirmedStatus } }),
        prisma.ebayActiveListing.updateMany({
          where: { itemId: product.ebayItemId, reportImport: { userId: user.id } },
          data: { productId: id, matchStatus: "MANUALLY_VERIFIED", linkedAt: new Date() },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.product.update({ where: { id }, data: { ebayItemId: null, listingStatus: null } }),
        prisma.ebayActiveListing.updateMany({
          where: { itemId: product.ebayItemId, productId: id, reportImport: { userId: user.id } },
          data: { productId: null, matchStatus: "UNMATCHED", linkedAt: null },
        }),
      ]);
    }
    return Response.json({ ok: true, action, itemId: product.ebayItemId });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("처리 방법을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
