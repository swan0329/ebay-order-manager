"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Stethoscope } from "lucide-react";

type ConnectionStatusResponse = {
  ok?: boolean;
  reason?: "not_connected" | "reauth" | "error";
  message?: string;
};

type TestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export function EbayConnectionTest() {
  const [state, setState] = useState<TestState>({ status: "idle" });

  async function runTest() {
    setState({ status: "loading" });

    try {
      const response = await fetch("/api/ebay/connection-status", {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as
        | ConnectionStatusResponse
        | null;

      if (data?.ok) {
        setState({
          status: "ok",
          message: data.message ?? "eBay 연결이 정상입니다.",
        });
        return;
      }

      setState({
        status: "error",
        message: data?.message ?? "eBay 연결을 확인하지 못했습니다.",
      });
    } catch {
      setState({
        status: "error",
        message: "네트워크 오류로 연결을 확인하지 못했습니다. 다시 시도해 주세요.",
      });
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void runTest()}
        disabled={state.status === "loading"}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
      >
        {state.status === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Stethoscope className="h-4 w-4" />
        )}
        {state.status === "loading" ? "확인 중..." : "연결 테스트"}
      </button>

      {state.status === "ok" ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{state.message}</p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{state.message}</p>
        </div>
      ) : null}
    </div>
  );
}
