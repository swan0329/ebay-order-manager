import type { Prisma } from "@/generated/prisma";
import { AlertTriangle, PackageCheck, PackageOpen, Truck } from "lucide-react";
import { OrdersControls } from "@/components/OrdersControls";
import { OrdersPager } from "@/components/OrdersPager";
import {
  ResizableOrdersTable,
  type OrderListRow,
} from "@/components/ResizableOrdersTable";
import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type OrdersSearchParams = Promise<{
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  inventory?: string;
  page?: string;
  pageSize?: string;
}>;

const pageSizeOptions = [25, 50, 100, 200];

function parsePageSize(value?: string) {
  const parsed = Number(value);
  return pageSizeOptions.includes(parsed) ? parsed : 50;
}

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
  const range = dateRange(from, to);
  const where: Prisma.OrderWhereInput = {
    userId,
    ...(range ? { orderDate: range } : {}),
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
              { product: { sku: { contains: q, mode: "insensitive" } } },
              { product: { productName: { contains: q, mode: "insensitive" } } },
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function imageUrlFromRaw(value: unknown): string | null {
  const record = asRecord(value);
  const direct =
    asString(record.imageUrl) ??
    asString(record.thumbnailImageUrl) ??
    asString(record.pictureUrl) ??
    asString(record.galleryURL);

  if (direct) {
    return direct;
  }

  const image = asRecord(record.image);
  return asString(image.imageUrl) ?? asString(image.url);
}

function hasInventoryShortage(order: OrderWithInventory) {
  return order.items.some(
    (item) =>
      !item.stockDeducted &&
      item.product &&
      item.product.stockQuantity < item.quantity,
  );
}

function matchesInventoryFilter(order: OrderWithInventory, inventory?: string) {
  if (inventory === "unmatched") {
    return order.items.some((item) => !item.productId);
  }

  if (inventory === "shortage") {
    return hasInventoryShortage(order);
  }

  if (inventory === "deducted") {
    return order.items.some((item) => item.stockDeducted);
  }

  if (inventory === "warning") {
    return order.warningLevel !== "none";
  }

  return true;
}

function uniqueStrings(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function toOrderListRow(order: OrderWithInventory): OrderListRow {
  const unmatchedItems = order.items
    .filter((item) => !item.productId)
    .map((item) => ({
      title: item.title,
      sku: item.sku,
      lineItemId: item.lineItemId,
    }));
  const shortageItems = order.items
    .filter(
      (item) =>
        !item.stockDeducted &&
        item.product &&
        item.product.stockQuantity < item.quantity,
    )
    .map((item) => ({
      title: item.title,
      sku: item.sku,
      productSku: item.product?.sku ?? null,
      required: item.quantity,
      available: item.product?.stockQuantity ?? 0,
    }));

  return {
    id: order.id,
    ebayOrderId: order.ebayOrderId,
    buyerName: order.buyerName,
    buyerUsername: order.buyerUsername,
    buyerCountry: order.buyerCountry,
    itemTitles: order.items.map((item) => item.title),
    ebaySkus: uniqueStrings(order.items.map((item) => item.sku)),
    matchedProducts: order.items
      .filter((item) => item.product)
      .map((item) => `${item.product?.sku} · ${item.product?.productName}`),
    quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    paidAt: order.paidAt?.toISOString() ?? null,
    orderDate: order.orderDate.toISOString(),
    fulfillmentStatus: order.fulfillmentStatus,
    totalAmount: order.totalAmount.toString(),
    currency: order.currency,
    trackingNumbers: order.shipments.map((shipment) => shipment.trackingNumber),
    tags: order.tags,
    warningLevel: order.warningLevel,
    warningMessage: order.warningMessage,
    itemImages: order.items.map((item) => ({
      src: item.product?.imageUrl ?? imageUrlFromRaw(item.rawJson),
      title: item.title,
      sku: item.sku,
      productSku: item.product?.sku ?? null,
      stockQuantity: item.product?.stockQuantity ?? null,
      matched: Boolean(item.productId),
    })),
    unmatchedItems,
    shortageItems,
    deductedCount: order.items.filter((item) => item.stockDeducted).length,
  };
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
  const pageSize = parsePageSize(params.pageSize);
  const requestedPage = Math.max(1, Number(params.page) || 1);
  const where = orderWhere(user.id, q, status, params.from, params.to);
  const [rawOrders, openCount, fulfilledCount, failedShipments] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { items: { include: { product: true } }, shipments: true },
      orderBy: { orderDate: "desc" },
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
  const filteredOrders = rawOrders.filter((order) =>
    matchesInventoryFilter(order, params.inventory),
  );
  const totalFiltered = filteredOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const orders = filteredOrders.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const orderRows = orders.map(toOrderListRow);
  const shortageCount = rawOrders.filter(hasInventoryShortage).length;
  const warningCount = rawOrders.filter(
    (order) => order.warningLevel !== "none",
  ).length;
  const start = totalFiltered ? (currentPage - 1) * pageSize + 1 : 0;
  const end = totalFiltered ? start + orders.length - 1 : 0;

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

        <ResizableOrdersTable orders={orderRows} />

        <OrdersPager
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={totalFiltered}
          start={start}
          end={end}
        />
      </main>
    </div>
  );
}
