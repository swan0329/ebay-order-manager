"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Download, RefreshCw, Search } from "lucide-react";
import { normalizeOrderStatusParam } from "@/lib/ebay-order-status";

type SyncChannel = "EBAY" | "SHOPIFY";
type SyncSelection = SyncChannel | "ALL";

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
  const [syncingSelection, setSyncingSelection] = useState<SyncSelection | null>(null);
  const [message, setMessage] = useState("");
  const [status_, setStatus_] = useState<
    "idle" | "ok" | "warning" | "error" | "reconnect"
  >("idle");
  const [showReconnect, setShowReconnect] = useState(false);
  const autoSyncStarted = useRef(false);
  const syncMenuRef = useRef<HTMLDetailsElement>(null);
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
    async (selection: SyncSelection = "ALL") => {
      const channels: SyncChannel[] =
        selection === "ALL" ? ["EBAY", "SHOPIFY"] : [selection];
      const selectionName =
        selection === "ALL"
          ? "전체"
          : selection === "SHOPIFY"
            ? "Shopify"
            : "eBay";
      syncMenuRef.current?.removeAttribute("open");
      setSyncingSelection(selection);
      setStatus_("idle");
      setShowReconnect(false);
      setMessage(`${selectionName} 주문을 불러오는 중입니다.`);

      const results: Array<{
        channel: SyncChannel;
        ok: boolean;
        imported: number;
        error: string;
        reconnect: boolean;
      }> = [];

      // 전체 수집도 채널별 API를 독립적으로 실행해 한 채널이 실패해도 다른 채널의
      // 성공 결과를 보존한다. 각 저장 경로는 외부 주문 ID 기준으로 재시도에 안전하다.
      for (const channel of channels) {
        try {
          const response = await fetch("/api/orders/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              channel,
              creationDateFrom: toIsoDate(from),
              creationDateTo: toIsoDate(to, true),
            }),
          });
          const data = (await response.json().catch(() => null)) as
            | { imported?: number; error?: string }
            | null;
          const errorText = data?.error ?? "";
          results.push({
            channel,
            ok: response.ok,
            imported: data?.imported ?? 0,
            error:
              errorText ||
              `${channel === "SHOPIFY" ? "Shopify" : "eBay"} 주문을 불러오지 못했습니다.`,
            reconnect:
              channel === "EBAY" &&
              !response.ok &&
              /invalid_grant|\(401\)|\(403\)|연결되지|재연결/.test(errorText),
          });
        } catch {
          results.push({
            channel,
            ok: false,
            imported: 0,
            error: `${channel === "SHOPIFY" ? "Shopify" : "eBay"} 서버에 연결하지 못했습니다.`,
            reconnect: false,
          });
        }
      }

      setSyncingSelection(null);
      const successes = results.filter((result) => result.ok);
      const hasReconnect = results.some((result) => result.reconnect);
      setShowReconnect(hasReconnect);

      const resultText = results
        .map((result) => {
          const channelName = result.channel === "SHOPIFY" ? "Shopify" : "eBay";
          return result.ok
            ? `${channelName} ${result.imported}건`
            : `${channelName} 실패: ${result.error}`;
        })
        .join(" · ");

      if (successes.length === results.length) {
        setStatus_("ok");
        setMessage(`${resultText}을 불러왔습니다.`);
      } else if (successes.length > 0) {
        setStatus_("warning");
        setMessage(`일부 채널만 완료했습니다. ${resultText}`);
      } else {
        setStatus_(hasReconnect ? "reconnect" : "error");
        setMessage(`주문을 불러오지 못했습니다. ${resultText}`);
      }

      // 방금 불러온 주문(모든 상태)이 바로 보이도록 화면 필터를 "전체"로 전환한다.
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("connected");
      nextParams.delete("sync");
      if (successes.length > 0) {
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
    void syncOrders("EBAY");
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
            <div className="inline-flex">
              <button
                type="button"
                onClick={() => void syncOrders("ALL")}
                disabled={syncingSelection !== null}
                className="inline-flex h-9 items-center gap-2 rounded-l-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncingSelection !== null ? "animate-spin" : ""}`}
                />
                {syncingSelection === "ALL"
                  ? "전체 주문 불러오는 중"
                  : syncingSelection === "EBAY"
                    ? "eBay 주문 불러오는 중"
                    : syncingSelection === "SHOPIFY"
                      ? "Shopify 주문 불러오는 중"
                      : "전체 주문 불러오기"}
              </button>
              <details ref={syncMenuRef} className="relative">
                <summary
                  aria-label="주문 불러오기 채널 선택"
                  aria-disabled={syncingSelection !== null}
                  className={`flex h-9 w-9 list-none items-center justify-center rounded-r-md border-l border-zinc-700 bg-zinc-950 text-white hover:bg-zinc-800 [&::-webkit-details-marker]:hidden ${syncingSelection !== null ? "pointer-events-none cursor-wait bg-zinc-400" : "cursor-pointer"}`}
                >
                  <ChevronDown className="h-4 w-4" />
                </summary>
                <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-lg">
                  {(
                    [
                      ["ALL", "전체 주문 불러오기"],
                      ["EBAY", "eBay만 불러오기"],
                      ["SHOPIFY", "Shopify만 불러오기"],
                    ] as Array<[SyncSelection, string]>
                  ).map(([selection, label]) => (
                    <button
                      key={selection}
                      type="button"
                      onClick={() => void syncOrders(selection)}
                      disabled={syncingSelection !== null}
                      className="block w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-400"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </details>
            </div>
            <a
              href={`/api/export/orders${paramsText ? `?${paramsText}` : ""}`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
          </div>
          <div className="text-sm">
            {status_ === "reconnect" || status_ === "warning" ? (
              <div className={`flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-medium ${status_ === "warning" ? "border border-amber-200 bg-amber-50 text-amber-800" : "border border-rose-200 bg-rose-50 text-rose-800"}`}>
                <span>{message}</span>
                {showReconnect ? (
                  <a
                    href="/connect"
                    className="inline-flex h-7 items-center rounded-md bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
                  >
                    eBay 재연결
                  </a>
                ) : null}
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
                기본 버튼은 eBay와 Shopify를 함께 불러오고, 화살표 메뉴에서 채널을 선택할 수 있습니다.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
