"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

type R2TestResponse = {
  ok?: boolean;
  bucketName?: string;
  publicBaseUrl?: string;
  endpoint?: string;
  accountId?: string;
  error?: string;
};

export function R2ConnectionStatusPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<R2TestResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const autoChecked = useRef(false);

  const checkConnection = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/r2/test", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as R2TestResponse | null;

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? "R2 연결 확인에 실패했습니다.");
      }

      setResult(data);
      setCheckedAt(new Date());
    } catch (err) {
      setResult(null);
      setCheckedAt(new Date());
      setError(err instanceof Error ? err.message : "R2 연결 확인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoChecked.current) {
      return;
    }

    autoChecked.current = true;
    void checkConnection();
  }, [checkConnection]);

  const checkedAtText = useMemo(() => {
    if (!checkedAt) {
      return null;
    }

    return checkedAt.toLocaleString("ko-KR", { hour12: false });
  }, [checkedAt]);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-950">R2 연결 상태</p>
          <p className="mt-1 text-xs text-zinc-600">
            촬영본 저장 시 이 연결을 통해 R2에 파일이 자동 업로드됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void checkConnection()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {loading ? "확인 중..." : "다시 확인"}
        </button>
      </div>

      {result ? (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <p className="inline-flex items-center gap-1 font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            연결 성공
          </p>
          <p className="mt-1">bucket: {result.bucketName}</p>
          <p>endpoint: {result.endpoint}</p>
          <p>public url: {result.publicBaseUrl}</p>
          {checkedAtText ? <p className="mt-1 text-xs text-emerald-700">확인 시각: {checkedAtText}</p> : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <p className="inline-flex items-center gap-1 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            연결 실패
          </p>
          <p className="mt-1">{error}</p>
          <p className="mt-1 text-xs text-rose-700">
            확인 필요: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL
          </p>
          {checkedAtText ? <p className="mt-1 text-xs text-rose-700">확인 시각: {checkedAtText}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
