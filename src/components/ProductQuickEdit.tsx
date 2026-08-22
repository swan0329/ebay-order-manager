/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, PackageOpen, Save } from "lucide-react";
import {
  normalizeProductStatus,
  productStatusOptions,
} from "@/lib/product-status";

export type ProductQuickEditValue = {
  id: string;
  sku: string;
  internalCode: string | null;
  productName: string;
  optionName: string | null;
  category: string | null;
  brand: string | null;
  costPrice: string | null;
  salePrice: string | null;
  isSoldOut?: boolean;
  pocamarketAvailableCount?: number | null;
  pocamarketSyncedAt?: string | null;
  pocamarketChangeStatus?: string | null;
  pocamarketPreviousPrice?: string | null;
  pocamarketPreviousAvailableCount?: number | null;
  ebayPrice: string | null;
  stockQuantity: number;
  location: string | null;
  memo: string | null;
  imageUrl: string | null;
  sourceImageUrl: string | null;
  imageSource: string | null;
  userImageRegistered: boolean;
  hasBackImage: boolean;
  imageWorkReady?: boolean;
  procurementSellable?: boolean;
  imageUpdatedAt?: string | null;
  status: string;
  featuredMembers: string | null;
  shopifyProductId: string | null;
  shopifyLastUploadedAt: string | null;
  ebayItemId?: string | null;
  listingStatus?: string | null;
  lastUploadedAt?: string | null;
  variationItemId?: string | null;
  variationTitle?: string | null;
};

