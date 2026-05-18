import { Prisma } from "@/generated/prisma";
import { AlertTriangle, PackageCheck, PackageOpen, Truck } from "lucide-react";
import { OrdersControls } from "@/components/OrdersControls";
import { OrdersPager } from "@/components/OrdersPager";
import {
  ResizableOrdersTable,
  type OrderListRow,
} from "@/components/ResizableOrdersTable";
import { TopNav } from "@/components/TopNav";
import { orderItemImageUrlFromRaw } from "@/lib/order-images";
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

const orderListSelect = {
  id: true,
  ebayOrderId: true,
  buyerName: true,
  buyerUsername: true,
  buyerCountry: true,
  paidAt: true,
  orderDate: true,
  fulfillmentStatus: true,
  totalAmount: true,
  currency: true,
  tags: true,
  warningLevel: true,
  warningMessage: true,
  items: {
    select: {
      productId: true,
      lineItemId: true,
      title: true,
      sku: true,
      quantity: true,
      stockDeducted: true,
      matchedBy: true,
      matchScore: true,
      rawJson: true,
      product: {
        select: {
          sku: true,
          productName: true,
          stockQuantity: true,
          imageUrl: true,
        },
      },
    },
  },
  shipments: {
    select: {
      trackingNumber: true,
    },
  },
} satisfies Prisma.OrderSelect;

type OrderWithInventory = Prisma.OrderGetPayload<{
  select: typeof orderListSelect;
}>;

function inventoryWhere(
  inventory?: string,
): Prisma.OrderWhereInput | undefined {
  if (inventory === "unmatched") {
    return { items: { some: { productId: null } } };
  }

  if (inventory === "deducted") {
    return { items: { some: { stockDeducted: true } } };
  }

  if (inventory === "warning") {
    return { warningLevel: { not: "none" } };
  }

  return undefined;
}

function withInventoryWhere(where: Prisma.OrderWhereInput, inventory?: string) {
  const filter = inventoryWhere(inventory);

  return filter ? { AND: [where, filter] } : where;
}

function orderSqlConditions({
  userId,
  q,
  status,
  from,
  to,
}: {
  userId: string;
  q?: string;
  status?: string;
  from?: string;
  to?: string;
}) {
  const conditions: Prisma.Sql[] = [Prisma.sql`o."user_id" = ${userId}`];

  if (from) {
    conditions.push(Prisma.sql`o."order_date" >= ${new Date(`${from}T00:00:00.000`)}`);
  }

  if (to) {
    conditions.push(Prisma.sql`o."order_date" <= ${new Date(`${to}T23:59:59.999`)}`);
  }

  if (status === "OPEN" || !status) {
    conditions.push(
      Prisma.sql`o."fulfillment_status" IN (${Prisma.join([
        "NOT_STARTED",
        "IN_PROGRESS",
      ])})`,
    );
  } else if (status !== "ALL") {
    conditions.push(Prisma.sql`o."fulfillment_status" = ${status}`);
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(Prisma.sql`(
      o."ebay_order_id" ILIKE ${pattern}
      OR o."buyer_name" ILIKE ${pattern}
      OR o."buyer_username" ILIKE ${pattern}
      OR EXISTS (
        SELECT 1
        FROM "order_items" oi_search
        LEFT JOIN "products" p_search ON p_search."id" = oi_search."product_id"
        WHERE oi_search."order_id" = o."id"
          AND (
            oi_search."title" ILIKE ${pattern}
            OR oi_search."sku" ILIKE ${pattern}
            OR p_search."sku" ILIKE ${pattern}
            OR p_search."product_name" ILIKE ${pattern}
          )
      )
    )`);
  }

  return conditions;
}

function orderWhereSql(conditions: Prisma.Sql[]) {
  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

function shortageSqlCondition() {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "order_items" oi_shortage
    JOIN "products" p_shortage ON p_shortage."id" = oi_shortage."product_id"
    WHERE oi_shortage."order_id" = o."id"
      AND oi_shortage."stock_deducted" = false
      AND p_shortage."stock_quantity" < oi_shortage."quantity"
  )`;
}

async function countShortageOrders(conditions: Prisma.Sql[]) {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "orders" o
    ${orderWhereSql([...conditions, shortageSqlCondition()])}
  `;

  return Number(rows[0]?.count ?? 0);
}

async function shortageOrderPageIds(
  conditions: Prisma.Sql[],
  skip: number,
  take: number,
) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT o."id"
    FROM "orders" o
    ${orderWhereSql([...conditions, shortageSqlCondition()])}
    ORDER BY o."order_date" DESC, o."id" DESC
    OFFSET ${skip}
    LIMIT ${take}
  `;

  return rows.map((row) => row.id);
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
      matchScore: item.matchScore,
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
      .map((item) => {
        const score =
          typeof item.matchScore === "number"
            ? ` · ${Math.round(item.matchScore * 100)}%`
            : "";
        const method = item.matchedBy ? ` · ${item.matchedBy}${score}` : "";
        return `${item.product?.sku} · ${item.product?.productName}${method}`;
      }),
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
      src: orderItemImageUrlFromRaw(item.rawJson) ?? item.product?.imageUrl ?? null,
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
  const sqlConditions = orderSqlConditions({
    userId: user.id,
    q,
    status,
    from: params.from,
    to: params.to,
  });
  const filteredWhere = withInventoryWhere(where, params.inventory);
  const shortageCountPromise = countShortageOrders(sqlConditions);
  const [
    totalFiltered,
    openCount,
    fulfilledCount,
    failedShipments,
    shortageCount,
    warningCount,
  ] = await Promise.all([
    params.inventory === "shortage"
      ? shortageCountPromise
      : prisma.order.count({ where: filteredWhere }),
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
    shortageCountPromise,
    prisma.order.count({
      where: { AND: [where, { warningLevel: { not: "none" } }] },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const skip = (currentPage - 1) * pageSize;
  const rawOrders =
    params.inventory === "shortage"
      ? await (async () => {
          const ids = await shortageOrderPageIds(sqlConditions, skip, pageSize);

          if (!ids.length) {
            return [];
          }

          const orderPosition = new Map(ids.map((id, index) => [id, index]));
          const orders = await prisma.order.findMany({
            where: { id: { in: ids } },
            select: orderListSelect,
          });

          return orders.sort(
            (left, right) =>
              (orderPosition.get(left.id) ?? 0) - (orderPosition.get(right.id) ?? 0),
          );
        })()
        : await prisma.order.findMany({
          where: filteredWhere,
          select: orderListSelect,
          orderBy: [{ orderDate: "desc" }, { id: "desc" }],
          skip,
          take: pageSize,
        });
  const orderRows = rawOrders.map(toOrderListRow);
  const start = totalFiltered ? skip + 1 : 0;
  const end = totalFiltered ? start + rawOrders.length - 1 : 0;

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
