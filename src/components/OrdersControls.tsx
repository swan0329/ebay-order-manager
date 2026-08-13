"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, RefreshCw, Search } from "lucide-react";
import { normalizeOrderStatusParam } from "@/lib/ebay-order-status";

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
  const [status_, setStatus_] = useState<"idle" | "ok" | "error" | "reconnect">(
    "idle",
  );
  const autoSyncStarted = useRef(false);
  const status = normalizeOrderStatusParam(searchParams.get("status"));
  const query = searchParams.get("q") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const inventory = searchParams.get("inventory") ?? "all";
  const connected = searchParams.get("connected") === "1";
  const shouldAutoSync = searchParams.get("sync") === "1";
  const paramsText = useMemo(() => searchParams.toString(), [searchParams]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    for (const key of ["q", "status", "inventory", "from", "to"]) {
      const value = String(form.get(key) ?? "").trim();
      if (value && !(key === "inventory" && value === "all")) {
        params.set(key, value);
      }
    }

    const pageSize = searchParams.get("pageSize");

    if (pageSize) {
      params.set("pageSize", pageSize);
    }

    const queryString = params.toString();
    router.push(queryString ? `/orders?${queryString}` : "/orders");
  }

  const syncOrders = useCallback(
    async () => {
      setSyncing(true);
      setStatus_("idle");
      setMessage("eBay 주문을 불러오는 중입니다.");

      // 주문 불러오기는 화면 상태 필터(배송대기 등)와 무관하게 eBay의 모든 주문을
      // 가져온다. 상태 필터는 가져온 주문을 화면에서 거를 때만 쓴다.
      const response = await fetch("/api/orders/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          creationDateFrom: toIsoDate(from),
          creationDateTo: toIsoDate(to, true),
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { imported?: number; error?: string }
        | null;

      setSyncing(false);

      const errorText = data?.error ?? "";
      const needsReconnect =
        !response.ok &&
        /invalid_grant|\(401\)|\(403\)|연결되지|재연결/.test(errorText);

      if (response.ok) {
        setStatus_("ok");
        setMessage(`eBay 주문 ${data?.imported ?? 0}건을 불러왔습니다.`);
      } else if (needsReconnect) {
        setStatus_("reconnect");
        setMessage(
          "eBay 연결이 만료되어 주문을 불러올 수 없습니다. eBay 계정을 다시 연결해 주세요.",
        );
      } else {
        setStatus_("error");
        setMessage(errorText || "eBay 주문을 불러오지 못했습니다.");
      }

      // 방금 불러온 주문(모든 상태)이 바로 보이도록 화면 필터를 "전체"로 전환한다.
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("connected");
      nextParams.delete("sync");
      if (response.ok) {
        nextParams.set("status", "ALL");
      }
      const nextQuery = nextParams.toString();
      router.replace(`/orders${nextQuery ? `?${nextQuery}` : ""}`, { scroll: false });

      router.refresh();
    },
    [from, router, searchParams, to],
  );

  useEffect(() => {
    if (!shouldAutoSync || autoSyncStarted.current) {
      return;
    }

    autoSyncStarted.current = true;
    void syncOrders();
  }, [shouldAutoSync, syncOrders]);

  return (
    <section className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6">
        {connected ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            eBay 계정 연결이 완료되었습니다. 최신 주문을 자동으로 불러옵니다.
          </div>
        ) : null}

        <form
          onSubmit={applyFilters}
          className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_140px_140px_140px_140px_88px]"
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
            <option value="ALL">전체</option>
            <option value="AWAITING_PAYMENT">입금대기</option>
            <option value="AWAITING_SHIPMENT">배송대기</option>
            <option value="SHIPPED">배송완료</option>
            <option value="CANCELLED">취소·환불</option>
          </select>
          <select
            name="inventory"
            defaultValue={inventory}
            className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
          >
            <option value="all">전체 재고</option>
            <option value="unmatched">수동 확인 필요</option>
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
            className="h-10 whitespace-nowrap rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            조회
          </button>
        </form>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void syncOrders()}
              disabled={syncing}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              eBay 주문 불러오기
            </button>
            <a
              href={`/api/export/orders${paramsText ? `?${paramsText}` : ""}`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
          </div>
          <div className="text-sm">
            {status_ === "reconnect" ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 font-medium text-rose-800">
                <span>{message}</span>
                <a
                  href="/connect"
                  className="inline-flex h-7 items-center rounded-md bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  eBay 재연결
                </a>
              </div>
            ) : status_ === "error" ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 font-medium text-rose-800">
                {message}
              </p>
            ) : status_ === "ok" ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 font-medium text-emerald-800">
                {message}
              </p>
            ) : message ? (
              <p className="text-zinc-600">{message}</p>
            ) : (
              <p className="text-zinc-600">
                조회는 저장된 주문 필터링이고, 최신 eBay 주문은 주문 불러오기로 가져옵니다.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
