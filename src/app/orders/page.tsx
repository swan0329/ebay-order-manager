import type { Prisma } from "@/generated/prisma";
import Link from "next/link";
import { AlertTriangle, ArrowRight, PackageCheck, PackageOpen, Truck } from "lucide-react";
import { OrdersControls } from "@/components/OrdersControls";
import { StatusBadge } from "@/components/StatusBadge";
import { TopNav } from "@/components/TopNav";
import { orderWarningClass } from "@/lib/order-automation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDate, trackingNumbers } from "@/lib/view-models";

export const dynamic = "force-dynamic";

type OrdersSearchParams = Promise<{
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  inventory?: string;
}>;

function dateRange(from?: string, to?: string) {
  if (!from && !to) {
    return undefined;
  }

  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000`) } : {}),
    ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
  };
}

function orderWhere(
  userId: string,
  q?: string,
  status?: string,
  from?: string,
  to?: string,
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    userId,
    ...(dateRange(from, to) ? { orderDate: dateRange(from, to) } : {}),
  };

  if (status === "OPEN" || !status) {
    where.fulfillmentStatus = { in: ["NOT_STARTED", "IN_PROGRESS"] };
  } else if (status !== "ALL") {
    where.fulfillmentStatus = status;
  }

  if (q) {
    where.OR = [
      { ebayOrderId: { contains: q, mode: "insensitive" } },
      { buyerName: { contains: q, mode: "insensitive" } },
      { buyerUsername: { contains: q, mode: "insensitive" } },
      {
        items: {
          some: {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  return where;
}

type OrderWithInventory = Prisma.OrderGetPayload<{
  include: { items: { include: { product: true } }; shipments: true };
}>;

function hasInventoryShortage(order: OrderWithInventory) {
  return order.items.some(
    (item) =>
      !item.stockDeducted &&
      item.product &&
      item.product.stockQuantity < item.quantity,
  );
}

function inventorySummary(order: OrderWithInventory) {
  const unmatched = order.items.filter((item) => !item.productId).length;
  const shortage = hasInventoryShortage(order);
  const deducted = order.items.filter((item) => item.stockDeducted).length;

  if (shortage) {
    return { label: "재고부족", className: "bg-rose-50 text-rose-700 ring-rose-200" };
  }

  if (unmatched) {
    return { label: `미매칭 ${unmatched}`, className: "bg-amber-50 text-amber-700 ring-amber-200" };
  }

  if (deducted) {
    return { label: `차감 ${deducted}`, className: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
  }

  return { label: "대기", className: "bg-zinc-100 text-zinc-600 ring-zinc-200" };
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: OrdersSearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const q = params.q?.trim();
  const status = params.status ?? "OPEN";
  const where = orderWhere(user.id, q, status, params.from, params.to);
  const [rawOrders, openCount, fulfilledCount, failedShipments] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { items: { include: { product: true } }, shipments: true },
      orderBy: { orderDate: "desc" },
      take: 200,
    }),
    prisma.order.count({
      where: {
        userId: user.id,
        fulfillmentStatus: { in: ["NOT_STARTED", "IN_PROGRESS"] },
      },
    }),
    prisma.order.count({
      where: { userId: user.id, fulfillmentStatus: "FULFILLED" },
    }),
    prisma.shipment.count({
      where: { order: { userId: user.id }, status: "FAILED" },
    }),
  ]);
  const orders = rawOrders.filter((order) => {
    if (params.inventory === "unmatched") {
      return order.items.some((item) => !item.productId);
    }

    if (params.inventory === "shortage") {
      return hasInventoryShortage(order);
    }

    if (params.inventory === "deducted") {
      return order.items.some((item) => item.stockDeducted);
    }

    if (params.inventory === "warning") {
      return order.warningLevel !== "none";
    }

    return true;
  });
  const shortageCount = rawOrders.filter(hasInventoryShortage).length;
  const warningCount = rawOrders.filter(
    (order) => order.warningLevel !== "none",
  ).length;

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <OrdersControls />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">배송대기</p>
              <PackageOpen className="h-5 w-5 text-amber-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {openCount}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">배송완료</p>
              <PackageCheck className="h-5 w-5 text-emerald-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {fulfilledCount}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">처리 실패</p>
              <Truck className="h-5 w-5 text-rose-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {failedShipments}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">재고부족</p>
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {shortageCount}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">자동 경고</p>
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {warningCount}
            </p>
          </div>
        </section>

        <section className="hidden overflow-x-auto rounded-lg border border-zinc-200 bg-white md:block">
          <table className="w-full min-w-[1420px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">주문번호</th>
                <th className="px-4 py-3">구매자</th>
                <th className="px-4 py-3">상품명</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">상품매칭</th>
                <th className="px-4 py-3">수량</th>
                <th className="px-4 py-3">결제일</th>
                <th className="px-4 py-3">배송상태</th>
                <th className="px-4 py-3">국가</th>
                <th className="px-4 py-3">총액</th>
                <th className="px-4 py-3">운송장 번호</th>
                <th className="px-4 py-3">재고</th>
                <th className="px-4 py-3">태그/경고</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {orders.map((order) => {
                const inventory = inventorySummary(order);
                return (
                  <tr key={order.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-950">
                    {order.ebayOrderId}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {order.buyerName ?? order.buyerUsername ?? "-"}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-zinc-700">
                    <span className="line-clamp-2">
                      {order.items.map((item) => item.title).join(" | ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {order.items.map((item) => item.sku ?? "").join(" | ") || "-"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {order.items
                      .map((item) => item.product?.sku ?? "미매칭")
                      .join(" | ")}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {order.items.reduce((sum, item) => sum + item.quantity, 0)}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {formatDate(order.paidAt ?? order.orderDate)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.fulfillmentStatus} />
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {order.buyerCountry ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {order.totalAmount.toString()} {order.currency}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {trackingNumbers(order.shipments)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${inventory.className}`}
                    >
                      {inventory.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {order.tags.length ? (
                      <div className="flex flex-wrap gap-1">
                        {order.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${orderWarningClass(
                              order.warningLevel,
                            )}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">-</span>
                    )}
                    {order.warningMessage ? (
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                        {order.warningMessage}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/orders/${order.id}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                      title="상세"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="space-y-3 md:hidden">
          {orders.map((order) => {
            const inventory = inventorySummary(order);
            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="block rounded-lg border border-zinc-200 bg-white p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">
                      {order.ebayOrderId}
                    </p>
                    <p className="mt-1 text-sm text-zinc-600">
                      {order.buyerName ?? order.buyerUsername ?? "-"}
                    </p>
                  </div>
                  <StatusBadge status={order.fulfillmentStatus} />
                </div>
                <p className="line-clamp-2 text-sm text-zinc-600">
                  {order.items.map((item) => item.title).join(" | ")}
                </p>
                <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                  <span>{formatDate(order.orderDate)}</span>
                  <span
                    className={`rounded-full px-2 py-1 font-semibold ring-1 ${inventory.className}`}
                  >
                    {inventory.label}
                  </span>
                </div>
                {order.tags.length ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {order.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ${orderWarningClass(
                          order.warningLevel,
                        )}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {order.warningMessage ? (
                  <p className="mt-2 text-xs text-zinc-500">
                    {order.warningMessage}
                  </p>
                ) : null}
              </Link>
            );
          })}
        </section>
      </main>
    </div>
  );
}
