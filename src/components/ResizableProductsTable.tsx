"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ProductQuickEditCard,
  ProductQuickEditRow,
  type ProductQuickEditValue,
} from "@/components/ProductQuickEdit";

type Column = {
  id: string;
  label: string;
  width: number;
  minWidth: number;
  locked?: boolean;
};

const columns: Column[] = [
  { id: "select", label: "", width: 52, minWidth: 48, locked: true },
  { id: "sku", label: "상품번호", width: 120, minWidth: 90 },
  { id: "stockQuantity", label: "재고", width: 90, minWidth: 74 },
  { id: "brand", label: "그룹명", width: 140, minWidth: 100 },
  { id: "category", label: "앨범명", width: 240, minWidth: 140 },
  { id: "optionName", label: "멤버", width: 130, minWidth: 100 },
  { id: "imageUrl", label: "포카마켓 이미지", width: 130, minWidth: 104 },
  { id: "salePrice", label: "포카마켓 가격", width: 130, minWidth: 116 },
  { id: "memo", label: "원본 앨범명", width: 190, minWidth: 130 },
  { id: "productName", label: "상품명", width: 320, minWidth: 180 },
  { id: "status", label: "상태", width: 140, minWidth: 120 },
  { id: "listingStatus", label: "eBay 등록", width: 150, minWidth: 120 },
  { id: "save", label: "저장", width: 90, minWidth: 74, locked: true },
];

const widthStorageKey = "products-table-column-widths";
const visibilityStorageKey = "products-table-visible-columns";

function defaultWidths() {
  return Object.fromEntries(columns.map((column) => [column.id, column.width]));
}

function defaultVisibility() {
  return Object.fromEntries(columns.map((column) => [column.id, true]));
}

function configurableColumns() {
  return columns.filter((column) => !column.locked);
}

function productEditKey(product: ProductQuickEditValue) {
  return [
    product.id,
    product.productName,
    product.brand ?? "",
    product.category ?? "",
    product.optionName ?? "",
    product.stockQuantity,
    product.status,
    product.salePrice ?? "",
    product.memo ?? "",
  ].join(":");
}

export function ResizableProductsTable({
  products,
}: {
  products: ProductQuickEditValue[];
}) {
  const router = useRouter();
  const [widths, setWidths] = useState<Record<string, number>>(defaultWidths);
  const [visibility, setVisibility] =
    useState<Record<string, boolean>>(defaultVisibility);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("active");
  const [bulkStock, setBulkStock] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");

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
          setVisibility({ ...defaultVisibility(), ...parsed, select: true, save: true });
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
  const visibleColumnIds = useMemo(
    () => visibleColumns.map((column) => column.id),
    [visibleColumns],
  );
  const tableWidth = useMemo(
    () =>
      visibleColumns.reduce(
        (sum, column) => sum + (widths[column.id] ?? column.width),
        0,
      ),
    [visibleColumns, widths],
  );
  const selectedProductIds = useMemo(
    () =>
      products
        .map((product) => product.id)
        .filter((productId) => selectedIds.has(productId)),
    [products, selectedIds],
  );
  const selectedCount = selectedProductIds.length;
  const allSelected =
    products.length > 0 && products.every((product) => selectedIds.has(product.id));

  function resetColumns() {
    setWidths(defaultWidths());
    setVisibility(defaultVisibility());
  }

  function toggleColumn(columnId: string, checked: boolean) {
    setVisibility((current) => ({ ...current, [columnId]: checked }));
  }

  function toggleProduct(productId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(productId);
      } else {
        next.delete(productId);
      }

      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(products.map((product) => product.id)) : new Set());
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

  async function runBulkUpdate(payload: {
    status?: string;
    stockQuantity?: string;
    salePrice?: string;
  }) {
    if (!selectedCount) {
      setBulkMessage("선택된 상품이 없습니다.");
      return;
    }

    if (payload.stockQuantity !== undefined && payload.stockQuantity.trim() === "") {
      setBulkMessage("변경할 재고 수량을 입력해 주세요.");
      return;
    }

    if (payload.salePrice !== undefined && payload.salePrice.trim() === "") {
      setBulkMessage("변경할 가격을 입력해 주세요.");
      return;
    }

    setBulkLoading(true);
    setBulkMessage("");

    const response = await fetch("/api/products/bulk", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: selectedProductIds,
        ...payload,
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { updated?: number; stockMovements?: number; error?: string }
      | null;

    setBulkLoading(false);

    if (!response.ok) {
      setBulkMessage(data?.error ?? "일괄 수정 실패");
      return;
    }

    setBulkMessage(
      `일괄 수정 ${data?.updated ?? 0}건${
        data?.stockMovements ? `, 재고 이력 ${data.stockMovements}건` : ""
      }`,
    );
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-950">
              선택 {selectedCount}개 / 현재 페이지 {products.length}개
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              체크한 상품만 상태, 재고, 가격을 한 번에 변경합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              선택 해제
            </button>
            <button
              type="button"
              onClick={resetColumns}
              className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              컬럼 초기화
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 xl:grid-cols-[180px_auto_160px_auto_180px_auto]">
          <select
            value={bulkStatus}
            onChange={(event) => setBulkStatus(event.currentTarget.value)}
            className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
          >
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
            <option value="sold_out">품절</option>
          </select>
          <button
            type="button"
            onClick={() => runBulkUpdate({ status: bulkStatus })}
            disabled={bulkLoading || !selectedCount}
            className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            상태 일괄 변경
          </button>
          <input
            value={bulkStock}
            onChange={(event) => setBulkStock(event.currentTarget.value)}
            type="number"
            min="0"
            placeholder="재고 수량"
            className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
          />
          <button
            type="button"
            onClick={() => runBulkUpdate({ stockQuantity: bulkStock })}
            disabled={bulkLoading || !selectedCount}
            className="h-10 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            재고 일괄 변경
          </button>
          <input
            value={bulkPrice}
            onChange={(event) => setBulkPrice(event.currentTarget.value)}
            type="number"
            min="0"
            step="0.01"
            placeholder="판매가"
            className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
          />
          <button
            type="button"
            onClick={() => runBulkUpdate({ salePrice: bulkPrice })}
            disabled={bulkLoading || !selectedCount}
            className="h-10 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            가격 일괄 변경
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

        {bulkMessage ? (
          <p className="mt-3 text-sm text-zinc-600">{bulkMessage}</p>
        ) : null}
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
                    {column.id === "select" ? (
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(event) => toggleAll(event.currentTarget.checked)}
                        aria-label="현재 페이지 전체 선택"
                        className="h-4 w-4 rounded border-zinc-300"
                      />
                    ) : (
                      <span className="block truncate pr-2" title={column.label}>
                        {column.label}
                      </span>
                    )}
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
              {products.map((product) => (
                <ProductQuickEditRow
                  key={productEditKey(product)}
                  product={product}
                  visibleColumnIds={visibleColumnIds}
                  selected={selectedIds.has(product.id)}
                  onSelectedChange={(checked) => toggleProduct(product.id, checked)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 md:hidden">
        {products.map((product) => (
          <ProductQuickEditCard
            key={productEditKey(product)}
            product={product}
            selected={selectedIds.has(product.id)}
            onSelectedChange={(checked) => toggleProduct(product.id, checked)}
          />
        ))}
      </section>
    </div>
  );
}
