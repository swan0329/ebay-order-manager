/* eslint-disable @next/next/no-img-element */
import { notFound } from "next/navigation";
import { ImageOff } from "lucide-react";
import { FulfillmentRefreshButton } from "@/components/FulfillmentRefreshButton";
import {
  DeductStockButton,
  OrderItemProductMatcher,
} from "@/components/OrderInventoryActions";
import { ShipmentForm } from "@/components/ShipmentForm";
import { StatusBadge } from "@/components/StatusBadge";
import { TopNav } from "@/components/TopNav";
import { PocamarketPurchaseButton } from "@/components/PocamarketPurchaseButton";
import { deriveEbayOrderCategory } from "@/lib/ebay-order-status";
import { availabilityForOrder, reservedByProduct } from "@/lib/stock-reservation";
import { orderWarningClass } from "@/lib/order-automation";
import { orderItemImageUrlFromRaw } from "@/lib/order-images";
import { rankFuzzyTitleMatches } from "@/lib/services/matchingService";
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
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function ProductImage({
  src,
  title,
}: {
  src: string | null;
  title: string;
}) {
  return (
    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
      {src ? (
        <img src={src} alt={title} className="h-full w-full object-cover" />
      ) : (
        <ImageOff className="h-7 w-7 text-zinc-400" />
      )}
    </div>
  );
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const [order, allProducts] = await Promise.all([
    prisma.order.findFirst({
      where: { id, userId: user.id },
      include: {
        items: { include: { product: true } },
        shipments: { orderBy: { shippedAt: "desc" } },
      },
    }),
    prisma.product.findMany({
      where: { status: { not: "inactive" } },
      select: {
        id: true,
        sku: true,
        productName: true,
        optionName: true,
        category: true,
        brand: true,
        memo: true,
        imageUrl: true,
        stockQuantity: true,
      },
      orderBy: { sku: "asc" },
    }),
  ]);

  if (!order) {
    notFound();
  }

  const unmatchedItems = order.items.filter((item) => !item.productId);
  // 재고가 모자란 항목. 목록 화면에만 있던 포카마켓 구매를 여기서도 할 수 있게
  // 어느 카드가 몇 장 모자란지 함께 보여 준다.
  // 부족 수량은 카드 단위로 센다. 같은 카드가 여러 줄에 있으면 필요량을 합친 뒤
  // 재고를 한 번만 뺀다. 줄마다 따로 재고와 비교하면 같은 카드가 두 건으로 보인다.
  const neededByProduct = new Map<string, number>();
  for (const item of order.items) {
    if (item.stockDeducted || !item.product) continue;
    neededByProduct.set(
      item.product.id,
      (neededByProduct.get(item.product.id) ?? 0) + item.quantity,
    );
  }

  // 다른 주문이 이미 잡아 둔 수량까지 봐야 진짜 쓸 수 있는 양이 나온다. 이것을 보지
  // 않으면 같은 한 장을 두 주문이 각각 자기 것으로 여긴다.
  const reservationLines = neededByProduct.size
    ? await prisma.orderItem.findMany({
        where: { productId: { in: [...neededByProduct.keys()] }, stockDeducted: false },
        select: {
          productId: true,
          quantity: true,
          stockDeducted: true,
          order: { select: { orderStatus: true, fulfillmentStatus: true } },
        },
      })
    : [];
  const cancelled = ["CANCELLED", "CANCELED", "CANCELLED_BY_SELLER"];
  const totalReserved = reservedByProduct(
    reservationLines.map((line) => ({
      productId: line.productId as string,
      quantity: line.quantity,
      stockDeducted: line.stockDeducted,
      orderCancelled:
        cancelled.includes(line.order.orderStatus) ||
        cancelled.includes(line.order.fulfillmentStatus),
    })),
  );

  const availabilityByProduct = new Map(
    [...neededByProduct.entries()].map(([productId, needed]) => {
      const product = order.items.find((item) => item.product?.id === productId)?.product;
      return [
        productId,
        availabilityForOrder({
          stock: product?.stockQuantity ?? 0,
          totalReserved: totalReserved.get(productId) ?? needed,
          neededByThisOrder: needed,
        }),
      ] as const;
    }),
  );

  const orderRaw =
    order.rawJson && typeof order.rawJson === "object" && !Array.isArray(order.rawJson)
      ? (order.rawJson as Record<string, unknown>)
      : {};
  const cancelStatus =
    orderRaw.cancelStatus && typeof orderRaw.cancelStatus === "object"
      ? (orderRaw.cancelStatus as Record<string, unknown>)
      : {};
  // 구매 요청은 배송대기 주문에만 만들 수 있다. 그 조건이 아니면 버튼을 눌러도
  // 서버가 거절하므로, 같은 기준으로 여기서도 보이지 않게 한다.
  const canPurchaseShortage =
    deriveEbayOrderCategory({
      fulfillmentStatus: order.fulfillmentStatus,
      paymentStatus:
        typeof orderRaw.orderPaymentStatus === "string" ? orderRaw.orderPaymentStatus : null,
      cancelState:
        typeof cancelStatus.cancelState === "string" ? cancelStatus.cancelState : null,
    }) === "AWAITING_SHIPMENT";
  const products = allProducts.slice(0, 50).map((product) => ({
    id: product.id,
    sku: product.sku,
    productName: product.productName,
    optionName: product.optionName,
    category: product.category,
    brand: product.brand,
    imageUrl: product.imageUrl,
    stockQuantity: product.stockQuantity,
  }));
  const suggestedProductsByItemId = new Map(
    order.items.map((item) => [
      item.id,
      rankFuzzyTitleMatches(item.title, allProducts, 5).map(({ product, score }) => ({
        id: product.id,
        sku: product.sku,
        productName: product.productName,
        optionName: product.optionName,
        category: product.category,
        brand: product.brand,
        imageUrl: product.imageUrl,
        stockQuantity: product.stockQuantity,
        matchScore: score,
      })),
    ]),
  );

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
                  {!item.sku ? " · SKU가 없어 자동 매칭되지 않았습니다." : ""}
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
                  const availability = item.product
                    ? availabilityByProduct.get(item.product.id)
                    : undefined;
                  const missing = availability?.missing ?? 0;
                  const shortage = !item.stockDeducted && missing > 0;

                  const state = itemInventoryState({
                    stockDeducted: item.stockDeducted,
                    shortage: Boolean(shortage),
                    matched: Boolean(item.productId),
                  });
                  const imageUrl =
                    orderItemImageUrlFromRaw(item.rawJson) ??
                    item.product?.imageUrl ??
                    null;

                  return (
                    <div
                      key={item.id}
                      className="grid gap-3 py-4 text-sm lg:grid-cols-[auto_1fr_160px_70px_300px_120px]"
                    >
                      <ProductImage src={imageUrl} title={item.title} />
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
                          <div className="mt-1">
                            <p>{item.product.sku}</p>
                            <p className="text-xs text-zinc-500">
                              {item.product.productName}
                            </p>
                          </div>
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
                        suggestedProducts={suggestedProductsByItemId.get(item.id) ?? []}
                        matchedBy={item.matchedBy}
                        matchScore={item.matchScore}
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
                            재고 {item.product.stockQuantity}
                            {availability && availability.reservedByOthers > 0
                              ? ` · 다른 주문이 ${availability.reservedByOthers}장 예약 · 이 주문이 쓸 수 있는 수량 ${availability.available}`
                              : ""}
                          </p>
                        ) : null}
                        {shortage && item.product ? (
                          <div className="mt-1">
                            <p className="text-xs font-semibold text-rose-700">
                              {missing}장 부족
                            </p>
                            {canPurchaseShortage ? (
                              <PocamarketPurchaseButton
                                orderId={order.id}
                                productId={item.product.id}
                                cardLabel={item.product.sku}
                              />
                            ) : (
                              <p className="mt-1 text-xs text-zinc-500">
                                배송대기 주문만 구매 요청할 수 있습니다.
                              </p>
                            )}
                          </div>
                        ) : null}
                        {!item.product ? (
                          <p className="mt-1 text-xs text-zinc-500">
                            상품을 매칭하면 재고가 표시됩니다.
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
