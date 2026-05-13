"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
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
  const [exportLoading, setExportLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [photoTarget, setPhotoTarget] = useState<ProductQuickEditValue | null>(null);

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
      setBulkMessage(data?.error ?? "일괄 수정에 실패했습니다.");
      return;
    }

    const updated = data?.updated ?? 0;
    const movements = data?.stockMovements ?? 0;
    setBulkMessage(
      movements > 0
        ? `${updated}개 상품을 수정했습니다. (재고 변동 로그 ${movements}건)`
        : `${updated}개 상품을 수정했습니다.`,
    );
    router.refresh();
  }

  async function runBulkDelete() {
    if (!selectedCount) {
      setBulkMessage("삭제할 상품을 하나 이상 선택해 주세요.");
      return;
    }

    const targetLabel =
      selectedCount === 1
        ? "선택한 상품 1개를 영구 삭제할까요?"
        : `선택한 상품 ${selectedCount}개를 영구 삭제할까요?`;

    if (!window.confirm(`${targetLabel}\n\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    setBulkLoading(true);
    setBulkMessage("");

    const response = await fetch("/api/products/bulk", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: selectedProductIds,
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { deleted?: number; error?: string }
      | null;

    setBulkLoading(false);

    if (!response.ok) {
      setBulkMessage(data?.error ?? "선택 상품 삭제에 실패했습니다.");
      return;
    }

    setBulkMessage(`${data?.deleted ?? 0}개 상품을 삭제했습니다.`);
    setSelectedIds(new Set());
    router.refresh();
  }

  async function downloadSelectedListingXlsx() {
    if (!selectedCount) {
      setBulkMessage("XLSX로 받을 상품을 하나 이상 선택해 주세요.");
      return;
    }

    setExportLoading(true);
    setBulkMessage("");

    const response = await fetch("/api/listing-upload/inventory/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productIds: selectedProductIds }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setExportLoading(false);
      setBulkMessage(data?.error ?? "이베이 업로드 XLSX 다운로드에 실패했습니다.");
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ebay-category-listing-upload.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setExportLoading(false);
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
            <button
              type="button"
              onClick={() => void downloadSelectedListingXlsx()}
              disabled={exportLoading || !selectedCount}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-700 bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
            >
              <Download className="h-3.5 w-3.5" />
              {exportLoading ? "XLSX 준비 중" : "이베이 XLSX"}
            </button>
            <button
              type="button"
              onClick={() => void runBulkDelete()}
              disabled={bulkLoading || !selectedCount}
              className="h-8 rounded-md border border-rose-300 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
            >
              선택 삭제
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
                  onPhotoUploadClick={setPhotoTarget}
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
            onPhotoUploadClick={setPhotoTarget}
          />
        ))}
      </section>

      {photoTarget ? (
        <InventoryPhotoUploadModal
          product={photoTarget}
          onClose={() => setPhotoTarget(null)}
          onSaved={() => {
            setPhotoTarget(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

type UploadSide = "front" | "back";

function InventoryPhotoUploadModal({
  product,
  onClose,
  onSaved,
}: {
  product: ProductQuickEditValue;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [frontImageUrl, setFrontImageUrl] = useState<string | null>(null);
  const [backImageUrl, setBackImageUrl] = useState<string | null>(null);
  const [activeSide, setActiveSide] = useState<UploadSide>("front");
  const [dragSide, setDragSide] = useState<UploadSide | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const sourceImageUrl =
    product.sourceImageUrl ?? (product.userImageRegistered ? null : product.imageUrl);
  const currentFrontUrl = product.userImageRegistered ? product.imageUrl : null;
  const currentBackUrl = product.hasBackImage
    ? `/api/products/image-match/assets/${product.id}/back`
    : null;

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      const file = imageFileFromDataTransfer(event.clipboardData);

      if (!file) {
        return;
      }

      event.preventDefault();
      void storeImageFile(file, activeSide);
    };

    window.addEventListener("paste", handler);

    return () => window.removeEventListener("paste", handler);
  }, [activeSide]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handler);

    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function storeImageFile(file: File, side: UploadSide) {
    if (!file.type.startsWith("image/")) {
      setMessage("이미지 파일만 업로드할 수 있습니다.");
      return;
    }

    setMessage("이미지를 최적화하는 중입니다.");
    const dataUrl = await fileToOptimizedDataUrl(file);

    if (side === "front") {
      setFrontImageUrl(dataUrl);
      setActiveSide("back");
    } else {
      setBackImageUrl(dataUrl);
      setActiveSide("front");
    }

    setMessage(`${side === "front" ? "앞면" : "뒷면"} 촬영본이 준비되었습니다.`);
  }

  async function savePhoto() {
    if (saving) {
      return;
    }

    setSaving(true);
    setMessage("촬영본을 저장하는 중입니다.");

    try {
      const preservedFrontImageUrl =
        frontImageUrl ??
        (product.userImageRegistered && product.imageUrl
          ? await imageUrlToDataUrl(product.imageUrl)
          : null);

      if (!preservedFrontImageUrl) {
        setMessage("앞면 촬영본을 먼저 업로드해 주세요.");
        setSaving(false);
        return;
      }

      const preservedBackImageUrl =
        backImageUrl ?? (currentBackUrl ? await imageUrlToDataUrl(currentBackUrl) : null);
      const response = await fetch("/api/inventory/confirm-photo-card-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_id: product.id,
          user_front_image_url: preservedFrontImageUrl,
          user_back_image_url: preservedBackImageUrl,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { product?: { sku: string }; error?: string }
        | null;

      if (!response.ok || !data?.product) {
        throw new Error(data?.error ?? "촬영본 저장에 실패했습니다.");
      }

      setMessage(`${data.product.sku} 촬영본을 저장했습니다.`);
      window.setTimeout(onSaved, 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "촬영본 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="max-h-full w-full max-w-5xl overflow-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">
              {product.sku} 촬영본 등록
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {product.brand ?? "-"} / {product.category ?? "-"} /{" "}
              {product.optionName ?? "-"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <div className="space-y-3">
            <ReadonlyPreview title="포카마켓 이미지" src={sourceImageUrl} />
            {currentFrontUrl ? (
              <ReadonlyPreview title="현재 촬영본 앞면" src={currentFrontUrl} />
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <PhotoDropBox
              title="앞면 촬영본"
              side="front"
              active={activeSide === "front"}
              dragging={dragSide === "front"}
              value={frontImageUrl}
              currentValue={currentFrontUrl}
              onFocusSide={setActiveSide}
              onDragSide={setDragSide}
              onFile={(file) => storeImageFile(file, "front")}
            />
            <PhotoDropBox
              title="뒷면 촬영본"
              side="back"
              active={activeSide === "back"}
              dragging={dragSide === "back"}
              value={backImageUrl}
              currentValue={currentBackUrl}
              onFocusSide={setActiveSide}
              onDragSide={setDragSide}
              onFile={(file) => storeImageFile(file, "back")}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-600">
            {message || "이미지를 클릭하거나 Ctrl+V로 붙여넣거나 드래그할 수 있습니다."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={savePhoto}
              disabled={saving || (!frontImageUrl && !product.userImageRegistered)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              촬영본 저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadonlyPreview({ title, src }: { title: string; src: string | null }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-zinc-700">{title}</p>
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={title} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-7 w-7 text-zinc-400" />
        )}
      </div>
    </div>
  );
}

function PhotoDropBox({
  title,
  side,
  active,
  dragging,
  value,
  currentValue,
  onFocusSide,
  onDragSide,
  onFile,
}: {
  title: string;
  side: UploadSide;
  active: boolean;
  dragging: boolean;
  value: string | null;
  currentValue: string | null;
  onFocusSide: (side: UploadSide) => void;
  onDragSide: (side: UploadSide | null) => void;
  onFile: (file: File) => void;
}) {
  const preview = value ?? currentValue;

  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-800">{title}</span>
      <input
        type="file"
        accept="image/*"
        onFocus={() => onFocusSide(side)}
        onClick={() => onFocusSide(side)}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];

          if (file) {
            onFile(file);
          }

          event.currentTarget.value = "";
        }}
        className="mt-2 block w-full text-sm text-zinc-700 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:text-sm file:font-semibold file:text-white"
      />
      <div
        tabIndex={0}
        onFocus={() => onFocusSide(side)}
        onClick={() => onFocusSide(side)}
        onDragEnter={(event) => {
          event.preventDefault();
          onDragSide(side);
          onFocusSide(side);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          onDragSide(side);
        }}
        onDragLeave={() => onDragSide(null)}
        onDrop={(event) => {
          event.preventDefault();
          onDragSide(null);
          onFocusSide(side);
          const file = imageFileFromDataTransfer(event.dataTransfer);

          if (file) {
            onFile(file);
          }
        }}
        className={`mt-3 aspect-[3/4] overflow-hidden rounded-md border bg-zinc-50 outline-none ${
          active ? "border-zinc-950 ring-2 ring-zinc-950/10" : "border-zinc-200"
        } ${dragging ? "bg-emerald-50" : ""}`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-zinc-400">
            <Upload className="h-5 w-5" />
            <span>업로드 / 드래그 / Ctrl+V</span>
          </div>
        )}
      </div>
    </label>
  );
}

function imageFileFromDataTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return null;
  }

  const file = Array.from(dataTransfer.files).find((entry) =>
    entry.type.startsWith("image/"),
  );

  if (file) {
    return file;
  }

  return (
    Array.from(dataTransfer.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .find((entry): entry is File => Boolean(entry?.type.startsWith("image/"))) ??
    null
  );
}

async function imageUrlToDataUrl(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("기존 촬영본 이미지를 불러오지 못했습니다.");
  }

  return blobToDataUrl(await response.blob());
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽어오지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

async function fileToOptimizedDataUrl(file: File) {
  const rawDataUrl = await blobToDataUrl(file);

  try {
    const image = await loadImage(rawDataUrl);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return rawDataUrl;
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    return rawDataUrl;
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 읽어오지 못했습니다."));
    image.src = src;
  });
}