function parseMembers(value: string | null | undefined) {
  return String(value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

// Member picker for "unit" cards — pick the real members from the group's roster.
// Non-unit rows just show the value (or "-"). Saves immediately via its own POST.
function MemberPicker({
  productId,
  isUnit,
  value,
  options,
}: {
  productId: string;
  isUnit: boolean;
  value: string | null;
  options: string[];
}) {
  const [members, setMembers] = useState(() => parseMembers(value));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setMembers(parseMembers(value)), 0);
    return () => window.clearTimeout(timer);
  }, [value]);

  async function commit(next: string[]) {
    setMembers(next);
    setSaving(true);
    try {
      await fetch("/api/inventory/featured-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, members: next }),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!isUnit) {
    return <span className="text-xs text-zinc-400">{members.join(", ") || "-"}</span>;
  }

  return (
    <div className="space-y-1">
      {members.length ? (
        <div className="flex flex-wrap gap-1">
          {members.map((member) => (
            <span
              key={member}
              className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-zinc-800 ring-1 ring-amber-200"
            >
              {member}
              <button
                type="button"
                onClick={() => void commit(members.filter((name) => name !== member))}
                disabled={saving}
                aria-label={`${member} 제거`}
                className="text-zinc-400 hover:text-rose-600 disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <select
        value=""
        onChange={(event) => {
          const picked = event.currentTarget.value;
          if (picked && !members.includes(picked)) {
            void commit([...members, picked]);
          }
          event.currentTarget.value = "";
        }}
        disabled={saving || options.length === 0}
        className="h-8 w-full rounded-md border border-amber-300 bg-white px-2 text-xs outline-none focus:border-amber-500 disabled:opacity-50"
      >
        <option value="">{options.length ? "+ 멤버 추가" : "멤버 불러오는 중…"}</option>
        {options
          .filter((member) => !members.includes(member))
          .map((member) => (
            <option key={member} value={member}>
              {member}
            </option>
          ))}
      </select>
    </div>
  );
}

type EditableState = {
  productName: string;
  brand: string;
  category: string;
  optionName: string;
  stockQuantity: string;
  salePrice: string;
  ebayPrice: string;
  memo: string;
  status: string;
};

function toState(product: ProductQuickEditValue): EditableState {
  return {
    productName: product.productName,
    brand: product.brand ?? "",
    category: product.category ?? "",
    optionName: product.optionName ?? "",
    stockQuantity: String(product.stockQuantity),
    salePrice: product.salePrice ?? "",
    ebayPrice: product.ebayPrice ?? "",
    memo: product.memo ?? "",
    status: normalizeProductStatus(product.status),
  };
}

function editableStateKey(value: EditableState) {
  return [
    value.productName,
    value.brand,
    value.category,
    value.optionName,
    value.stockQuantity,
    value.salePrice,
    value.ebayPrice,
    value.memo,
    value.status,
  ].join("\x1f");
}

function sameEditableState(left: EditableState, right: EditableState) {
  return editableStateKey(left) === editableStateKey(right);
}

function fieldClass(extra = "") {
  return `h-9 w-full min-w-0 rounded-md border border-zinc-300 px-2 text-xs outline-none focus:border-zinc-900 ${extra}`;
}

const defaultVisibleColumnIds = [
  "select",
  "sku",
  "stockQuantity",
  "brand",
  "category",
  "optionName",
  "featuredMembers",
  "imageUrl",
  "ebayPrice",
  "salePrice",
  "pocamarketStock",
  "pocamarketSyncedAt",
  "memo",
  "productName",
  "status",
  "shopify",
  "save",
];

// Shopify admin product URL — the official unified-admin deep link. (The
// legacy <store>.myshopify.com/admin path can redirect-loop on stores with a
// custom primary domain, so we link admin.shopify.com directly.)
function shopifyAdminUrl(storeHandle: string | null, productId: string) {
  if (!storeHandle) return null;
  return `https://admin.shopify.com/store/${storeHandle}/products/${productId}`;
}

function ShopifyStatusCell({
  product,
  storeHandle,
}: {
  product: ProductQuickEditValue;
  storeHandle: string | null;
}) {
  if (!product.shopifyProductId) {
    return (
      <span className="inline-flex w-fit items-center rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500">
        미업로드
      </span>
    );
  }

  const adminUrl = shopifyAdminUrl(storeHandle, product.shopifyProductId);

  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex w-fit items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
        업로드됨
      </span>
      {product.shopifyLastUploadedAt ? (
        <span className="text-[10px] text-zinc-400">
          {new Date(product.shopifyLastUploadedAt).toLocaleDateString("ko-KR")}
        </span>
      ) : null}
      {adminUrl ? (
        <a
          href={adminUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit text-[11px] text-emerald-700 underline-offset-2 hover:underline"
        >
          쇼피파이에서 보기 ↗
        </a>
      ) : null}
    </div>
  );
}

function PhotoThumb({
  src,
  label,
  registered,
  showCamera,
  sizeClass,
  onClick,
}: {
  src: string | null;
  label: string;
  registered: boolean;
  showCamera: boolean;
  sizeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 ring-1 ring-zinc-200 transition hover:ring-zinc-900`}
      title="촬영본 등록"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <PackageOpen className="h-5 w-5 text-zinc-400" />
      )}
      <span
        className={`absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-semibold shadow-sm ${
          registered ? "bg-emerald-600 text-white" : "bg-zinc-950 text-white"
        }`}
      >
        {label}
      </span>
      {showCamera ? (
        <span className="absolute right-1 top-1 rounded bg-white/90 p-1 text-zinc-700 opacity-0 shadow-sm transition group-hover:opacity-100">
          <Camera className="h-3 w-3" />
        </span>
      ) : null}
    </button>
  );
}

function ProductImageButton({
  product,
  sizeClass,
  onClick,
}: {
  product: ProductQuickEditValue;
  sizeClass: string;
  onClick: () => void;
}) {
  const t = product.imageUpdatedAt ? new Date(product.imageUpdatedAt).getTime() : null;
  const frontUrl = product.userImageRegistered && t
    ? `/api/products/image-match/assets/${product.id}/front?t=${t}`
    : (product.sourceImageUrl ?? product.imageUrl);
  const backUrl = product.hasBackImage && t
    ? `/api/products/image-match/assets/${product.id}/back?t=${t}`
    : null;

  if (backUrl) {
    return (
      <div className="flex gap-1">
        <PhotoThumb
          src={frontUrl}
          label="앞"
          registered
          showCamera={false}
          sizeClass={sizeClass}
          onClick={onClick}
        />
        <PhotoThumb
          src={backUrl}
          label="뒤"
          registered
          showCamera
          sizeClass={sizeClass}
          onClick={onClick}
        />
      </div>
    );
  }

  return (
    <PhotoThumb
      src={frontUrl}
      label={product.userImageRegistered ? "앞면" : "촬영"}
      registered={product.userImageRegistered}
      showCamera
      sizeClass={sizeClass}
      onClick={onClick}
    />
  );
}

export function ProductQuickEditRow({
  product,
  visibleColumnIds = defaultVisibleColumnIds,
  selected = false,
  memberOptions = [],
  shopifyStoreHandle = null,
  onSelectedChange,
  onPhotoUploadClick,
}: {
  product: ProductQuickEditValue;
  visibleColumnIds?: string[];
  selected?: boolean;
  memberOptions?: string[];
  shopifyStoreHandle?: string | null;
  onSelectedChange?: (checked: boolean) => void;
  onPhotoUploadClick?: (product: ProductQuickEditValue) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(() => toState(product));
  const [savedValue, setSavedValue] = useState(() => toState(product));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const visibleColumns = new Set(visibleColumnIds);
  const dirty = !sameEditableState(value, savedValue);

  function setField(key: keyof EditableState, nextValue: string) {
    setMessage("");
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  function saveOnEnter(
    event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  }

  async function save() {
    if (saving || !dirty) {
      return;
    }

    const submittedValue = value;
    setSaving(true);
    setMessage("");

    const response = await fetch(`/api/products/${product.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku: product.sku,
        internalCode: product.internalCode,
        productName: submittedValue.productName,
        optionName: submittedValue.optionName,
        category: submittedValue.category,
        brand: submittedValue.brand,
        costPrice: product.costPrice,
        salePrice: submittedValue.salePrice,
        ebayPrice: submittedValue.ebayPrice,
        stockQuantity: submittedValue.stockQuantity,
        location: product.location,
        memo: submittedValue.memo,
        imageUrl: product.imageUrl,
        status: submittedValue.status,
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    setSaving(false);

    if (!response.ok) {
      setMessage(data?.error ?? "저장 실패");
      return;
    }

    setSavedValue(submittedValue);
    setMessage("저장됨");
    router.refresh();
  }

  return (
    <tr className="align-top hover:bg-zinc-50">
      {visibleColumns.has("select") ? (
        <td className="px-2 py-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange?.(event.currentTarget.checked)}
            aria-label={`${product.sku} 선택`}
            className="h-4 w-4 rounded border-zinc-300"
          />
        </td>
      ) : null}
      {visibleColumns.has("imageSource") ? (
        <td className="px-2 py-3">
          {product.userImageRegistered ? (
            <span className="inline-flex rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">직접 촬영</span>
          ) : product.imageSource === "lens_workbench" ? (
            <span className="inline-flex rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">Lens 작업</span>
          ) : (
            <span className="inline-flex rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">포카마켓</span>
          )}
        </td>
      ) : null}
      {visibleColumns.has("sku") ? (
        <td className="px-2 py-3 font-medium text-zinc-900">
          <Link
            href={`/products/${product.id}`}
            prefetch={false}
            className="block truncate hover:underline"
            title={product.sku}
          >
            {product.sku}
          </Link>
          {dirty ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="mt-2 inline-flex h-7 items-center gap-1 rounded-md bg-zinc-950 px-2 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
            >
              <Save className="h-3 w-3" />
              저장
            </button>
          ) : message ? (
            <p className="mt-2 text-xs text-zinc-500">{message}</p>
          ) : null}
        </td>
      ) : null}
      {visibleColumns.has("stockQuantity") ? (
        <td className="px-2 py-3">
          <input
            value={value.stockQuantity}
            onChange={(event) => setField("stockQuantity", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            type="number"
            min="0"
            className={fieldClass()}
          />
          {dirty ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="mt-1 inline-flex h-7 w-full items-center justify-center rounded-md bg-zinc-950 px-2 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
            >
              저장
            </button>
          ) : null}
        </td>
      ) : null}
      {visibleColumns.has("sellability") ? (
        <td className="px-2 py-3 text-xs">
          {product.stockQuantity > 0 && product.imageWorkReady ? (
            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">
              보유재고 판매
            </span>
          ) : product.procurementSellable ? (
            <span className="inline-flex rounded-full bg-violet-100 px-2 py-1 font-semibold text-violet-800">
              포카 조달판매
            </span>
          ) : product.stockQuantity > 0 ||
            (product.pocamarketAvailableCount ?? 0) > 0 ? (
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">
              이미지 작업 필요
            </span>
          ) : !product.pocamarketSyncedAt ? (
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">
              최신화 필요
            </span>
          ) : product.ebayItemId &&
            ["ACTIVE", "PUBLISHED", "LISTED"].includes(
              (product.listingStatus ?? "ACTIVE").toUpperCase(),
            ) ? (
            <span className="inline-flex rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-800">
              판매중단 필요
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-zinc-200 px-2 py-1 font-semibold text-zinc-700">
              품절
            </span>
          )}
        </td>
      ) : null}
      {visibleColumns.has("uploadStatus") ? (
        <td className="px-2 py-3 text-xs">
          {product.variationItemId ? (
            <>
              <span className="inline-flex rounded-full bg-violet-100 px-2 py-1 font-semibold text-violet-800">
                {product.ebayItemId && ["ACTIVE", "PUBLISHED", "LISTED"].includes((product.listingStatus ?? "").toUpperCase())
                  ? "단품+묶음 중복 판매"
                  : "묶음 옵션 판매중"}
              </span>
              <span className="mt-1 block text-zinc-500">
                {product.variationTitle} · {product.variationItemId}
              </span>
            </>
          ) : product.ebayItemId ? (
            <>
              <span className="inline-flex rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-800">
                eBay 등록정보 연결됨
              </span>
              <span className="mt-1 block text-zinc-500">
                {product.listingStatus || "등록됨"}
              </span>
            </>
          ) : (
            <span className="inline-flex rounded-full bg-zinc-100 px-2 py-1 font-semibold text-zinc-700">
              eBay 등록정보 미연결
            </span>
          )}
        </td>
      ) : null}
      {visibleColumns.has("brand") ? (
        <td className="px-2 py-3">
          <input
            value={value.brand}
            onChange={(event) => setField("brand", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("category") ? (
        <td className="px-2 py-3">
          <input
            value={value.category}
            onChange={(event) => setField("category", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("optionName") ? (
        <td className="px-2 py-3">
          <input
            value={value.optionName}
            onChange={(event) => setField("optionName", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("featuredMembers") ? (
        <td className="px-2 py-3 align-top">
          <MemberPicker
            productId={product.id}
            isUnit={value.optionName.trim().toLowerCase() === "unit"}
            value={product.featuredMembers}
            options={memberOptions}
          />
        </td>
      ) : null}
      {visibleColumns.has("imageUrl") ? (
        <td className="px-2 py-3">
          <ProductImageButton
            product={product}
            sizeClass="h-16 w-16"
            onClick={() => onPhotoUploadClick?.(product)}
          />
        </td>
      ) : null}
      {visibleColumns.has("ebayPrice") ? (
        <td className="px-2 py-3">
          <input
            value={value.ebayPrice}
            onChange={(event) => setField("ebayPrice", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            type="number"
            min="0"
            step="0.01"
            placeholder="$"
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("salePrice") ? (
        <td className="px-2 py-3">
          {product.pocamarketPreviousPrice &&
          Number(product.pocamarketPreviousPrice) !== Number(product.salePrice) ? (
            <span className={`mb-1 block text-[11px] font-semibold ${
              Number(product.salePrice) > Number(product.pocamarketPreviousPrice)
                ? "text-rose-600"
                : "text-blue-600"
            }`}>
              {Number(product.salePrice) > Number(product.pocamarketPreviousPrice)
                ? "가격 상승"
                : "가격 하락"}
            </span>
          ) : null}
          <input
            value={value.salePrice}
            onChange={(event) => setField("salePrice", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            type="number"
            min="0"
            step="0.01"
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("pocamarketStock") ? (
        <td className="px-2 py-3 text-xs">
          {product.pocamarketAvailableCount === null ||
          product.pocamarketAvailableCount === undefined ? (
            <span className="text-zinc-400">미확인</span>
          ) : product.isSoldOut || product.pocamarketAvailableCount === 0 ? (
            <span className="font-semibold text-rose-600">품절 (0)</span>
          ) : (
            <>
              <span className="font-semibold text-emerald-700">
                {product.pocamarketAvailableCount.toLocaleString()}개 매물
              </span>
              {product.pocamarketPreviousAvailableCount !== null &&
              product.pocamarketPreviousAvailableCount !== undefined &&
              product.pocamarketPreviousAvailableCount !==
                product.pocamarketAvailableCount ? (
                <span className="mt-1 block text-[11px] text-amber-700">
                  이전 {product.pocamarketPreviousAvailableCount.toLocaleString()}개
                </span>
              ) : null}
            </>
          )}
        </td>
      ) : null}
      {visibleColumns.has("pocamarketSyncedAt") ? (
        <td className="px-2 py-3 text-xs text-zinc-600">
          {product.pocamarketSyncedAt
            ? new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(new Date(product.pocamarketSyncedAt))
            : "미확인"}
        </td>
      ) : null}
      {visibleColumns.has("memo") ? (
        <td className="px-2 py-3">
          <input
            value={value.memo}
            onChange={(event) => setField("memo", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("productName") ? (
        <td className="px-2 py-3">
          <input
            value={value.productName}
            onChange={(event) => setField("productName", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("status") ? (
        <td className="px-2 py-3">
          <select
            value={value.status}
            onChange={(event) => setField("status", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass("text-sm")}
          >
            {productStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </td>
      ) : null}
      {visibleColumns.has("shopify") ? (
        <td className="px-2 py-3">
          <ShopifyStatusCell product={product} storeHandle={shopifyStoreHandle} />
        </td>
      ) : null}
      {visibleColumns.has("save") ? (
        <td className="px-2 py-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            title={dirty ? "저장" : "변경 없음"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
          >
            <Save className="h-4 w-4" />
          </button>
          {message ? <p className="mt-1 text-xs text-zinc-500">{message}</p> : null}
        </td>
      ) : null}
    </tr>
  );
}

export function ProductQuickEditCard({
  product,
  selected = false,
  memberOptions = [],
  shopifyStoreHandle = null,
  onSelectedChange,
  onPhotoUploadClick,
}: {
  product: ProductQuickEditValue;
  selected?: boolean;
  memberOptions?: string[];
  shopifyStoreHandle?: string | null;
  onSelectedChange?: (checked: boolean) => void;
  onPhotoUploadClick?: (product: ProductQuickEditValue) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(() => toState(product));
  const [savedValue, setSavedValue] = useState(() => toState(product));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = !sameEditableState(value, savedValue);

  function setField(key: keyof EditableState, nextValue: string) {
    setMessage("");
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  function saveOnEnter(
    event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  }

  async function save() {
    if (saving || !dirty) {
      return;
    }

    const submittedValue = value;
    setSaving(true);
    setMessage("");

    const response = await fetch(`/api/products/${product.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku: product.sku,
        internalCode: product.internalCode,
        productName: submittedValue.productName,
        optionName: submittedValue.optionName,
        category: submittedValue.category,
        brand: submittedValue.brand,
        costPrice: product.costPrice,
        salePrice: submittedValue.salePrice,
        ebayPrice: submittedValue.ebayPrice,
        stockQuantity: submittedValue.stockQuantity,
        location: product.location,
        memo: submittedValue.memo,
        imageUrl: product.imageUrl,
        status: submittedValue.status,
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    setSaving(false);

    if (!response.ok) {
      setMessage(data?.error ?? "저장 실패");
      return;
    }

    setSavedValue(submittedValue);
    setMessage("저장됨");
    router.refresh();
  }

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4">
      <label className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-700">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange?.(event.currentTarget.checked)}
          className="h-4 w-4 rounded border-zinc-300"
        />
        선택
      </label>
      <div className="mb-3 flex gap-3">
        <ProductImageButton
          product={product}
          sizeClass="h-20 w-20 shrink-0"
          onClick={() => onPhotoUploadClick?.(product)}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/products/${product.id}`}
            prefetch={false}
            className="text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline"
          >
            {product.sku}
          </Link>
          <input
            value={value.productName}
            onChange={(event) => setField("productName", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={`${fieldClass()} mt-2`}
          />
          {dirty ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="mt-2 inline-flex h-8 items-center gap-2 rounded-md bg-zinc-950 px-3 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
            >
              <Save className="h-4 w-4" />
              변경 저장
            </button>
          ) : null}
          <div className="mt-2">
            <ShopifyStatusCell product={product} storeHandle={shopifyStoreHandle} />
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={value.stockQuantity}
          onChange={(event) => setField("stockQuantity", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          type="number"
          min="0"
          className={fieldClass()}
          aria-label="재고"
        />
        <select
          value={value.status}
          onChange={(event) => setField("status", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          className={fieldClass()}
          aria-label="상태"
        >
          {productStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={value.brand}
          onChange={(event) => setField("brand", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          className={fieldClass()}
          aria-label="그룹명"
        />
        <input
          value={value.optionName}
          onChange={(event) => setField("optionName", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          className={fieldClass()}
          aria-label="멤버"
        />
        <input
          value={value.category}
          onChange={(event) => setField("category", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          className={`${fieldClass()} sm:col-span-2`}
          aria-label="앨범명"
        />
        <input
          value={value.ebayPrice}
          onChange={(event) => setField("ebayPrice", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          type="number"
          min="0"
          step="0.01"
          placeholder="$"
          className={fieldClass()}
          aria-label="달러 가격 (USD)"
        />
        <input
          value={value.salePrice}
          onChange={(event) => setField("salePrice", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          type="number"
          min="0"
          step="0.01"
          className={fieldClass()}
          aria-label="포카마켓 가격"
        />
        <input
          value={value.memo}
          onChange={(event) => setField("memo", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          className={fieldClass()}
          aria-label="원본 앨범명"
        />
      </div>
      {value.optionName.trim().toLowerCase() === "unit" ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2">
          <p className="mb-1 text-xs font-semibold text-amber-800">유닛 — 포함 멤버 지정</p>
          <MemberPicker
            productId={product.id}
            isUnit
            value={product.featuredMembers}
            options={memberOptions}
          />
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        {message ? <p className="text-xs text-zinc-500">{message}</p> : null}
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
        >
          <Save className="h-4 w-4" />
          저장
        </button>
      </div>
    </article>
  );
}
