"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type InventoryProduct = {
  id: string;
  sku: string;
  productName: string;
  stockQuantity: number;
};

export function InventoryMovementForm({ products }: { products: InventoryProduct[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState("IN");
  const productOptions = useMemo(
    () =>
      products.map((product) => ({
        value: product.id,
        label: `${product.sku} · ${product.productName} (${product.stockQuantity})`,
      })),
    [products],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/inventory/movement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    setLoading(false);
    setMessage(response.ok ? "재고 이동이 저장되었습니다." : data?.error ?? "처리 실패");
    if (response.ok) {
      event.currentTarget.reset();
      setType("IN");
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="mb-4 text-base font-semibold text-zinc-950">재고 처리</h2>
      <div className="grid gap-3 lg:grid-cols-[1fr_140px_140px_1fr_auto]">
        <select
          name="productId"
          required
          className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
        >
          <option value="">상품 선택</option>
          {productOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          name="type"
          value={type}
          onChange={(event) => setType(event.currentTarget.value)}
          className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
        >
          <option value="IN">입고</option>
          <option value="OUT">출고</option>
          <option value="ADJUST">조정</option>
        </select>
        <input
          name="quantity"
          type="number"
          min="0"
          required
          placeholder={type === "ADJUST" ? "조정 후 재고" : "수량"}
          className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
        />
        <input
          name="reason"
          placeholder="사유"
          className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
        >
          {loading ? "처리 중" : "저장"}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-zinc-600">{message}</p> : null}
    </form>
  );
}
