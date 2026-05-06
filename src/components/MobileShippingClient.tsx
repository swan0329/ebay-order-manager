"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Send } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import type { ShippingOrder } from "@/components/BulkShippingClient";

const carriers = ["USPS", "UPS", "FedEx", "DHL", "KoreaPost", "Other"];

export function MobileShippingClient({ orders }: { orders: ShippingOrder[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [carrierCode, setCarrierCode] = useState(carriers[0]);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState(orders[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return orders;
    }

    return orders.filter((order) =>
      [order.ebayOrderId, order.buyerName, order.items, order.sku]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [orders, query]);
  const activeOrder = filtered.find((order) => order.id === activeId) ?? filtered[0];

  async function ship() {
    if (!activeOrder) {
      setMessage("처리할 주문이 없습니다.");
      return;
    }

    const trackingNumber = tracking[activeOrder.id]?.trim();
    if (!trackingNumber) {
      setMessage("운송장 번호가 필요합니다.");
      return;
    }

    setLoading(true);
    setMessage("");

    const response = await fetch("/api/shipments/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shipments: [{ orderId: activeOrder.id, carrierCode, trackingNumber }],
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { results?: { message: string }[]; error?: string }
      | null;

    setLoading(false);
    setMessage(data?.results?.[0]?.message ?? data?.error ?? "처리 실패");
    router.refresh();
  }

  return (
    <div className="min-h-[calc(100vh-120px)] bg-zinc-50">
      <section className="sticky top-0 z-10 border-b border-zinc-200 bg-white p-4">
        <label className="relative mb-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="검색"
            className="h-11 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-base outline-none focus:border-zinc-900"
          />
        </label>
        <div className="grid grid-cols-[130px_1fr] gap-2">
          <select
            value={carrierCode}
            onChange={(event) => setCarrierCode(event.target.value)}
            className="h-11 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
          >
            {carriers.map((carrier) => (
              <option key={carrier} value={carrier}>
                {carrier}
              </option>
            ))}
          </select>
          <input
            value={activeOrder ? tracking[activeOrder.id] ?? "" : ""}
            onChange={(event) =>
              activeOrder
                ? setTracking((current) => ({
                    ...current,
                    [activeOrder.id]: event.target.value,
                  }))
                : undefined
            }
            placeholder="운송장 번호"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base outline-none focus:border-zinc-900"
          />
        </div>
        <button
          type="button"
          onClick={ship}
          disabled={loading}
          className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-base font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
        >
          <Send className="h-5 w-5" />
          {loading ? "처리 중" : "발송처리"}
        </button>
        {message ? <p className="mt-2 text-sm text-zinc-600">{message}</p> : null}
      </section>

      <section className="space-y-3 p-4">
        {filtered.map((order) => (
          <button
            key={order.id}
            type="button"
            onClick={() => setActiveId(order.id)}
            className={`block w-full rounded-lg border bg-white p-4 text-left ${
              activeOrder?.id === order.id
                ? "border-zinc-950"
                : "border-zinc-200"
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-zinc-950">
                {order.ebayOrderId}
              </span>
              <StatusBadge status={order.fulfillmentStatus} />
            </div>
            <p className="text-sm text-zinc-700">{order.buyerName}</p>
            <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{order.items}</p>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
              <span>{order.sku || "SKU 없음"}</span>
              <span>{order.quantity}개</span>
            </div>
          </button>
        ))}
      </section>
    </div>
  );
}
