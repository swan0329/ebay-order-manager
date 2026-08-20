"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shopify 주문을 같은 주문 목록으로 가져온다. eBay 동기화와 나란히 둔다.
export function ShopifyOrderSyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function sync() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/shopify/orders/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "가져오지 못했습니다.");
      setMessage(
        body.saved
          ? `주문 ${body.saved}건 · 상품 줄 ${body.items}개 · 카드 연결 ${body.matched}개`
          : "새로 가져올 Shopify 주문이 없습니다.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={sync}
        disabled={loading}
        className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
      >
        {loading ? "가져오는 중" : "Shopify 주문 가져오기"}
      </button>
      {message ? <p className="text-xs text-zinc-600">{message}</p> : null}
    </div>
  );
}
