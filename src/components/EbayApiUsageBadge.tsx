"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// 왼쪽 메뉴에 늘 보이는 eBay 호출 여유. 자동화를 켤지 말지 판단할 때 화면을 따로
// 찾아 들어가지 않아도 되게 한다. 한도를 넘으면 계정이 정지되는 것이 아니라 호출이
// 잠시 거부되므로, 겁내는 대신 남은 양을 보고 정하면 된다.

type Summary = { connected: boolean; busiestRate: number };
type State = { kind: "ok"; data: Summary } | { kind: "error"; message: string } | null;

function tone(rate: number) {
  if (rate >= 0.8) return { bar: "bg-rose-500", text: "text-rose-700", box: "border-rose-200 bg-rose-50" };
  if (rate >= 0.5) return { bar: "bg-amber-500", text: "text-amber-800", box: "border-amber-200 bg-amber-50" };
  return { bar: "bg-emerald-500", text: "text-emerald-700", box: "border-zinc-200 bg-zinc-50" };
}

export function EbayApiUsageBadge() {
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/ebay/api-usage", { cache: "no-store" });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body?.error ?? `확인 실패 (${response.status})`);
        setState({ kind: "ok", data: body });
      } catch (error) {
        // 조용히 사라지면 기능이 없는 것으로 보인다. 실패했다는 사실은 남긴다.
        if (!cancelled) {
          setState({ kind: "error", message: error instanceof Error ? error.message : "확인 실패" });
        }
      }
    };
    void load();
    // 사용량은 천천히 움직인다. 5분마다면 충분하고, 이 확인 자체도 호출을 쓴다.
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!state) return null;

  if (state.kind === "error") {
    return (
      <Link
        href="/connect"
        prefetch={false}
        className="mx-3 mb-3 block rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500"
      >
        <span className="font-semibold text-zinc-600">eBay API 사용량</span>
        <span className="mt-1 block truncate" title={state.message}>
          {state.message}
        </span>
      </Link>
    );
  }

  const data = state.data;
  if (!data.connected) return null;

  const percent = Math.round(data.busiestRate * 100);
  const color = tone(data.busiestRate);

  return (
    <Link
      href="/connect"
      prefetch={false}
      className={`mx-3 mb-3 block rounded-xl border p-3 text-xs ${color.box}`}
    >
      <span className="flex items-center justify-between font-semibold">
        <span className="text-zinc-600">eBay API 사용량</span>
        <span className={color.text}>{percent}%</span>
      </span>
      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white">
        <span
          className={`block h-full ${color.bar}`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </span>
    </Link>
  );
}
