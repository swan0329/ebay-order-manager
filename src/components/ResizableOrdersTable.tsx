"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";

type Column = {
  id: string;
  label: string;
  width: number;
  minWidth: number;
  locked?: boolean;
};

export type OrderListRow = {
  id: string;
  ebayOrderId: string;
  buyerName: string | null;
  buyerUsername: string | null;
  buyerCountry: string | null;
  itemTitles: string[];
  ebaySkus: string[];
  matchedProducts: string[];
  quantity: number;
  paidAt: string | null;
  orderDate: string;
  fulfillmentStatus: string;
  totalAmount: string;
  currency: string;
  trackingNumbers: string[];
  tags: string[];
  warningLevel: string;
  warningMessage: string | null;
  unmatchedItems: {
    title: string;
    sku: string | null;
    lineItemId: string;
  }[];
  shortageItems: {
    title: string;
    sku: string | null;
    productSku: string | null;
    required: number;
    available: number;
  }[];
  deductedCount: number;
};

const columns: Column[] = [
  { id: "orderId", label: "주문번호", width: 150, minWidth: 120, locked: true },
  { id: "buyer", label: "구매자", width: 160, minWidth: 120 },
  { id: "items", label: "상품명", width: 320, minWidth: 180 },
  { id: "ebaySku", label: "eBay SKU", width: 160, minWidth: 110 },
  { id: "matchStatus", label: "상품매칭", width: 260, minWidth: 170 },
  { id: "quantity", label: "수량", width: 70, minWidth: 60 },
  { id: "paidAt", label: "결제일", width: 150, minWidth: 120 },
  { id: "fulfillmentStatus", label: "배송상태", width: 120, minWidth: 100 },
  { id: "country", label: "국가", width: 80, minWidth: 64 },
  { id: "total", label: "총액", width: 110, minWidth: 90 },
  { id: "tracking", label: "송장번호", width: 170, minWidth: 120 },
  { id: "inventory", label: "재고상태", width: 230, minWidth: 160 },
  { id: "warnings", label: "태그/경고", width: 210, minWidth: 150 },
  { id: "actions", label: "", width: 58, minWidth: 54, locked: true },
];

const widthStorageKey = "orders-table-column-widths";
const visibilityStorageKey = "orders-table-visible-columns";

function defaultWidths() {
  return Object.fromEntries(columns.map((column) => [column.id, column.width]));
}

function defaultVisibility() {
  return Object.fromEntries(columns.map((column) => [column.id, true]));
}

