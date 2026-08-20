"use client";

import { useEffect, useState } from "react";

type Row = {
  api: string;
  resource: string;
  limit: number;
  remaining: number;
  used: number;
  usedRate: number;
  resetAt: string | null;
};
type Summary = {
  connected: boolean;
  environment: string | null;
  rows: Row[];
  busiestRate: number;
  message?: string;
};

// 사용률을 색으로 나눈다. 자동 수집 주기를 늘려도 되는지 한눈에 보이게 하려는 것이다.
function tone(rate: number) {
  if (rate >= 0.8) return { bar: "bg-rose-500", text: "text-rose-700", label: "여유 없음" };
  if (rate >= 0.5) return { bar: "bg-amber-500", text: "text-amber-700", label: "절반 넘게 씀" };
  return { bar: "bg-emerald-500", text: "text-emerald-700", label: "여유 있음" };
}

export function EbayApiUsageCard() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  // 화면을 열자마자 한 번 불러오므로 처음부터 불러오는 중으로 둔다.
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/ebay/api-usage", { cache: "no-store" });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body?.error ?? "사용량을 불러오지 못했습니다.");
        setData(body);
        setError("");
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const load = () => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const overall = data ? tone(data.busiestRate) : null;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">eBay API 사용량</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            한도를 넘으면 계정이 정지되는 것이 아니라 호출이 잠시 거부됩니다. 남은 여유를
            보고 자동화 주기를 정하시면 됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-300"
        >
          {loading ? "확인 중" : "새로 확인"}
        </button>
      </div>

      {error ? <p className="mt-3 rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p> : null}

      {data && !data.connected ? (
        <p className="mt-3 text-sm text-amber-700">{data.message}</p>
      ) : null}

      {data?.connected && overall ? (
        <>
          <p className={`mt-3 text-sm font-semibold ${overall.text}`}>
            가장 많이 쓴 항목 {Math.round(data.busiestRate * 100)}% · {overall.label}
            {data.environment ? ` · ${data.environment}` : ""}
          </p>
          {data.rows.length ? (
            <div className="mt-3 space-y-2">
              {data.rows.slice(0, 12).map((row) => {
                const rowTone = tone(row.usedRate);
                return (
                  <div key={`${row.api}-${row.resource}`} className="text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="min-w-0 truncate text-zinc-700">
                        {row.api} · {row.resource}
                      </span>
                      <span className={`shrink-0 font-semibold ${rowTone.text}`}>
                        {row.used.toLocaleString()} / {row.limit.toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className={`h-full ${rowTone.bar}`}
                        style={{ width: `${Math.max(2, Math.round(row.usedRate * 100))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">
              eBay가 사용량을 돌려주지 않았습니다. 호출 기록이 아직 없을 수 있습니다.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
