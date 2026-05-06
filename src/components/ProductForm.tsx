"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ProductFormValues = {
  id?: string;
  sku?: string;
  internalCode?: string | null;
  productName?: string;
  optionName?: string | null;
  category?: string | null;
  brand?: string | null;
  costPrice?: string | number | null;
  salePrice?: string | number | null;
  stockQuantity?: number;
  safetyStock?: number;
  location?: string | null;
  memo?: string | null;
  imageUrl?: string | null;
  status?: string;
};

function valueOf(value: unknown) {
  return value == null ? "" : String(value);
}

export function ProductForm({ product }: { product?: ProductFormValues }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = Boolean(product?.id);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSaving(true);

    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    const response = await fetch(
      editing ? `/api/products/${product?.id}` : "/api/products",
      {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = (await response.json().catch(() => null)) as
      | { product?: { id: string }; error?: string }
      | null;

    setSaving(false);

    if (!response.ok) {
      setMessage(data?.error ?? "저장 실패");
      return;
    }

    router.push(`/products/${data?.product?.id ?? product?.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-zinc-950">기본 정보</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">SKU</span>
            <input
              name="sku"
              required
              defaultValue={product?.sku}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              내부코드
            </span>
            <input
              name="internalCode"
              defaultValue={valueOf(product?.internalCode)}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              상품명
            </span>
            <input
              name="productName"
              required
              defaultValue={product?.productName}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              멤버
            </span>
            <input
              name="optionName"
              defaultValue={valueOf(product?.optionName)}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">상태</span>
            <select
              name="status"
              defaultValue={product?.status ?? "active"}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            >
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
              <option value="sold_out">품절</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              앨범명
            </span>
            <input
              name="category"
              defaultValue={valueOf(product?.category)}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">그룹명</span>
            <input
              name="brand"
              defaultValue={valueOf(product?.brand)}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              이미지 URL
            </span>
            <input
              name="imageUrl"
              defaultValue={valueOf(product?.imageUrl)}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">위치</span>
            <input
              name="location"
              defaultValue={valueOf(product?.location)}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-zinc-950">가격/재고</h2>
        <div className="grid gap-4 md:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">원가</span>
            <input
              name="costPrice"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valueOf(product?.costPrice)}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">포카마켓 가격</span>
            <input
              name="salePrice"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valueOf(product?.salePrice)}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">재고</span>
            <input
              name="stockQuantity"
              type="number"
              min="0"
              defaultValue={product?.stockQuantity ?? 0}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              안전재고
            </span>
            <input
              name="safetyStock"
              type="number"
              min="0"
              defaultValue={product?.safetyStock ?? 0}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">
            원본 앨범명/메모
          </span>
          <textarea
            name="memo"
            defaultValue={valueOf(product?.memo)}
            rows={4}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
          />
        </label>
      </section>

      {message ? <p className="text-sm text-rose-600">{message}</p> : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="h-10 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
        >
          {saving ? "저장 중" : "저장"}
        </button>
      </div>
    </form>
  );
}
