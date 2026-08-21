import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    const orders = await prisma.order.findMany({
      where: { userId: user.id, acknowledgedAt: null, fulfillmentStatus: { not: "FULFILLED" } },
      orderBy: { orderDate: "desc" }, take: 20,
      select: { id: true, channel: true, externalOrderId: true, orderDate: true, totalAmount: true, currency: true },
    });
    return Response.json({ count: orders.length, orders: orders.map((order) => ({ ...order, totalAmount: order.totalAmount.toString() })) });
  } catch (error) { return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : "주문 알림을 불러오지 못했습니다.", error instanceof UnauthorizedError ? 401 : 500); }
}

export async function POST() {
  try {
    const user = await requireApiUser();
    const result = await prisma.order.updateMany({ where: { userId: user.id, acknowledgedAt: null, fulfillmentStatus: { not: "FULFILLED" } }, data: { acknowledgedAt: new Date() } });
    return Response.json({ acknowledged: result.count });
  } catch (error) { return jsonError(error instanceof UnauthorizedError ? "Unauthorized" : "주문 알림을 확인 처리하지 못했습니다.", error instanceof UnauthorizedError ? 401 : 500); }
}
