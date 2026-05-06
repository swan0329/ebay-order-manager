import { BulkShippingClient } from "@/components/BulkShippingClient";
import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { toShippingOrder } from "@/lib/view-models";

export const dynamic = "force-dynamic";

export default async function ShippingPage() {
  const user = await requireUser();
  const orders = await prisma.order.findMany({
    where: {
      userId: user.id,
      fulfillmentStatus: { in: ["NOT_STARTED", "IN_PROGRESS"] },
    },
    include: { items: true, shipments: true },
    orderBy: { orderDate: "desc" },
    take: 200,
  });

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl py-6">
        <div className="mb-5 px-4 sm:px-6">
          <h1 className="text-xl font-semibold text-zinc-950">배송처리</h1>
          <p className="mt-1 text-sm text-zinc-500">
            배송대기 주문 {orders.length}건
          </p>
        </div>
        <BulkShippingClient orders={orders.map(toShippingOrder)} />
      </main>
    </div>
  );
}
