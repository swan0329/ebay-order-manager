/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackageOpen, Save } from "lucide-react";

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
  stockQuantity: number;
  safetyStock: number;
  location: string | null;
  memo: string | null;
  imageUrl: string | null;
  status: string;
};

type EditableState = {
  productName: string;
  brand: string;
  category: string;
  optionName: string;
  stockQuantity: string;
  salePrice: string;
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
    memo: product.memo ?? "",
    status: product.status,
  };
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
  "imageUrl",
  "salePrice",
  "memo",
  "productName",
  "status",
  "save",
];

export function ProductQuickEditRow({
  product,
  visibleColumnIds = defaultVisibleColumnIds,
  selected = false,
  onSelectedChange,
}: {
  product: ProductQuickEditValue;
  visibleColumnIds?: string[];
  selected?: boolean;
  onSelectedChange?: (checked: boolean) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(() => toState(product));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const visibleColumns = new Set(visibleColumnIds);

  function setField(key: keyof EditableState, nextValue: string) {
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  async function save() {
    setSaving(true);
    setMessage("");

    const response = await fetch(`/api/products/${product.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku: product.sku,
        internalCode: product.internalCode,
        productName: value.productName,
        optionName: value.optionName,
        category: value.category,
        brand: value.brand,
        costPrice: product.costPrice,
        salePrice: value.salePrice,
        stockQuantity: value.stockQuantity,
        safetyStock: product.safetyStock,
        location: product.location,
        memo: value.memo,
        imageUrl: product.imageUrl,
        status: value.status,
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
      {visibleColumns.has("sku") ? (
        <td className="px-2 py-3 font-medium text-zinc-900">
          <Link
            href={`/products/${product.id}`}
            className="block truncate hover:underline"
            title={product.sku}
          >
            {product.sku}
          </Link>
        </td>
      ) : null}
      {visibleColumns.has("stockQuantity") ? (
        <td className="px-2 py-3">
          <input
            value={value.stockQuantity}
            onChange={(event) => setField("stockQuantity", event.currentTarget.value)}
            type="number"
            min="0"
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("brand") ? (
        <td className="px-2 py-3">
          <input
            value={value.brand}
            onChange={(event) => setField("brand", event.currentTarget.value)}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("category") ? (
        <td className="px-2 py-3">
          <input
            value={value.category}
            onChange={(event) => setField("category", event.currentTarget.value)}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("optionName") ? (
        <td className="px-2 py-3">
          <input
            value={value.optionName}
            onChange={(event) => setField("optionName", event.currentTarget.value)}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("imageUrl") ? (
        <td className="px-2 py-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center overflow-hidden rounded-md bg-zinc-100">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <PackageOpen className="h-5 w-5 text-zinc-400" />
            )}
          </div>
        </td>
      ) : null}
      {visibleColumns.has("salePrice") ? (
        <td className="px-2 py-3">
          <input
            value={value.salePrice}
            onChange={(event) => setField("salePrice", event.currentTarget.value)}
            type="number"
            min="0"
            step="0.01"
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("memo") ? (
        <td className="px-2 py-3">
          <input
            value={value.memo}
            onChange={(event) => setField("memo", event.currentTarget.value)}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("productName") ? (
        <td className="px-2 py-3">
          <input
            value={value.productName}
            onChange={(event) => setField("productName", event.currentTarget.value)}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("status") ? (
        <td className="px-2 py-3">
          <select
            value={value.status}
            onChange={(event) => setField("status", event.currentTarget.value)}
            className={fieldClass("text-sm")}
          >
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
            <option value="sold_out">품절</option>
          </select>
        </td>
      ) : null}
      {visibleColumns.has("save") ? (
        <td className="px-2 py-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            title="저장"
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
  onSelectedChange,
}: {
  product: ProductQuickEditValue;
  selected?: boolean;
  onSelectedChange?: (checked: boolean) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(() => toState(product));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function setField(key: keyof EditableState, nextValue: string) {
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  async function save() {
    setSaving(true);
    setMessage("");

    const response = await fetch(`/api/products/${product.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku: product.sku,
        internalCode: product.internalCode,
        productName: value.productName,
        optionName: value.optionName,
        category: value.category,
        brand: value.brand,
        costPrice: product.costPrice,
        salePrice: value.salePrice,
        stockQuantity: value.stockQuantity,
        safetyStock: product.safetyStock,
        location: product.location,
        memo: value.memo,
        imageUrl: product.imageUrl,
        status: value.status,
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
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <PackageOpen className="h-6 w-6 text-zinc-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/products/${product.id}`}
            className="text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline"
          >
            {product.sku}
          </Link>
          <input
            value={value.productName}
            onChange={(event) => setField("productName", event.currentTarget.value)}
            className={`${fieldClass()} mt-2`}
          />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={value.stockQuantity}
          onChange={(event) => setField("stockQuantity", event.currentTarget.value)}
          type="number"
          min="0"
          className={fieldClass()}
          aria-label="재고"
        />
        <select
          value={value.status}
          onChange={(event) => setField("status", event.currentTarget.value)}
          className={fieldClass()}
          aria-label="상태"
        >
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
          <option value="sold_out">품절</option>
        </select>
        <input
          value={value.brand}
          onChange={(event) => setField("brand", event.currentTarget.value)}
          className={fieldClass()}
          aria-label="그룹명"
        />
        <input
          value={value.optionName}
          onChange={(event) => setField("optionName", event.currentTarget.value)}
          className={fieldClass()}
          aria-label="멤버"
        />
        <input
          value={value.category}
          onChange={(event) => setField("category", event.currentTarget.value)}
          className={`${fieldClass()} sm:col-span-2`}
          aria-label="앨범명"
        />
        <input
          value={value.salePrice}
          onChange={(event) => setField("salePrice", event.currentTarget.value)}
          type="number"
          min="0"
          step="0.01"
          className={fieldClass()}
          aria-label="포카마켓 가격"
        />
        <input
          value={value.memo}
          onChange={(event) => setField("memo", event.currentTarget.value)}
          className={fieldClass()}
          aria-label="원본 앨범명"
        />
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {message ? <p className="text-xs text-zinc-500">{message}</p> : null}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
        >
          <Save className="h-4 w-4" />
          저장
        </button>
      </div>
    </article>
  );
}