function configurableColumns() {
  return columns.filter((column) => !column.locked);
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function warningClass(level: string) {
  if (level === "critical") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  if (level === "warning") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  return "bg-zinc-100 text-zinc-600 ring-zinc-200";
}

function orderItemLine(item: { title: string; sku: string | null }) {
  return `${item.sku ? `SKU ${item.sku}` : "SKU 없음"} · ${item.title}`;
}

function matchBadge(order: OrderListRow) {
  if (order.unmatchedItems.length) {
    return {
      label: `미매칭 ${order.unmatchedItems.length}건`,
      className: "bg-amber-50 text-amber-700 ring-amber-200",
      details: order.unmatchedItems.map(orderItemLine),
    };
  }

  if (order.matchedProducts.length) {
    return {
      label: "매칭 완료",
      className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      details: order.matchedProducts,
    };
  }

  return {
    label: "상품 없음",
    className: "bg-zinc-100 text-zinc-600 ring-zinc-200",
    details: [] as string[],
  };
}

function inventoryBadge(order: OrderListRow) {
  if (order.shortageItems.length) {
    return {
      label: `재고부족 ${order.shortageItems.length}건`,
      className: "bg-rose-50 text-rose-700 ring-rose-200",
      details: order.shortageItems.map(
        (item) =>
          `${item.productSku ?? item.sku ?? "SKU 없음"} · 필요 ${item.required}, 현재 ${item.available}`,
      ),
    };
  }

  if (order.unmatchedItems.length) {
    return {
      label: `상품 미매칭 ${order.unmatchedItems.length}건`,
      className: "bg-amber-50 text-amber-700 ring-amber-200",
      details: order.unmatchedItems.map(orderItemLine),
    };
  }

  if (order.deductedCount) {
    return {
      label: `차감 ${order.deductedCount}건`,
      className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      details: [] as string[],
    };
  }

  return {
    label: "대기",
    className: "bg-zinc-100 text-zinc-600 ring-zinc-200",
    details: [] as string[],
  };
}

function DetailLines({ lines }: { lines: string[] }) {
  if (!lines.length) {
    return null;
  }

  return (
    <div className="mt-1 space-y-0.5 text-xs text-zinc-500">
      {lines.slice(0, 2).map((line) => (
        <p key={line} className="truncate" title={line}>
          {line}
        </p>
      ))}
      {lines.length > 2 ? <p>외 {lines.length - 2}건</p> : null}
    </div>
  );
}

export function ResizableOrdersTable({
  orders,
}: {
  orders: OrderListRow[];
}) {
  const [widths, setWidths] = useState<Record<string, number>>(defaultWidths);
  const [visibility, setVisibility] =
    useState<Record<string, boolean>>(defaultVisibility);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedWidths = window.localStorage.getItem(widthStorageKey);
      const storedVisibility = window.localStorage.getItem(visibilityStorageKey);

      if (storedWidths) {
        try {
          const parsed = JSON.parse(storedWidths) as Record<string, number>;
          setWidths({ ...defaultWidths(), ...parsed });
        } catch {
          setWidths(defaultWidths());
        }
      }

      if (storedVisibility) {
        try {
          const parsed = JSON.parse(storedVisibility) as Record<string, boolean>;
          setVisibility({ ...defaultVisibility(), ...parsed, orderId: true, actions: true });
        } catch {
          setVisibility(defaultVisibility());
        }
      }

      setSettingsLoaded(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    window.localStorage.setItem(widthStorageKey, JSON.stringify(widths));
  }, [settingsLoaded, widths]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    window.localStorage.setItem(visibilityStorageKey, JSON.stringify(visibility));
  }, [settingsLoaded, visibility]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => column.locked || visibility[column.id] !== false),
    [visibility],
  );
  const tableWidth = useMemo(
    () =>
      visibleColumns.reduce(
        (sum, column) => sum + (widths[column.id] ?? column.width),
        0,
      ),
    [visibleColumns, widths],
  );

  function resetColumns() {
    setWidths(defaultWidths());
    setVisibility(defaultVisibility());
  }

  function toggleColumn(columnId: string, checked: boolean) {
    setVisibility((current) => ({ ...current, [columnId]: checked }));
  }

  function startResize(column: Column, event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widths[column.id] ?? column.width;

    function onPointerMove(moveEvent: PointerEvent) {
      const nextWidth = Math.max(
        column.minWidth,
        Math.round(startWidth + moveEvent.clientX - startX),
      );
      setWidths((current) => ({ ...current, [column.id]: nextWidth }));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function renderCell(order: OrderListRow, columnId: string) {
    const match = matchBadge(order);
    const inventory = inventoryBadge(order);

    switch (columnId) {
      case "orderId":
        return <span className="font-medium text-zinc-950">{order.ebayOrderId}</span>;
      case "buyer":
        return order.buyerName ?? order.buyerUsername ?? "-";
      case "items":
        return (
          <span className="line-clamp-2" title={order.itemTitles.join(" | ")}>
            {order.itemTitles.join(" | ") || "-"}
          </span>
        );
      case "ebaySku":
        return order.ebaySkus.length ? order.ebaySkus.join(" | ") : "SKU 없음";
      case "matchStatus":
        return (
          <div>
            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${match.className}`}>
              {match.label}
            </span>
            <DetailLines lines={match.details} />
          </div>
        );
      case "quantity":
        return order.quantity;
      case "paidAt":
        return formatDate(order.paidAt ?? order.orderDate);
      case "fulfillmentStatus":
        return <StatusBadge status={order.fulfillmentStatus} />;
      case "country":
        return order.buyerCountry ?? "-";
      case "total":
        return `${order.totalAmount} ${order.currency}`;
      case "tracking":
        return order.trackingNumbers.length ? order.trackingNumbers.join(" | ") : "-";
      case "inventory":
        return (
          <div>
            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${inventory.className}`}>
              {inventory.label}
            </span>
            <DetailLines lines={inventory.details} />
          </div>
        );
      case "warnings":
        return (
          <div>
            {order.tags.length ? (
              <div className="flex flex-wrap gap-1">
                {order.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${warningClass(
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
          </div>
        );
      case "actions":
        return (
          <Link
            href={`/orders/${order.id}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-100"
            title="상세"
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
        );
      default:
        return null;
    }
  }

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-950">
              현재 페이지 {orders.length}건
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              미매칭은 eBay 주문 상품과 재고관리 상품이 아직 연결되지 않은 항목입니다.
            </p>
          </div>
          <button
            type="button"
            onClick={resetColumns}
            className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            컬럼 초기화
          </button>
        </div>

        <details className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-800">
            컬럼 표시 설정
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {configurableColumns().map((column) => (
              <label
                key={column.id}
                className="flex items-center gap-2 text-sm text-zinc-700"
              >
                <input
                  type="checkbox"
                  checked={visibility[column.id] !== false}
                  onChange={(event) =>
                    toggleColumn(column.id, event.currentTarget.checked)
                  }
                  className="h-4 w-4 rounded border-zinc-300"
                />
                {column.label}
              </label>
            ))}
          </div>
        </details>
      </section>

      <section className="hidden rounded-lg border border-zinc-200 bg-white md:block">
        <div className="overflow-x-auto">
          <table
            className="table-fixed text-left text-sm"
            style={{ minWidth: tableWidth, width: tableWidth }}
          >
            <colgroup>
              {visibleColumns.map((column) => (
                <col
                  key={column.id}
                  style={{ width: widths[column.id] ?? column.width }}
                />
              ))}
            </colgroup>
            <thead className="bg-zinc-50 text-xs font-semibold uppercase text-zinc-500">
              <tr>
                {visibleColumns.map((column) => (
                  <th key={column.id} className="relative px-2 py-3">
                    <span className="block truncate pr-2" title={column.label}>
                      {column.label}
                    </span>
                    {!column.locked ? (
                      <button
                        type="button"
                        onPointerDown={(event) => startResize(column, event)}
                        className="absolute bottom-0 right-0 top-0 w-2 cursor-col-resize border-r border-transparent hover:border-zinc-400"
                        title="컬럼 너비 조절"
                        aria-label={`${column.label} 컬럼 너비 조절`}
                      />
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-zinc-50">
                  {visibleColumns.map((column) => (
                    <td key={column.id} className="px-2 py-3 align-top text-zinc-700">
                      {renderCell(order, column.id)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 md:hidden">
        {orders.map((order) => {
          const match = matchBadge(order);
          const inventory = inventoryBadge(order);

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
                {order.itemTitles.join(" | ")}
              </p>
              <div className="mt-3 grid gap-2 text-xs text-zinc-600">
                <div>
                  <span className={`rounded-full px-2 py-1 font-semibold ring-1 ${match.className}`}>
                    {match.label}
                  </span>
                  <DetailLines lines={match.details} />
                </div>
                <div>
                  <span className={`rounded-full px-2 py-1 font-semibold ring-1 ${inventory.className}`}>
                    {inventory.label}
                  </span>
                  <DetailLines lines={inventory.details} />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                <span>{formatDate(order.orderDate)}</span>
                <span>{order.totalAmount} {order.currency}</span>
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
