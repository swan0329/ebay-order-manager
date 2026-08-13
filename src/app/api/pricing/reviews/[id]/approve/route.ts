import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const body = await request.json();
    if (body.confirmed !== true) throw new Error("명시적인 승인 확인이 필요합니다.");
    const { id } = await context.params;
    const result = await prisma.pricingReview.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
    });
    if (result.count !== 1) throw new Error("검토가 없거나 이미 승인되었습니다.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const unauthorized = error instanceof UnauthorizedError;
    return NextResponse.json({ error: unauthorized ? "관리자 권한이 필요합니다." : error instanceof Error ? error.message : "승인하지 못했습니다." }, { status: unauthorized ? 401 : 400 });
  }
}
