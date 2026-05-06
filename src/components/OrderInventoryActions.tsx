"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type MatchProduct = {
  id: string;
  sku: string;
  productName: string;
  stockQuantity: number;
};

export function OrderItemProductMatcher({
  orderId,
  orderItemId,
  productId,
  products,
  disabled,
}: {
  orderId: string;
  orderItemId: string;
  productId?: string | null;
  products: MatchProduct[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(productId ?? "");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/match-product`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderItemId, productId: value || null }),
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    setLoading(false);

    if (!response.ok) {
      setMessage(data?.error ?? "연결 실패");
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          disabled={disabled}
          className="h-9 min-w-0 flex-1 rounded-md border border-zinc-300 px-2 text-xs outline-none focus:border-zinc-900 disabled:bg-zinc-100"
        >
          <option value="">미연결</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.sku} · {product.productName} ({product.stockQuantity})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={loading || disabled}
          className="h-9 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          저장
        </button>
      </div>
      {message ? <p className="text-xs text-rose-600">{message}</p> : null}
    </div>
  );
}

export function DeductStockButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function deduct() {
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/deduct-stock`, {
      method: "POST",
    });
    const data = (await response.json().catch(() => null)) as
      | {
          deducted?: number;
          shortages?: number;
          unmatched?: number;
          error?: string;
        }
      | null;

    setLoading(false);
    setMessage(
      response.ok
        ? `차감 ${data?.deducted ?? 0}건, 부족 ${data?.shortages ?? 0}건, 미매칭 ${
            data?.unmatched ?? 0
          }건`
        : data?.error ?? "재고 차감 실패",
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={deduct}
        disabled={loading}
        className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
      >
        {loading ? "차감 중" : "재고 차감"}
      </button>
      {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
    </div>
  );
}
