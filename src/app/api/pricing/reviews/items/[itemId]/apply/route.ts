import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const user = await requireApiUser();
    const body = await request.json();
    if (body.confirmed !== true || typeof body.draftId !== "string") {
      throw new Error("적용할 초안과 명시적인 확인이 필요합니다.");
    }
    const { itemId } = await context.params;
    await prisma.$transaction(async (tx) => {
      const item = await tx.pricingReviewItem.findUnique({
        where: { id: itemId }, include: { review: true },
      });
      if (!item || item.review.status !== "APPROVED") throw new Error("승인된 권장가만 적용할 수 있습니다.");
      const draft = await tx.listingDraft.findFirst({
        where: { id: body.draftId, userId: user.id, sourceInventoryId: item.productId },
      });
      if (!draft) throw new Error("해당 상품의 업로드 초안을 찾을 수 없습니다.");
      if (item.appliedDraftId && item.appliedDraftId !== draft.id) throw new Error("이미 다른 초안에 적용된 권장가입니다.");
      const sources = draft.fieldSourceJson && typeof draft.fieldSourceJson === "object" && !Array.isArray(draft.fieldSourceJson)
        ? draft.fieldSourceJson as Record<string, unknown> : {};
      await tx.listingDraft.update({
        where: { id: draft.id },
        data: { price: item.recommendedPriceUsd, fieldSourceJson: {
          ...sources, price: "approved_pricing_review", pricingReviewItemId: item.id,
        } },
      });
      await tx.pricingReviewItem.update({
        where: { id: item.id },
        data: { appliedDraftId: draft.id, appliedById: user.id, appliedAt: new Date() },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const unauthorized = error instanceof UnauthorizedError;
    return NextResponse.json({ error: unauthorized ? "관리자 권한이 필요합니다." : error instanceof Error ? error.message : "업로드 초안에 적용하지 못했습니다." }, { status: unauthorized ? 401 : 400 });
  }
}
