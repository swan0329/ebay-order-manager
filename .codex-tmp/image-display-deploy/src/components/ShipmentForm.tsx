"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";

const carriers = ["USPS", "UPS", "FedEx", "DHL", "KoreaPost", "Other"];

export function ShipmentForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/shipments/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shipments: [
          {
            orderId,
            carrierCode: form.get("carrierCode"),
            trackingNumber: form.get("trackingNumber"),
          },
        ],
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { results?: { ok: boolean; message: string }[]; error?: string }
      | null;

    setLoading(false);
    setMessage(data?.results?.[0]?.message ?? data?.error ?? "처리 실패");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <Truck className="h-5 w-5 text-zinc-700" />
        <h2 className="text-base font-semibold text-zinc-950">운송장 등록</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
        <select
          name="carrierCode"
          className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
        >
          {carriers.map((carrier) => (
            <option key={carrier} value={carrier}>
              {carrier}
            </option>
          ))}
        </select>
        <input
          name="trackingNumber"
          required
          placeholder="운송장 번호"
          className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
        >
          {loading ? "처리 중" : "발송처리"}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-zinc-600">{message}</p> : null}
    </form>
  );
}
