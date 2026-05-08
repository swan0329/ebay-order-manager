import { notFound } from "next/navigation";
import { FulfillmentRefreshButton } from "@/components/FulfillmentRefreshButton";
import {
  DeductStockButton,
  OrderItemProductMatcher,
} from "@/components/OrderInventoryActions";
import { ShipmentForm } from "@/components/ShipmentForm";
import { StatusBadge } from "@/components/StatusBadge";
import { TopNav } from "@/components/TopNav";
import { orderWarningClass } from "@/lib/order-automation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/view-models";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function addressLines(rawJson: unknown) {
  const order = asRecord(rawJson);
  const instruction = asRecord(asArray(order.fulfillmentStartInstructions)[0]);
  const shippingStep = asRecord(instruction.shippingStep);
  const shipTo = asRecord(shippingStep.shipTo);
  const address = asRecord(shipTo.contactAddress);

  return [
    asString(shipTo.fullName),
    asString(address.addressLine1),
    asString(address.addressLine2),
    [
      asString(address.city),
      asString(address.stateOrProvince),
      asString(address.postalCode),
    ]
      .filter(Boolean)
      .join(" "),
    asString(address.countryCode),
  ].filter(Boolean);
}

function orderMemo(rawJson: unknown) {
  const order = asRecord(rawJson);
  return asString(order.buyerCheckoutNotes) ?? asString(order.sellerMemo) ?? "-";
}

function itemInventoryState({
  stockDeducted,
  shortage,
  matched,
}: {
  stockDeducted: boolean;
  shortage: boolean;
  matched: boolean;
}) {
  if (stockDeducted) {
    return {
      label: "차감완료",
      className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    };
  }

  if (shortage) {
    return {
      label: "재고부족",
      className: "bg-rose-50 text-rose-700 ring-rose-200",
    };
  }

  if (matched) {
    return {
      label: "차감대기",
      className: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    };
  }

  return {
    label: "미매칭",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
  };
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const [order, products] = await Promise.all([
    prisma.order.findFirst({
      where: { id, userId: user.id },
      include: {
        items: { include: { product: true } },
        shipments: { orderBy: { shippedAt: "desc" } },
      },
    }),
    prisma.product.findMany({
      where: { status: { not: "inactive" } },
      select: { id: true, sku: true, productName: true, stockQuantity: true },
      orderBy: { sku: "asc" },
      take: 500,
    }),
  ]);

  if (!order) {
    notFound();
  }

  const unmatchedItems = order.items.filter((item) => !item.productId);

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <h1 className="text-xl font-semibold text-zinc-950">
                {order.ebayOrderId}
              </h1>
              <StatusBadge status={order.fulfillmentStatus} />
            </div>
            {order.tags.length ? (
              <div className="mb-2 flex flex-wrap gap-1">
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
            <p className="text-sm text-zinc-500">
              {formatDate(order.orderDate)} · {order.totalAmount.toString()}{" "}
              {order.currency}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <FulfillmentRefreshButton orderId={order.id} />
            <DeductStockButton orderId={order.id} />
          </div>
        </div>

        {unmatchedItems.length ? (
          <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">상품 미매칭 {unmatchedItems.length}건</p>
            <div className="mt-2 space-y-1">
              {unmatchedItems.map((item) => (
                <p key={item.id}>
                  eBay SKU {item.sku || "없음"} · {item.title}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <section className="space-y-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="mb-3 text-base font-semibold text-zinc-950">
                주문 상품 / 상품매칭
              </h2>
              <div className="divide-y divide-zinc-200">
                {order.items.map((item) => {
                  const shortage =
                    !item.stockDeducted &&
                    item.product &&
                    item.product.stockQuantity < item.quantity;
                  const state = itemInventoryState({
                    stockDeducted: item.stockDeducted,
                    shortage: Boolean(shortage),
                    matched: Boolean(item.productId),
                  });

                  return (
                    <div
                      key={item.id}
                      className="grid gap-3 py-3 text-sm lg:grid-cols-[1fr_150px_70px_280px_120px]"
                    >
                      <div>
                        <p className="font-medium text-zinc-950">{item.title}</p>
                        <p className="mt-1 text-zinc-500">
                          Line item: {item.lineItemId}
                        </p>
                        <p className="mt-1 text-zinc-500">
                          eBay SKU: {item.sku ?? "없음"}
                        </p>
                      </div>
                      <div className="text-zinc-700">
                        <p className="text-xs font-semibold text-zinc-500">
                          연결된 상품
                        </p>
                        {item.product ? (
                          <p className="mt-1">
                            {item.product.sku} · {item.product.productName}
                          </p>
                        ) : (
                          <p className="mt-1 text-amber-700">아직 없음</p>
                        )}
                      </div>
                      <p className="text-zinc-700">{item.quantity}개</p>
                      <OrderItemProductMatcher
                        orderId={order.id}
                        orderItemId={item.id}
                        productId={item.productId}
                        itemSku={item.sku}
                        itemTitle={item.title}
                        products={products}
                        disabled={item.stockDeducted}
                      />
                      <div>
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${state.className}`}
                        >
                          {state.label}
                        </span>
                        {item.product ? (
                          <p className="mt-1 text-xs text-zinc-500">
                            현재 재고 {item.product.stockQuantity}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="mb-3 text-base font-semibold text-zinc-950">
                주문 메모
              </h2>
              <p className="whitespace-pre-wrap text-sm text-zinc-700">
                {orderMemo(order.rawJson)}
              </p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="mb-3 text-base font-semibold text-zinc-950">
                배송 처리 이력
              </h2>
              {order.shipments.length ? (
                <div className="divide-y divide-zinc-200">
                  {order.shipments.map((shipment) => (
                    <div
                      key={shipment.id}
                      className="grid gap-2 py-3 text-sm sm:grid-cols-[130px_1fr_160px_auto]"
                    >
                      <p className="font-medium text-zinc-950">
                        {shipment.carrierCode}
                      </p>
                      <p className="text-zinc-700">{shipment.trackingNumber}</p>
                      <p className="text-zinc-500">
                        {formatDate(shipment.shippedAt)}
                      </p>
                      <StatusBadge status={shipment.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">배송 이력 없음</p>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="mb-3 text-base font-semibold text-zinc-950">
                자동 태그/경고
              </h2>
              {order.warningMessage ? (
                <p className="text-sm font-medium text-zinc-800">
                  {order.warningMessage}
                </p>
              ) : (
                <p className="text-sm text-zinc-500">현재 경고가 없습니다.</p>
              )}
              <p className="mt-2 text-xs text-zinc-500">
                마지막 확인:{" "}
                {order.automationCheckedAt
                  ? formatDate(order.automationCheckedAt)
                  : "-"}
              </p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="mb-3 text-base font-semibold text-zinc-950">
                구매자 주소
              </h2>
              <div className="space-y-1 text-sm text-zinc-700">
                {addressLines(order.rawJson).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>

            <ShipmentForm orderId={order.id} />
          </aside>
        </div>
      </main>
    </div>
  );
}
