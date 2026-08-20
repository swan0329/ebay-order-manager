import Link from "next/link";
import { Prisma } from "@/generated/prisma";
import { OrdersControls } from "@/components/OrdersControls";
import { ShopifyOrderSyncButton } from "@/components/ShopifyOrderSyncButton";
import { OrdersPager } from "@/components/OrdersPager";
import {
  ResizableOrdersTable,
  type OrderListRow,
} from "@/components/ResizableOrdersTable";
import { TopNav } from "@/components/TopNav";
import {
  ebayOrderCategories,
  ebayOrderCategoryLabel,
  normalizeOrderStatusParam,
  type EbayOrderCategory,
} from "@/lib/ebay-order-status";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

// eBay 셀러허브와 동일한 주문 분류 SQL 식.
// 배송상태 + 결제상태(orderPaymentStatus) + 취소상태(cancelStatus.cancelState)를 조합한다.
const ebayCategorySql = Prisma.sql`
  CASE
    WHEN upper(coalesce(o."raw_json"->'cancelStatus'->>'cancelState', '')) = 'CANCELED'
      OR upper(coalesce(o."raw_json"->>'orderPaymentStatus', '')) = 'FULLY_REFUNDED'
      THEN 'CANCELLED'
    WHEN o."fulfillment_status" = 'FULFILLED' THEN 'SHIPPED'
    WHEN upper(coalesce(o."raw_json"->>'orderPaymentStatus', '')) IN ('PENDING', 'FAILED')
      THEN 'AWAITING_PAYMENT'
    ELSE 'AWAITING_SHIPMENT'
  END
`;

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

const pageSizeOptions = [10, 25, 50, 100, 200];

function parsePageSize(value?: string) {
  const parsed = Number(value);
  return pageSizeOptions.includes(parsed) ? parsed : 10;
}

type OrderWithInventory = {
  id: string;
  ebayOrderId: string;
  buyerName: string | null;
  buyerUsername: string | null;
  buyerCountry: string | null;
  paidAt: Date | null;
  orderDate: Date;
  fulfillmentStatus: string;
  ebayCategory: string;
  totalAmount: { toString(): string };
  currency: string;
  tags: string[];
  warningLevel: string;
  warningMessage: string | null;
  items: {
    productId: string | null;
    lineItemId: string;
    title: string;
    sku: string | null;
    quantity: number;
    stockDeducted: boolean;
    matchedBy: string | null;
    matchScore: number | null;
    product: {
      sku: string;
      productName: string;
      stockQuantity: number;
      imageUrl: string | null;
    } | null;
  }[];
  shipments: { trackingNumber: string }[];
};

