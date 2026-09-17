import { notFound } from "next/navigation";
import Link from "next/link";
import { FulfillmentRefreshButton } from "@/components/FulfillmentRefreshButton";
import {
  DeductStockButton,
  OrderItemProductMatcher,
} from "@/components/OrderInventoryActions";
import { ShipmentForm } from "@/components/ShipmentForm";
import { StatusBadge } from "@/components/StatusBadge";
import { TopNav } from "@/components/TopNav";
import { orderWarningClass } from "@/lib/order-automation";
import { orderCardImageSources } from "@/lib/order-images";
import { orderItemSale, orderMerchandiseTotal, formatOrderMoney, soldBelowCurrentCost } from "@/lib/order-money";
import { OrderCardImage } from "@/components/OrderCardImage";
import { PocamarketPurchaseButton } from "@/components/PocamarketPurchaseButton";
import { procurementHoldReason } from "@/lib/procurement-freshness";
import { rankFuzzyTitleMatches } from "@/lib/services/matchingService";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null | undefined) {
  return date ? new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul",
  }).format(date) : "-";
}

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
  const shopifyAddress = asRecord(order.shippingAddress);
  if (Object.keys(shopifyAddress).length) {
    return [
      asString(shopifyAddress.name),
      asString(shopifyAddress.address1),
      asString(shopifyAddress.address2),
      [
        asString(shopifyAddress.city),
        asString(shopifyAddress.provinceCode),
        asString(shopifyAddress.zip),
      ]
        .filter(Boolean)
        .join(" "),
      asString(shopifyAddress.countryCodeV2),
    ].filter(Boolean);
  }
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
  return (
    asString(order.buyerCheckoutNotes) ??
    asString(order.sellerMemo) ??
    asString(order.note) ??
    "-"
  );
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
  const [order, allProducts, pricingSettings] = await Promise.all([
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
    prisma.pricingSettings.findUnique({ where: { id: "default" }, select: { exchangeRateKrwPerUsd: true } }),
  ]);

  if (!order) {
    notFound();
  }

  const unmatchedItems = order.items.filter((item) => !item.productId);
  const merchandiseTotal = orderMerchandiseTotal(order.items.map(item => orderItemSale(item.rawJson, item.quantity, order.salesChannel)), order.currency);
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
        <Link href="/orders" className="mb-4 inline-block text-sm text-blue-700">← 주문 목록</Link>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <h1 className="text-xl font-semibold text-zinc-950">
                {order.orderNumber}
              </h1>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${order.salesChannel === "SHOPIFY" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>
                {order.salesChannel === "SHOPIFY" ? "Shopify" : "eBay"}
              </span>
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
              {formatDate(order.orderDate)}
            </p>
            <p className="mt-2 text-xl font-bold text-zinc-950">주문 총액 {formatOrderMoney(order.totalAmount.toString(), order.currency)}</p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <a href="#pocamarket-purchase" className="rounded-md bg-rose-600 px-3 py-2 text-center text-sm font-semibold text-white">포카마켓 구매로 이동</a>
            {order.salesChannel === "EBAY" ? (
              <FulfillmentRefreshButton orderId={order.id} />
            ) : null}
            <DeductStockButton orderId={order.id} />
          </div>
        </div>

        {unmatchedItems.length ? (
          <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">상품 미매칭 {unmatchedItems.length}건</p>
            <div className="mt-2 space-y-1">
              {unmatchedItems.map((item) => (
                <p key={item.id}>
                  {order.salesChannel === "SHOPIFY" ? "Shopify" : "eBay"} SKU {item.sku || "없음"} · {item.title}
                  {!item.sku ? " · SKU가 없어 자동 매칭되지 않았습니다." : ""}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 space-y-4">
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
                  const sale = orderItemSale(item.rawJson, item.quantity, order.salesChannel);
                  const cost = item.product?.salePrice == null ? null : Number(item.product.salePrice);
                  const hold = item.product ? procurementHoldReason(item.product) : null;
                  const belowCost = soldBelowCurrentCost(sale, cost, pricingSettings ? Number(pricingSettings.exchangeRateKrwPerUsd) : null);

                  return (
                    <div
                      key={item.id}
                      className="space-y-3 py-4 text-sm"
                    >
                      <div className="flex items-start gap-3">
                      <OrderCardImage sources={orderCardImageSources(item.product?.imageUrl, item.rawJson)} title={`${item.sku ?? ""} ${item.title}`} className="h-36 w-24" />
                      <div className="min-w-0 flex-1">
                        <p className="mb-1 font-semibold text-blue-800">카드 {item.product?.sku ?? item.sku ?? "SKU 없음"} · {item.quantity}장</p>
                        <p className="font-medium text-zinc-950">{item.title}</p>
                        <p className="mt-2 font-bold text-zinc-950">{sale ? `장당 판매금액 ${formatOrderMoney(sale.unitAmount, sale.currency)}` : "판매금액 미수집 · 주문 다시 불러오기 필요"}</p>
                        {sale ? <p className="mt-1 text-zinc-600">상품 합계 {formatOrderMoney(sale.lineAmount, sale.currency)} · 배송비·세금 제외</p> : null}
                        {item.product?.pocamarketId ? <div className="mt-3 rounded-md bg-zinc-50 p-2 text-xs">
                          <p>포카 판매목록 최저가: {item.product.isSoldOut ? "품절 · 구매 가능한 매물 없음" : cost !== null && cost > 0 ? formatOrderMoney(cost, "KRW") : "미확인"}</p>
                          <p className="mt-1 text-zinc-500">확인: {item.product.pocamarketSyncedAt ? formatDate(item.product.pocamarketSyncedAt) : "미확인"} · 앱 빠른구매 가격과 다를 수 있습니다.</p>
                          {hold ? <p className="mt-1 font-semibold text-amber-800">{hold}</p> : null}
                          {belowCost ? <p className="mt-1 font-semibold text-rose-700">현재 포카 원가보다 낮게 판매된 주문입니다. 설정 환율 기준이며 판매수수료·추가비용 전 비교입니다.</p> : null}
                        </div> : null}
                      </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`rounded-full px-2 py-1 font-semibold ring-1 ${state.className}`}>{state.label}</span>
                        {item.product ? <span className="text-zinc-500">현재 재고 {item.product.stockQuantity}장</span> : null}
                      </div>
                      <details open={!item.productId} className="rounded-md border border-zinc-200 p-2">
                      <summary className="cursor-pointer text-xs font-medium text-zinc-600">{item.productId ? `상품 연결 변경 · ${item.product?.sku ?? item.sku}` : "상품 연결 필요"}</summary>
                      <div className="mt-2 grid min-w-0 gap-3 rounded-md bg-zinc-50 p-3 sm:grid-cols-2">
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
                      <div className="min-w-0 sm:col-span-2">
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
                      </div>
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
                        ) : (
                          <p className="mt-1 text-xs text-zinc-500">
                            상품을 매칭하면 재고가 표시됩니다.
                          </p>
                        )}
                      </div>
                      </div>
                      </details>
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
            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="mb-3 font-semibold text-zinc-950">판매금액 합계</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt>상품 합계</dt><dd>{merchandiseTotal === null ? "일부 금액 미수집" : formatOrderMoney(merchandiseTotal, order.currency)}</dd></div>
                {merchandiseTotal !== null ? <div className="flex justify-between gap-2 text-zinc-500"><dt>배송·세금·기타 조정</dt><dd>{formatOrderMoney(Number(order.totalAmount) - merchandiseTotal, order.currency)}</dd></div> : null}
                <div className="flex justify-between gap-2 border-t pt-2 font-bold"><dt>주문 총액</dt><dd>{formatOrderMoney(order.totalAmount.toString(), order.currency)}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-zinc-500">주문 당시 금액입니다. 판매수수료 차감 후 정산액과 다릅니다.</p>
            </section>
            <section id="pocamarket-purchase" className="scroll-mt-6 rounded-lg border border-rose-200 bg-white p-4">
              <h2 className="font-semibold text-zinc-950">포카마켓 구매</h2>
              <p className="mt-1 text-xs text-zinc-500">부족 수량의 구매 요청과 휴대폰 결제 확인을 여기서 진행하세요.</p>
              <PocamarketPurchaseButton orderId={order.id} />
            </section>
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

            {order.salesChannel === "EBAY" ? (
              <ShipmentForm orderId={order.id} />
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                Shopify 배송 처리는 Shopify 관리자에서 진행하고, 이 화면에서는 주문과 송장 이력을 수집합니다.
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
