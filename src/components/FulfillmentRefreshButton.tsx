"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

export function FulfillmentRefreshButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    await fetch(`/api/orders/${orderId}/fulfillments`, { method: "POST" });
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={loading}
      title="배송 이력 동기화"
      className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
    >
      <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      이력 동기화
    </button>
  );
}
