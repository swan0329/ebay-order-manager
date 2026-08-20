"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Image as ImageIcon, Loader2, RefreshCw, ShoppingBag, Upload, X } from "lucide-react";
import {
  ProductQuickEditCard,
  ProductQuickEditRow,
  type ProductQuickEditValue,
} from "@/components/ProductQuickEdit";
import { productStatusLabel, productStatusOptions } from "@/lib/product-status";

type Column = {
  id: string;
  label: string;
  width: number;
  minWidth: number;
  locked?: boolean;
};

const columns: Column[] = [
  { id: "select", label: "", width: 52, minWidth: 48, locked: true },
  { id: "imageSource", label: "이미지 출처", width: 110, minWidth: 96 },
  { id: "sku", label: "상품번호", width: 120, minWidth: 90 },
  { id: "stockQuantity", label: "재고", width: 90, minWidth: 74 },
  { id: "sellability", label: "판매 가능 경로", width: 150, minWidth: 130 },
  { id: "uploadStatus", label: "eBay 업로드", width: 145, minWidth: 125 },
  { id: "brand", label: "그룹명", width: 140, minWidth: 100 },
  { id: "category", label: "앨범명", width: 240, minWidth: 140 },
  { id: "optionName", label: "멤버", width: 130, minWidth: 100 },
  { id: "featuredMembers", label: "유닛 멤버", width: 200, minWidth: 140 },
  { id: "imageUrl", label: "포카마켓 이미지", width: 130, minWidth: 104 },
  { id: "ebayPrice", label: "달러 가격($)", width: 120, minWidth: 104 },
  { id: "salePrice", label: "포카마켓 가격", width: 130, minWidth: 116 },
  { id: "pocamarketStock", label: "포카마켓 매물 수", width: 140, minWidth: 120 },
  { id: "pocamarketSyncedAt", label: "포카 최신화", width: 140, minWidth: 120 },
  { id: "memo", label: "원본 앨범명", width: 190, minWidth: 130 },
  { id: "productName", label: "상품명", width: 320, minWidth: 180 },
  { id: "status", label: "상태", width: 140, minWidth: 120 },
  { id: "shopify", label: "쇼피파이", width: 150, minWidth: 110 },
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

type BulkUpdatePayload = {
  status?: string;
  stockQuantity?: string;
  salePrice?: string;
};

type PendingBulkUpdate = {
  ids: string[];
  payload: BulkUpdatePayload;
};

function bulkUpdateChanges(payload: BulkUpdatePayload) {
  const changes: string[] = [];

  if (payload.status !== undefined) {
    changes.push(`상태: ${statusLabel(payload.status)}`);
  }

  if (payload.stockQuantity !== undefined) {
    changes.push(`재고: ${payload.stockQuantity}`);
  }

  if (payload.salePrice !== undefined) {
    changes.push(`가격: ${payload.salePrice}`);
  }

  return changes;
}

function statusLabel(status: string) {
  return productStatusLabel(status);
}

export function ResizableProductsTable({
  products,
  shopifyStoreHandle = null,
}: {
  products: ProductQuickEditValue[];
  shopifyStoreHandle?: string | null;
}) {
  const router = useRouter();
  const [widths, setWidths] = useState<Record<string, number>>(defaultWidths);
  const [groupMembers, setGroupMembers] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const unitBrands = [
      ...new Set(
        products
          .filter((p) => (p.optionName ?? "").trim().toLowerCase() === "unit")
          .map((p) => (p.brand ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const missing = unitBrands.filter((brand) => !(brand in groupMembers));
    if (!missing.length) {
      return;
    }

    let active = true;
    void (async () => {
      for (const brand of missing) {
        try {
          const response = await fetch(
            `/api/inventory/group-members?group=${encodeURIComponent(brand)}`,
          );
          const data = (await response.json().catch(() => null)) as
            | { members?: string[] }
            | null;
          if (!active) return;
          setGroupMembers((current) => ({ ...current, [brand]: data?.members ?? [] }));
        } catch {
          if (active) {
            setGroupMembers((current) => ({ ...current, [brand]: [] }));
          }
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [products, groupMembers]);
  const [visibility, setVisibility] =
    useState<Record<string, boolean>>(defaultVisibility);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("unlisted");
  const [bulkStock, setBulkStock] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [lensExportLoading, setLensExportLoading] = useState(false);
  const [combinedExportLoading, setCombinedExportLoading] = useState(false);
  const [ownPhotoExportLoading, setOwnPhotoExportLoading] = useState(false);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyProgress, setShopifyProgress] = useState<{
    total: number;
    done: number;
    success: number;
    failed: number;
    running: boolean;
  } | null>(null);
  const [bulkMessage, setBulkMessage] = useState("");
  const [pendingBulkUpdate, setPendingBulkUpdate] =
    useState<PendingBulkUpdate | null>(null);
  const [photoTarget, setPhotoTarget] = useState<ProductQuickEditValue | null>(null);
  const [renderMobileCards, setRenderMobileCards] = useState(false);

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

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setRenderMobileCards(media.matches);

    update();
    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

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

  function requestBulkUpdate(payload: BulkUpdatePayload) {
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

    setBulkMessage("");
    setPendingBulkUpdate({
      ids: selectedProductIds,
      payload,
    });
  }

  async function runBulkUpdate() {
    if (!pendingBulkUpdate) {
      return;
    }

    setBulkLoading(true);
    setBulkMessage("");

    const response = await fetch("/api/products/bulk", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: pendingBulkUpdate.ids,
        ...pendingBulkUpdate.payload,
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { updated?: number; stockMovements?: number; error?: string }
      | null;

    setBulkLoading(false);

    if (!response.ok) {
      setPendingBulkUpdate(null);
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
    setPendingBulkUpdate(null);
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

  async function downloadSelectedListingExcel() {
    // Checked items export just those; with nothing checked, export every product
    // that is sellable, image-ready, and not active on eBay.
    const body =
      selectedCount > 0
        ? { productIds: selectedProductIds }
        : { allUnlisted: true };

    setExportLoading(true);
    setBulkMessage("");

    try {
      const response = await fetch("/api/listing-upload/inventory/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setBulkMessage(data?.error ?? "이베이 CSV 다운로드에 실패했습니다.");
        return;
      }

      const date = new Date().toISOString().slice(0, 10);
      const exported = Number(response.headers.get("x-exported-count") ?? 0);
      const excluded = Number(response.headers.get("x-excluded-count") ?? 0);
      const reportImportedAt = response.headers.get("x-ebay-report-imported-at");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ebay-new-listings-ready-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setBulkMessage(
        `신규등록 CSV ${exported.toLocaleString()}개 생성${
          excluded > 0
            ? ` · 등록됨/공급불가/이미지·가격 미완료 ${excluded.toLocaleString()}개 제외`
            : ""
        }${
          reportImportedAt
            ? ` · eBay 보고서 ${new Date(reportImportedAt).toLocaleString("ko-KR")} 기준`
            : ""
        }`,
      );
    } catch {
      setBulkMessage("이베이 CSV 다운로드 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setExportLoading(false);
    }
  }

  async function downloadLensListingCsv() {
    setLensExportLoading(true);
    setBulkMessage("");

    try {
      const response = await fetch("/api/listing-upload/inventory/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lensOnly: true }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setBulkMessage(data?.error ?? "Lens 작업 상품 CSV 다운로드에 실패했습니다.");
        return;
      }

      const date = new Date().toISOString().slice(0, 10);
      const exported = Number(response.headers.get("x-exported-count") ?? 0);
      const reportImportedAt = response.headers.get("x-ebay-report-imported-at");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ebay-new-listings-lens-ready-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setBulkMessage(
        `Lens 승인·신규등록 가능 CSV ${exported.toLocaleString()}개 생성${
          reportImportedAt
            ? ` · eBay 보고서 ${new Date(reportImportedAt).toLocaleString("ko-KR")} 기준`
            : ""
        }`,
      );
    } catch {
      setBulkMessage("Lens 작업 상품 CSV 다운로드 중 오류가 발생했습니다.");
    } finally {
      setLensExportLoading(false);
    }
  }

  async function downloadCombinedListingCsv() {
    setCombinedExportLoading(true);
    setBulkMessage("");

    try {
      const response = await fetch("/api/listing-upload/inventory/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ combined: true }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setBulkMessage(data?.error ?? "판매가능 전체 CSV 다운로드에 실패했습니다.");
        return;
      }

      const date = new Date().toISOString().slice(0, 10);
      const exported = Number(response.headers.get("x-exported-count") ?? 0);
      const reportImportedAt = response.headers.get("x-ebay-report-imported-at");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ebay-new-listings-all-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setBulkMessage(
        `판매가능 전체 CSV ${exported.toLocaleString()}개 생성(신규등록+Lens 승인 포함)${
          reportImportedAt
            ? ` · eBay 보고서 ${new Date(reportImportedAt).toLocaleString("ko-KR")} 기준`
            : ""
        }`,
      );
    } catch {
      setBulkMessage("판매가능 전체 CSV 다운로드 중 오류가 발생했습니다.");
    } finally {
      setCombinedExportLoading(false);
    }
  }

  async function downloadOwnPhotoListingCsv() {
    setOwnPhotoExportLoading(true);
    setBulkMessage("");

    try {
      const response = await fetch("/api/listing-upload/inventory/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownPhotoOnly: true }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setBulkMessage(data?.error ?? "직접촬영 판매가능 CSV 다운로드에 실패했습니다.");
        return;
      }

      const date = new Date().toISOString().slice(0, 10);
      const exported = Number(response.headers.get("x-exported-count") ?? 0);
      const reportImportedAt = response.headers.get("x-ebay-report-imported-at");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ebay-new-listings-own-photo-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setBulkMessage(
        `직접촬영 판매가능 CSV ${exported.toLocaleString()}개 생성(촬영본·내 재고·미등록)${
          reportImportedAt
            ? ` · eBay 보고서 ${new Date(reportImportedAt).toLocaleString("ko-KR")} 기준`
            : ""
        }`,
      );
    } catch {
      setBulkMessage("직접촬영 판매가능 CSV 다운로드 중 오류가 발생했습니다.");
    } finally {
      setOwnPhotoExportLoading(false);
    }
  }

  const [ebayPushing, setEbayPushing] = useState(false);

  // eBay에 값을 쓰는 첫 기능이다. 무엇이 바뀌는지 먼저 보여 주고 사람이 확인한
  // 뒤에만 보낸다. 새 리스팅은 만들지 않고 가격과 수량만 바꾼다.
  async function pushSelectedToEbay() {
    if (!selectedCount) {
      setBulkMessage("eBay에 반영할 상품을 선택해 주세요.");
      return;
    }
    setEbayPushing(true);
    setBulkMessage("");
    try {
      const preview = await fetch("/api/ebay/inventory/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productIds: selectedProductIds, dryRun: true }),
      });
      const plan = await preview.json();
      if (!preview.ok) throw new Error(plan?.error ?? "미리보기에 실패했습니다.");
      if (!plan.planned) {
        setBulkMessage("선택 항목 중 eBay에 올라가 있는 활성 상품이 없습니다.");
        return;
      }

      const sample = (plan.rows ?? [])
        .slice(0, 5)
        .map(
          (row: { sku: string; stock: number; reserved: number; quantity: number; price: number | null }) =>
            `${row.sku}: 수량 ${row.quantity} (재고 ${row.stock} - 예약 ${row.reserved})${row.price ? ` · $${row.price.toFixed(2)}` : " · 가격 유지"}`,
        )
        .join("\n");
      const missing = plan.missingPrice?.length
        ? `\n\n가격을 정할 수 없어 수량만 바꾸는 상품 ${plan.missingPrice.length}개`
        : "";
      if (
        !window.confirm(
          `eBay 리스팅 ${plan.planned}개의 가격과 수량을 아래처럼 바꿉니다.\n\n${sample}${plan.planned > 5 ? `\n… 외 ${plan.planned - 5}개` : ""}${missing}\n\n리스팅을 새로 만들지는 않습니다. 진행할까요?`,
        )
      ) {
        setBulkMessage("취소했습니다. 아무것도 바꾸지 않았습니다.");
        return;
      }

      const response = await fetch("/api/ebay/inventory/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productIds: selectedProductIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "반영에 실패했습니다.");
      setBulkMessage(
        `eBay 반영 성공 ${data.succeeded}개 · 실패 ${data.failed?.length ?? 0}개` +
          (data.failed?.length
            ? ` (${data.failed.slice(0, 3).map((item: { itemId: string; reason: string }) => `${item.itemId}: ${item.reason}`).join(" / ")})`
            : ""),
      );
      router.refresh();
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setEbayPushing(false);
    }
  }

  async function runBulkShopifyUpload() {
    // Kept separate from the regular selection export so operators cannot
    // accidentally mix Pokamarket/direct-photo items into a Lens upload batch.
    if (!selectedCount) {
      setBulkMessage("쇼피파이에 업로드할 상품을 선택해 주세요.");
      return;
    }

    if (
      !window.confirm(
        `선택한 상품 ${selectedCount}개를 쇼피파이에 업로드할까요?\n\n순서대로 하나씩 업로드되며, 개수가 많으면 시간이 걸립니다.`,
      )
    ) {
      return;
    }

    setShopifyLoading(true);
    setBulkMessage("");

    const ids = selectedProductIds;
    let success = 0;
    let failed = 0;
    setShopifyProgress({
      total: ids.length,
      done: 0,
      success: 0,
      failed: 0,
      running: true,
    });

    // Shopify Admin REST는 초당 두 건까지만 받는다. 쉬지 않고 부르면 429가 나고
    // 그때부터 줄줄이 실패한다. 한 건에 여러 번 부르므로 넉넉히 띄운다.
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const reasons: string[] = [];

    for (let index = 0; index < ids.length; index += 1) {
      try {
        const response = await fetch(`/api/products/${ids[index]}/shopify-upload`, {
          method: "POST",
        });
        if (response.ok) {
          success += 1;
        } else {
          failed += 1;
          // 몇 개 실패했는지만 알면 무엇을 고쳐야 할지 알 수 없다. 사유를 남긴다.
          const body = await response.json().catch(() => null);
          if (reasons.length < 5) {
            reasons.push(body?.error ?? `HTTP ${response.status}`);
          }
        }
      } catch (error) {
        failed += 1;
        if (reasons.length < 5) {
          reasons.push(error instanceof Error ? error.message : String(error));
        }
      }

      setShopifyProgress({
        total: ids.length,
        done: index + 1,
        success,
        failed,
        running: index + 1 < ids.length,
      });

      if (index + 1 < ids.length) await wait(700);
    }

    setShopifyLoading(false);
    setBulkMessage(
      failed > 0
        ? `쇼피파이 업로드 완료: 성공 ${success}개, 실패 ${failed}개. ${reasons.join(" / ")}`
        : `쇼피파이 업로드 완료: ${success}개 모두 성공했습니다.`,
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
            {selectedCount === 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => void downloadCombinedListingCsv()}
                  disabled={combinedExportLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-800 bg-emerald-800 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  {combinedExportLoading
                    ? "전체 CSV 준비 중"
                    : "판매가능 전체 eBay CSV"}
                </button>
                <button
                  type="button"
                  onClick={() => void downloadLensListingCsv()}
                  disabled={lensExportLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-700 bg-violet-700 px-3 text-xs font-semibold text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  {lensExportLoading
                    ? "Lens CSV 준비 중"
                    : "Lens 승인·미등록 eBay CSV"}
                </button>
                <button
                  type="button"
                  onClick={() => void downloadOwnPhotoListingCsv()}
                  disabled={ownPhotoExportLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-700 bg-cyan-700 px-3 text-xs font-semibold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  {ownPhotoExportLoading
                    ? "직접촬영 CSV 준비 중"
                    : "직접촬영 판매가능 CSV"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void downloadSelectedListingExcel()}
                disabled={exportLoading || products.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-700 bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
              >
                <Download className="h-3.5 w-3.5" />
                {exportLoading
                  ? "CSV 준비 중"
                  : `선택 신규등록 CSV (${selectedCount}개)`}
              </button>
            )}
            <button
              type="button"
              onClick={() => void pushSelectedToEbay()}
              disabled={ebayPushing || !selectedCount}
              title="기존 eBay 리스팅의 가격과 수량만 바꿉니다. 새 리스팅은 만들지 않습니다."
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-600 bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {ebayPushing
                ? "eBay 반영 중"
                : `eBay 가격·수량 반영${selectedCount > 0 ? ` (${selectedCount}개)` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => void runBulkShopifyUpload()}
              disabled={shopifyLoading || !selectedCount}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              {shopifyLoading
                ? "쇼피파이 업로드 중"
                : `쇼피파이 업로드${selectedCount > 0 ? ` (${selectedCount}개)` : ""}`}
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
            {productStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => requestBulkUpdate({ status: bulkStatus })}
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
            onClick={() => requestBulkUpdate({ stockQuantity: bulkStock })}
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
            onClick={() => requestBulkUpdate({ salePrice: bulkPrice })}
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
                  memberOptions={groupMembers[(product.brand ?? "").trim()] ?? []}
                  shopifyStoreHandle={shopifyStoreHandle}
                  onSelectedChange={(checked) => toggleProduct(product.id, checked)}
                  onPhotoUploadClick={setPhotoTarget}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 md:hidden">
        {renderMobileCards
          ? products.map((product) => (
              <ProductQuickEditCard
                key={productEditKey(product)}
                product={product}
                selected={selectedIds.has(product.id)}
                memberOptions={groupMembers[(product.brand ?? "").trim()] ?? []}
                shopifyStoreHandle={shopifyStoreHandle}
                onSelectedChange={(checked) => toggleProduct(product.id, checked)}
                onPhotoUploadClick={setPhotoTarget}
              />
            ))
          : null}
      </section>

      {shopifyProgress ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-zinc-200 p-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-950">
                {shopifyProgress.running ? (
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                ) : (
                  <ShoppingBag className="h-4 w-4 text-emerald-600" />
                )}
                {shopifyProgress.running ? "쇼피파이 업로드 중…" : "쇼피파이 업로드 완료"}
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                {shopifyProgress.done} / {shopifyProgress.total}개 처리됨
              </p>
            </div>
            <div className="space-y-3 p-4">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                  style={{
                    width: `${
                      shopifyProgress.total
                        ? Math.round((shopifyProgress.done / shopifyProgress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div className="flex gap-4 text-sm font-medium">
                <span className="text-emerald-700">성공 {shopifyProgress.success}개</span>
                <span className={shopifyProgress.failed ? "text-rose-600" : "text-zinc-400"}>
                  실패 {shopifyProgress.failed}개
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                {shopifyProgress.running
                  ? "완료될 때까지 이 창을 닫지 마세요."
                  : shopifyProgress.failed > 0
                    ? "실패한 상품은 상세페이지에서 오류를 확인하세요."
                    : "모든 상품이 쇼피파이에 업로드됐습니다."}
              </p>
            </div>
            <div className="flex justify-end border-t border-zinc-200 p-4">
              <button
                type="button"
                onClick={() => setShopifyProgress(null)}
                disabled={shopifyProgress.running}
                className="h-9 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {shopifyProgress.running ? "진행 중…" : "닫기"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingBulkUpdate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-zinc-200 p-4">
              <h2 className="text-base font-semibold text-zinc-950">
                일괄 수정 확인
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                선택한 상품 {pendingBulkUpdate.ids.length}개에 아래 변경을 적용합니다.
              </p>
            </div>
            <div className="space-y-3 p-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                이 작업은 선택 상품 전체에 같은 값을 적용합니다. 적용 전 선택 수와 변경 값을 확인하세요.
              </div>
              <ul className="space-y-2 text-sm text-zinc-800">
                {bulkUpdateChanges(pendingBulkUpdate.payload).map((change) => (
                  <li key={change} className="rounded-md bg-zinc-50 px-3 py-2">
                    {change}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-200 p-4">
              <button
                type="button"
                onClick={() => setPendingBulkUpdate(null)}
                disabled={bulkLoading}
                className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void runBulkUpdate()}
                disabled={bulkLoading}
                className="h-9 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
              >
                {bulkLoading ? "적용 중..." : "확인 후 적용"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const sourceImageUrl =
    product.sourceImageUrl ?? (product.userImageRegistered ? null : product.imageUrl);
  // Cache-bust with a stable timestamp so the browser never serves a stale proxy response.
  // Using module-load time keeps it constant within a session but changes on hard-refresh.
  const [cacheBust] = useState(() => Date.now());
  const currentFrontUrl = product.userImageRegistered
    ? `/api/products/image-match/assets/${product.id}/front?t=${cacheBust}`
    : null;
  const currentBackUrl = product.hasBackImage
    ? `/api/products/image-match/assets/${product.id}/back?t=${cacheBust}`
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

    setProcessing(true);
    setMessage("이미지를 최적화하는 중입니다.");
    try {
      const dataUrl = await fileToOptimizedDataUrl(file);

      if (side === "front") {
        setFrontImageUrl(dataUrl);
        setActiveSide("back");
      } else {
        setBackImageUrl(dataUrl);
        setActiveSide("front");
      }

      setMessage(`${side === "front" ? "앞면" : "뒷면"} 촬영본이 준비되었습니다.`);
    } finally {
      setProcessing(false);
    }
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
        (product.userImageRegistered
          ? await imageUrlToDataUrl(`/api/products/image-match/assets/${product.id}/front`)
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
            {currentBackUrl ? (
              <ReadonlyPreview title="현재 촬영본 뒷면" src={currentBackUrl} />
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
              disabled={saving || processing || (!frontImageUrl && !product.userImageRegistered)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {saving || processing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {processing ? "이미지 준비 중..." : "촬영본 저장"}
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
