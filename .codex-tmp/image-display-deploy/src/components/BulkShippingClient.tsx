"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Search, Truck } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";

export type ShippingOrder = {
  id: string;
  ebayOrderId: string;
  buyerName: string;
  buyerCountry: string;
  items: string;
  sku: string;
  quantity: number;
  orderDate: string;
  fulfillmentStatus: string;
};

const carriers = ["USPS", "UPS", "FedEx", "DHL", "KoreaPost", "Other"];

export function BulkShippingClient({ orders }: { orders: ShippingOrder[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [carrierCode, setCarrierCode] = useState(carriers[0]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return orders;
    }

    return orders.filter((order) =>
      [
        order.ebayOrderId,
        order.buyerName,
        order.buyerCountry,
        order.items,
        order.sku,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [orders, query]);

  async function submit() {
    const shipments = orders
      .filter((order) => selected[order.id])
      .map((order) => ({
        orderId: order.id,
        carrierCode,
        trackingNumber: tracking[order.id]?.trim() ?? "",
      }))
      .filter((shipment) => shipment.trackingNumber);

    if (shipments.length === 0) {
      setMessage("선택된 주문과 운송장 번호가 필요합니다.");
      return;
    }

    setLoading(true);
    setMessage("");

    const response = await fetch("/api/shipments/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shipments }),
    });
    const data = (await response.json().catch(() => null)) as
      | { results?: { ok: boolean; message: string }[]; error?: string }
      | null;
    const successCount = data?.results?.filter((result) => result.ok).length ?? 0;

    setLoading(false);
    setMessage(
      response.ok
        ? `${successCount}/${shipments.length}건 처리됨`
        : data?.error ?? "배송처리 실패",
    );
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-2 border-b border-zinc-200 bg-white p-4 md:grid-cols-[1fr_160px_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="주문번호, 구매자, 상품명, SKU"
            className="h-10 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-sm outline-none focus:border-zinc-900"
          />
        </label>
        <select
          value={carrierCode}
          onChange={(event) => setCarrierCode(event.target.value)}
          className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
        >
          {carriers.map((carrier) => (
            <option key={carrier} value={carrier}>
              {carrier}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
        >
          <Truck className="h-4 w-4" />
          {loading ? "처리 중" : "일괄 발송"}
        </button>
      </section>

      {message ? <p className="px-4 text-sm text-zinc-600">{message}</p> : null}

      <section className="hidden overflow-x-auto bg-white md:block">
        <table className="w-full min-w-[980px] border-y border-zinc-200 text-left text-sm">
          <thead className="bg-zinc-50 text-xs font-semibold uppercase text-zinc-500">
            <tr>
              <th className="w-12 px-4 py-3"></th>
              <th className="px-4 py-3">주문번호</th>
              <th className="px-4 py-3">구매자</th>
              <th className="px-4 py-3">상품</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">운송장</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {filtered.map((order) => (
              <tr key={order.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected[order.id] ?? false}
                    onChange={(event) =>
                      setSelected((current) => ({
                        ...current,
                        [order.id]: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                </td>
                <td className="px-4 py-3 font-medium text-zinc-950">
                  {order.ebayOrderId}
                </td>
                <td className="px-4 py-3 text-zinc-700">{order.buyerName}</td>
                <td className="max-w-xs px-4 py-3 text-zinc-700">
                  <span className="line-clamp-2">{order.items}</span>
                </td>
                <td className="px-4 py-3 text-zinc-700">{order.sku}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={order.fulfillmentStatus} />
                </td>
                <td className="px-4 py-3">
                  <input
                    value={tracking[order.id] ?? ""}
                    onChange={(event) =>
                      setTracking((current) => ({
                        ...current,
                        [order.id]: event.target.value,
                      }))
                    }
                    placeholder="Tracking"
                    className="h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3 px-4 md:hidden">
        {filtered.map((order) => (
          <article
            key={order.id}
            className="rounded-lg border border-zinc-200 bg-white p-4"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <label className="flex items-center gap-3">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300">
                  {selected[order.id] ? <Check className="h-4 w-4" /> : null}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={selected[order.id] ?? false}
                  onChange={(event) =>
                    setSelected((current) => ({
                      ...current,
                      [order.id]: event.target.checked,
                    }))
                  }
                />
                <span className="font-medium text-zinc-950">
                  {order.ebayOrderId}
                </span>
              </label>
              <StatusBadge status={order.fulfillmentStatus} />
            </div>
            <p className="text-sm text-zinc-700">{order.buyerName}</p>
            <p className="mt-1 line-clamp-2 text-sm text-zinc-600">{order.items}</p>
            <input
              value={tracking[order.id] ?? ""}
              onChange={(event) =>
                setTracking((current) => ({
                  ...current,
                  [order.id]: event.target.value,
                }))
              }
              placeholder="운송장 번호"
              className="mt-3 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </article>
        ))}
      </section>
    </div>
  );
}