function orderSqlConditions({
  userId,
  q,
  from,
  to,
}: {
  userId: string;
  q?: string;
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

function categoryCondition(category: EbayOrderCategory) {
  return Prisma.sql`(${ebayCategorySql}) = ${category}`;
}

async function categoryCounts(
  baseConditions: Prisma.Sql[],
  inventory: string | undefined,
) {
  const inventoryCondition = inventorySqlCondition(inventory);
  const whereConditions = inventoryCondition
    ? [...baseConditions, inventoryCondition]
    : baseConditions;

  const rows = await prisma.$queryRaw<{ category: string; count: bigint }[]>`
    SELECT (${ebayCategorySql}) AS "category", count(*)::bigint AS "count"
    FROM "orders" o
    ${orderWhereSql(whereConditions)}
    GROUP BY 1
  `;

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const value = Number(row.count);
    counts[row.category] = value;
    total += value;
  }

  return { counts, total };
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

function inventorySqlCondition(inventory?: string) {
  if (inventory === "unmatched") {
    return Prisma.sql`EXISTS (
      SELECT 1
      FROM "order_items" oi_unmatched
      WHERE oi_unmatched."order_id" = o."id"
        AND oi_unmatched."product_id" IS NULL
    )`;
  }

  if (inventory === "deducted") {
    return Prisma.sql`EXISTS (
      SELECT 1
      FROM "order_items" oi_deducted
      WHERE oi_deducted."order_id" = o."id"
        AND oi_deducted."stock_deducted" = true
    )`;
  }

  if (inventory === "warning") {
    return Prisma.sql`o."warning_level" <> 'none'`;
  }

  if (inventory === "shortage") {
    return shortageSqlCondition();
  }

  return null;
}

async function orderListRows(
  conditions: Prisma.Sql[],
  inventory: string | undefined,
  skip: number,
  take: number,
) {
  const inventoryCondition = inventorySqlCondition(inventory);
  const whereConditions = inventoryCondition
    ? [...conditions, inventoryCondition]
    : conditions;

  return prisma.$queryRaw<OrderWithInventory[]>`
    WITH page_orders AS (
      SELECT
        o."id",
        o."ebay_order_id",
        o."buyer_name",
        o."buyer_username",
        o."buyer_country",
        o."paid_at",
        o."order_date",
        o."fulfillment_status",
        o."total_amount",
        o."currency",
        o."tags",
        o."warning_level",
        o."warning_message",
        (${ebayCategorySql}) AS "ebay_category"
      FROM "orders" o
      ${orderWhereSql(whereConditions)}
      ORDER BY o."order_date" DESC, o."id" DESC
      OFFSET ${skip}
      LIMIT ${take}
    )
    SELECT
      po."id",
      po."ebay_order_id" AS "ebayOrderId",
      po."buyer_name" AS "buyerName",
      po."buyer_username" AS "buyerUsername",
      po."buyer_country" AS "buyerCountry",
      po."paid_at" AS "paidAt",
      po."order_date" AS "orderDate",
      po."fulfillment_status" AS "fulfillmentStatus",
      po."ebay_category" AS "ebayCategory",
      po."total_amount" AS "totalAmount",
      po."currency",
      po."tags",
      po."warning_level" AS "warningLevel",
      po."warning_message" AS "warningMessage",
      COALESCE(order_items."items", '[]'::jsonb) AS "items",
      COALESCE(order_shipments."shipments", '[]'::jsonb) AS "shipments"
    FROM page_orders po
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'productId', oi."product_id",
          'lineItemId', oi."line_item_id",
          'title', oi."title",
          'sku', oi."sku",
          'quantity', oi."quantity",
          'stockDeducted', oi."stock_deducted",
          'matchedBy', oi."matched_by",
          'matchScore', oi."match_score",
          'product',
            CASE
              WHEN p."id" IS NULL THEN NULL
              ELSE jsonb_build_object(
                'sku', p."sku",
                'productName', p."product_name",
                'stockQuantity', p."stock_quantity",
                'imageUrl', p."image_url"
              )
            END
        )
        ORDER BY oi."created_at" ASC, oi."id" ASC
      ) AS "items"
      FROM "order_items" oi
      LEFT JOIN "products" p ON p."id" = oi."product_id"
      WHERE oi."order_id" = po."id"
    ) order_items ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('trackingNumber', s."tracking_number")
        ORDER BY s."created_at" ASC, s."id" ASC
      ) AS "shipments"
      FROM "shipments" s
      WHERE s."order_id" = po."id"
    ) order_shipments ON true
    ORDER BY po."order_date" DESC, po."id" DESC
  `;
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
    ebayCategory: order.ebayCategory,
    totalAmount: order.totalAmount.toString(),
    currency: order.currency,
    trackingNumbers: order.shipments.map((shipment) => shipment.trackingNumber),
    tags: order.tags,
    warningLevel: order.warningLevel,
    warningMessage: order.warningMessage,
    itemImages: order.items.map((item) => ({
      src: item.product?.imageUrl ?? null,
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
  const statusFilter = normalizeOrderStatusParam(params.status);
  const pageSize = parsePageSize(params.pageSize);
  const requestedPage = Math.max(1, Number(params.page) || 1);
  const baseConditions = orderSqlConditions({
    userId: user.id,
    q,
    from: params.from,
    to: params.to,
  });
  const listConditions =
    statusFilter === "ALL"
      ? baseConditions
      : [...baseConditions, categoryCondition(statusFilter)];
  const currentPage = requestedPage;
  const skip = (currentPage - 1) * pageSize;
  const [fetchedOrders, { counts, total }] = await Promise.all([
    orderListRows(listConditions, params.inventory, skip, pageSize + 1),
    categoryCounts(baseConditions, params.inventory),
  ]);
  const hasNextPage = fetchedOrders.length > pageSize;
  const rawOrders = fetchedOrders.slice(0, pageSize);
  const totalFiltered = skip + rawOrders.length + (hasNextPage ? 1 : 0);
  const totalPages = Math.max(1, hasNextPage ? currentPage + 1 : currentPage);
  const orderRows = rawOrders.map(toOrderListRow);
  const start = totalFiltered ? skip + 1 : 0;
  const end = totalFiltered ? start + rawOrders.length - 1 : 0;

  const statusCards: { key: EbayOrderCategory | "ALL"; label: string; count: number }[] = [
    { key: "ALL", label: "전체", count: total },
    ...ebayOrderCategories.map((category) => ({
      key: category,
      label: ebayOrderCategoryLabel[category],
      count: counts[category] ?? 0,
    })),
  ];

  const statusCardHref = (target: EbayOrderCategory | "ALL") => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (params.from) next.set("from", params.from);
    if (params.to) next.set("to", params.to);
    if (params.inventory && params.inventory !== "all") {
      next.set("inventory", params.inventory);
    }
    if (params.pageSize) next.set("pageSize", params.pageSize);
    next.set("status", target);
    return `/orders?${next.toString()}`;
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <OrdersControls />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* eBay 주문은 위쪽 동기화로 들어온다. Shopify는 아직 자동 수신이 없어 여기서 가져온다. */}
        <div className="mb-4 flex justify-end">
          <ShopifyOrderSyncButton />
        </div>
        <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {statusCards.map((card) => {
            const active = card.key === statusFilter;
            return (
              <Link
                key={card.key}
                href={statusCardHref(card.key)}
                scroll={false}
                className={`rounded-lg border p-4 transition ${
                  active
                    ? "border-zinc-900 bg-zinc-900 shadow-sm"
                    : "border-zinc-200 bg-white hover:border-zinc-400"
                }`}
              >
                <p
                  className={`text-sm font-medium ${
                    active ? "text-zinc-200" : "text-zinc-500"
                  }`}
                >
                  {card.label}
                </p>
                <p
                  className={`mt-3 text-2xl font-semibold ${
                    active ? "text-white" : "text-zinc-950"
                  }`}
                >
                  {card.count}
                </p>
              </Link>
            );
          })}
        </section>

        <ResizableOrdersTable orders={orderRows} />

        <OrdersPager
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={totalFiltered}
          start={start}
          end={end}
          hasNextPage={hasNextPage}
        />
      </main>
    </div>
  );
}
