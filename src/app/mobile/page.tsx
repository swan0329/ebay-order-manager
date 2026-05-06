import { MobileShippingClient } from "@/components/MobileShippingClient";
import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { toShippingOrder } from "@/lib/view-models";

export const dynamic = "force-dynamic";

export default async function MobilePage() {
  const user = await requireUser();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const orders = await prisma.order.findMany({
    where: {
      userId: user.id,
      fulfillmentStatus: { in: ["NOT_STARTED", "IN_PROGRESS"] },
      OR: [{ shipByDate: null }, { shipByDate: { gte: today } }],
    },
    include: { items: true, shipments: true },
    orderBy: [{ shipByDate: "asc" }, { orderDate: "desc" }],
    take: 100,
  });

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main>
        <div className="border-b border-zinc-200 bg-white px-4 py-4">
          <h1 className="text-lg font-semibold text-zinc-950">
            오늘 발송할 주문
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{orders.length}건</p>
        </div>
        <MobileShippingClient orders={orders.map(toShippingOrder)} />
      </main>
    </div>
  );
}
