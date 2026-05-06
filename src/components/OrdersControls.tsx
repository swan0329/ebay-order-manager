"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, RefreshCw, Search } from "lucide-react";

function toIsoDate(value: string, endOfDay = false) {
  if (!value) {
    return undefined;
  }

  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return date.toISOString();
}

export function OrdersControls() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const status = searchParams.get("status") ?? "OPEN";
  const query = searchParams.get("q") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const inventory = searchParams.get("inventory") ?? "all";
  const paramsText = useMemo(() => searchParams.toString(), [searchParams]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    for (const key of ["q", "status", "inventory", "from", "to"]) {
      const value = String(form.get(key) ?? "").trim();
      if (
        value &&
        !(key === "status" && value === "ALL") &&
        !(key === "inventory" && value === "all")
      ) {
        params.set(key, value);
      }
    }

    router.push(`/orders?${params.toString()}`);
  }

  async function syncOrders() {
    setSyncing(true);
    setMessage("");

    const response = await fetch("/api/orders/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fulfillmentStatus: status === "ALL" ? undefined : status,
        creationDateFrom: toIsoDate(from),
        creationDateTo: toIsoDate(to, true),
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { imported?: number; error?: string }
      | null;

    setSyncing(false);
    setMessage(
      response.ok
        ? `${data?.imported ?? 0}건 동기화됨`
        : data?.error ?? "동기화 실패",
    );
    router.refresh();
  }

  return (
    <section className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6">
        <form
          onSubmit={applyFilters}
          className="grid gap-2 md:grid-cols-[1fr_150px_150px_150px_150px_auto]"
        >
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              name="q"
              defaultValue={query}
              placeholder="주문번호, 구매자, 상품명, SKU"
              className="h-10 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <select
            name="status"
            defaultValue={status}
            className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
          >
            <option value="OPEN">배송대기</option>
            <option value="NOT_STARTED">미시작</option>
            <option value="IN_PROGRESS">부분배송</option>
            <option value="FULFILLED">배송완료</option>
            <option value="ALL">전체</option>
          </select>
          <select
            name="inventory"
            defaultValue={inventory}
            className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
          >
            <option value="all">전체 재고</option>
            <option value="unmatched">상품 미매칭</option>
            <option value="shortage">재고 부족</option>
            <option value="deducted">재고 차감완료</option>
            <option value="warning">자동 경고</option>
          </select>
          <input
            name="from"
            type="date"
            defaultValue={from}
            className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
          />
          <input
            name="to"
            type="date"
            defaultValue={to}
            className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
          />
          <button
            type="submit"
            className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            조회
          </button>
        </form>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={syncOrders}
              disabled={syncing}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              동기화
            </button>
            <a
              href={`/api/export/orders${paramsText ? `?${paramsText}` : ""}`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
          </div>
          {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
        </div>
      </div>
    </section>
  );
}
