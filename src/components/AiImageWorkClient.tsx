"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
type Item = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  sourceUrl: string;
  previewUrl: string | null;
  status: string;
  error: string | null;
  previewVersion: string;
};
type Claimed = { id: string; productId: string; sourceUrl: string };
type DewatermarkMode = "STANDARD" | "PRO";
type ApiBatch = {
  id: string;
  status: string;
  mode: DewatermarkMode;
  requestedCount: number;
  claimedCount: number;
  completedCount: number;
  failedCount: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
function duration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "계산 중";
  const value = Math.ceil(seconds);
  return value < 60
    ? `약 ${value}초`
    : `약 ${Math.floor(value / 60)}분 ${value % 60}초`;
}
export function AiImageWorkClient({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [flash, setFlash] = useState("");
  const [localItems, setLocalItems] = useState(items);
  const [autoCount, setAutoCount] = useState(25);
  const [dewatermarkMode, setDewatermarkMode] =
    useState<DewatermarkMode>("STANDARD");
  const [apiBatch, setApiBatch] = useState<ApiBatch | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);
  const [creditError, setCreditError] = useState("");
  const [reworkCount, setReworkCount] = useState(5);
  const [upload, setUpload] = useState<{
    done: number;
    total: number;
    started: number;
  } | null>(null);
  useEffect(() => {
    queueMicrotask(() => setLocalItems(items));
  }, [items]);
  async function call(body: object) {
    const r = await fetch("/api/ai-image-work", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error || "처리에 실패했습니다.");
    return b;
  }
  useEffect(() => {
    let cancelled = false;
    const refreshBatch = async () => {
      try {
        const response = await call({ action: "apiBatchStatus" });
        if (!cancelled) setApiBatch(response.batch as ApiBatch | null);
      } catch {
        // A temporary status failure must not interrupt the server-side batch.
      }
    };
    void refreshBatch();
    const timer = window.setInterval(() => {
      setClock(Date.now());
      void refreshBatch();
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refreshCredits = async () => {
      try {
        const response = await call({
          action: "dewatermarkCreditBalance",
        });
        if (!cancelled) {
          setAvailableCredits(Number(response.availableCredits));
          setCreditError("");
        }
      } catch (error) {
        if (!cancelled) {
          setCreditError(
            error instanceof Error ? error.message : "크레딧 조회 실패",
          );
        }
      }
    };
    void refreshCredits();
    const timer = window.setInterval(refreshCredits, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  async function enqueue() {
    setBusy(true);
    setMsg("");
    try {
      const b = await call({ action: "enqueue", limit: 100 });
      setMsg(`${b.created}개를 대기열에 추가했습니다.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function processClaimed(job: Claimed) {
    try {
      const completed = await call({
        action: "dewatermark",
        id: job.id,
        mode: dewatermarkMode,
      });
      return { ok: true as const, url: completed.url as string };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await call({
        action: "fail",
        id: job.id,
        error,
      });
      return { ok: false as const, error };
    }
  }
  async function run() {
    const target = Math.max(1, Math.min(10_000, autoCount));
    setBusy(true);
    setMsg(`Dewatermark 서버 작업 ${target}개를 등록하는 중…`);
    try {
      const response = await call({
        action: "startApiBatch",
        limit: target,
        mode: dewatermarkMode,
      });
      setApiBatch({
        id: response.batch.id,
        status: "queued",
        mode: response.batch.mode,
        requestedCount: response.batch.accepted,
        claimedCount: 0,
        completedCount: 0,
        failedCount: 0,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
      });
      setMsg(
        `${response.batch.accepted}개 서버 자동 처리를 시작했습니다. PC나 브라우저를 꺼도 계속 진행됩니다.`,
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function reprocess() {
    setBusy(true);
    setMsg("");
    try {
      const b = await call({ action: "reprocess" });
      setLocalItems((current) =>
        current.map((item) =>
          ["review", "held", "pass_ready", "processing"].includes(item.status)
            ? { ...item, status: "queued", previewUrl: null }
            : item,
        ),
      );
      setMsg(`기존 결과 ${b.count}개를 개선 재처리 대기열로 옮겼습니다.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function choose(action: "pass" | "hold" | "rework", id: string) {
    const previous = localItems;
    setLocalItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status:
                action === "pass"
                  ? "pass_ready"
                  : action === "hold"
                    ? "held"
                    : "rework",
            }
          : item,
      ),
    );
    setFlash(
      action === "pass"
        ? "✓ 통과 완료 · 다음 카드"
        : action === "hold"
          ? "⏸ 보류 완료 · 다음 카드"
          : "✕ 미통과 · 재작업 목록으로 이동",
    );
    window.setTimeout(() => setFlash(""), 900);
    try {
      await call({ action, id });
    } catch (e) {
      setLocalItems(previous);
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }
  async function resumeHeld() {
    const previous = localItems;
    setLocalItems((current) =>
      current.map((item) =>
        item.status === "held" ? { ...item, status: "review" } : item,
      ),
    );
    setFlash("보류 카드를 다시 검수합니다.");
    window.setTimeout(() => setFlash(""), 900);
    try {
      await call({ action: "resumeHeld" });
    } catch (e) {
      setLocalItems(previous);
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }
  async function retry(id: string) {
    try {
      await call({ action: "retry", id });
      setLocalItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "queued", error: null } : item,
        ),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }
  async function reprocessOne(item: Item) {
    if (busy) return;
    setBusy(true);
    setMsg(`${item.sku} 미통과 이미지를 다시 처리하는 중…`);
    try {
      const claimed = await call({ action: "claimRework", id: item.id });
      const job = claimed.job as Claimed | null;
      if (!job) throw new Error("이미 재처리 중이거나 미통과 상태가 아닙니다.");
      setLocalItems((current) =>
        current.map((target) =>
          target.id === item.id ? { ...target, status: "processing" } : target,
        ),
      );
      const result = await processClaimed(job);
      setLocalItems((current) =>
        current.map((target) =>
          target.id === item.id
            ? result.ok
              ? {
                  ...target,
                  status: "review",
                  previewUrl: result.url,
                  previewVersion: Date.now().toString(),
                  error: null,
                }
              : { ...target, status: "failed", error: result.error }
            : target,
        ),
      );
      setMsg(
        result.ok
          ? `${item.sku} 재처리가 끝났습니다. 다시 검수해 주세요.`
          : `${item.sku} 재처리에 실패했습니다: ${result.error}`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function reprocessAllRework() {
    const available = localItems.filter((item) => item.status === "rework");
    const targetCount = Math.max(
      1,
      Math.min(available.length, reworkCount),
    );
    const targets = available.slice(0, targetCount);
    if (!targets.length || busy) return;
    setBusy(true);
    let done = 0;
    try {
      const concurrency = 1;
      for (let index = 0; index < targets.length; index += concurrency) {
        const batch = targets.slice(index, index + concurrency);
        await Promise.all(
          batch.map(async (item) => {
            const claimed = await call({ action: "claimRework", id: item.id });
            const job = claimed.job as Claimed | null;
            if (!job) return;
            setLocalItems((current) =>
              current.map((target) =>
                target.id === item.id
                  ? { ...target, status: "processing" }
                  : target,
              ),
            );
            const result = await processClaimed(job);
            setLocalItems((current) =>
              current.map((target) =>
                target.id === item.id
                  ? result.ok
                    ? {
                        ...target,
                        status: "review",
                        previewUrl: result.url,
                        previewVersion: Date.now().toString(),
                        error: null,
                      }
                    : { ...target, status: "failed", error: result.error }
                  : target,
              ),
            );
          }),
        );
        done += batch.length;
        setMsg(`미통과 이미지 ${done}/${targets.length}개 재처리 완료…`);
      }
      setMsg(
        `미통과 이미지 ${done}개를 다시 처리했습니다. 다시 검수해 주세요.`,
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function bulkUpload() {
    const targets = localItems.filter((i) => i.status === "pass_ready");
    if (!targets.length) return;
    setBusy(true);
    const started = Date.now();
    setUpload({ done: 0, total: targets.length, started });
    let done = 0;
    try {
      for (let index = 0; index < targets.length; index += 3) {
        const batch = targets.slice(index, index + 3);
        await Promise.all(
          batch.map((item) =>
            call({ action: "finalUpload", id: item.id, confirmed: true }),
          ),
        );
        done += batch.length;
        setUpload({ done, total: targets.length, started });
        setLocalItems((current) =>
          current.filter(
            (item) => !batch.some((uploaded) => uploaded.id === item.id),
          ),
        );
      }
      setMsg(`${done}개 최종 업로드를 완료했습니다.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUpload(null);
      setBusy(false);
    }
  }
  const review = localItems.filter((i) => i.status === "review"),
    held = localItems.filter((i) => i.status === "held"),
    ready = localItems.filter((i) => i.status === "pass_ready"),
    queued = localItems.filter((i) =>
      ["queued", "processing"].includes(i.status),
    ),
    failed = localItems.filter((i) => i.status === "failed"),
    rework = localItems.filter((i) => i.status === "rework"),
    current = review[0] ?? null;
  const elapsed = upload ? (clock - upload.started) / 1000 : 0;
  const eta =
    upload && upload.done > 0
      ? (elapsed / upload.done) * (upload.total - upload.done)
      : NaN;
  const apiProcessed = apiBatch
    ? apiBatch.completedCount + apiBatch.failedCount
    : 0;
  const apiProgress =
    apiBatch && apiBatch.requestedCount
      ? Math.min(100, (apiProcessed / apiBatch.requestedCount) * 100)
      : 0;
  const apiElapsed = apiBatch
    ? Math.max(
        0,
        ((apiBatch.completedAt
          ? new Date(apiBatch.completedAt).getTime()
          : clock) -
          new Date(apiBatch.createdAt).getTime()) /
          1000,
      )
    : 0;
  const apiEta =
    apiBatch && apiProcessed > 0
      ? (apiElapsed / apiProcessed) * (apiBatch.requestedCount - apiProcessed)
      : NaN;
  const apiRunning =
    apiBatch?.status === "queued" || apiBatch?.status === "running";
  const apiStalled =
    apiRunning &&
    clock - new Date(apiBatch.updatedAt).getTime() > 75_000;
  const plannedCredits = autoCount * (dewatermarkMode === "PRO" ? 3 : 1);
  const creditShortage =
    availableCredits === null
      ? null
      : Math.max(0, plannedCredits - availableCredits);
  const creditsAfter =
    availableCredits === null
      ? null
      : Math.max(0, availableCredits - plannedCredits);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!current || busy || upload) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const passKey =
        event.key === "1" ||
        event.code === "Digit1" ||
        event.code === "Numpad1" ||
        event.key === "Enter";
      const holdKey =
        event.key === "2" ||
        event.code === "Digit2" ||
        event.code === "Numpad2" ||
        event.key.toLowerCase() === "h";
      const reworkKey =
        event.key === "3" ||
        event.code === "Digit3" ||
        event.code === "Numpad3";
      if (passKey) {
        event.preventDefault();
        void choose("pass", current.id);
      } else if (holdKey) {
        event.preventDefault();
        void choose("hold", current.id);
      } else if (reworkKey) {
        event.preventDefault();
        void choose("rework", current.id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [current, busy, upload, localItems]);
  return (
    <div>
      {upload && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold">통과 이미지 최종 업로드 중</h2>
            <p className="mt-2 text-sm text-zinc-600">
              {upload.done}/{upload.total}개 완료 · 예상 남은 시간{" "}
              {duration(eta)}
            </p>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-200">
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{
                  width: `${upload.total ? (upload.done / upload.total) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              업로드가 끝날 때까지 이 화면을 닫지 마세요.
            </p>
          </div>
        </div>
      )}
      {flash && (
        <div className="fixed left-1/2 top-20 z-[110] -translate-x-1/2 rounded-full bg-zinc-950 px-6 py-3 text-base font-bold text-white shadow-xl">
          {flash}
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          disabled={busy}
          onClick={enqueue}
          className="cursor-pointer rounded bg-violet-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          미작업 100개 추가
        </button>
        <label className="flex items-center gap-2 rounded border bg-white px-3 py-2 text-sm font-semibold">
          자동 처리 수
          <input
            type="number"
            min="1"
            max="10000"
            value={autoCount}
            onChange={(e) =>
              setAutoCount(
                Math.max(1, Math.min(10_000, Number(e.target.value) || 1)),
              )
            }
            className="w-20 rounded border px-2 py-1 text-right"
          />
          개
        </label>
        <label className="flex items-center gap-2 rounded border bg-white px-3 py-2 text-sm font-semibold">
          처리 방식
          <select
            value={dewatermarkMode}
            onChange={(event) =>
              setDewatermarkMode(event.target.value as DewatermarkMode)
            }
            className="rounded border px-2 py-1"
          >
            <option value="STANDARD">일반 API · 1크레딧 (기본)</option>
            <option value="PRO">PRO 고품질 · 3크레딧</option>
          </select>
        </label>
        <button
          disabled={busy || apiRunning}
          onClick={run}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {apiRunning ? "서버에서 처리 중" : "설정 수량 자동 처리"}
        </button>
        <button
          disabled={busy || !ready.length}
          onClick={bulkUpload}
          className="cursor-pointer rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          통과 {ready.length}개 일괄 업로드
        </button>
        <button
          disabled={busy || !held.length}
          onClick={resumeHeld}
          className="cursor-pointer rounded bg-amber-500 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          보류 {held.length}개 다시 검수
        </button>
        <button
          disabled={busy || (!review.length && !ready.length && !held.length)}
          onClick={reprocess}
          className="cursor-pointer rounded border border-amber-500 bg-amber-50 px-4 py-2 font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          기존 검수 결과 개선 재처리
        </button>
        <span className="px-3 py-2 text-sm text-zinc-600">
          대기 {queued.length} · 검수 {review.length} · 보류 {held.length} ·
          업로드 대기 {ready.length} · 미통과 {rework.length} · 실패{" "}
          {failed.length}
        </span>
      </div>
      <section className="mb-4 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>Dewatermark 크레딧</strong>
          <span className="text-xs text-zinc-500">30초마다 자동 갱신</span>
        </div>
        {availableCredits !== null ? (
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
            <div className="rounded bg-zinc-50 p-3">
              <span className="block text-xs text-zinc-500">현재 보유</span>
              <strong>{availableCredits.toLocaleString()} 크레딧</strong>
            </div>
            <div className="rounded bg-zinc-50 p-3">
              <span className="block text-xs text-zinc-500">설정 수량 최대 필요</span>
              <strong>{plannedCredits.toLocaleString()} 크레딧</strong>
            </div>
            <div className="rounded bg-zinc-50 p-3">
              <span className="block text-xs text-zinc-500">작업 후 예상</span>
              <strong>{creditsAfter?.toLocaleString()} 크레딧</strong>
            </div>
            <div
              className={`rounded p-3 ${
                creditShortage ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"
              }`}
            >
              <span className="block text-xs">
                {creditShortage ? "부족 수량" : "작업 가능"}
              </span>
              <strong>
                {creditShortage
                  ? `${creditShortage.toLocaleString()} 크레딧 부족`
                  : "크레딧 충분"}
              </strong>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            {creditError || "크레딧 잔액을 확인하는 중입니다…"}
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          일반 API는 장당 1크레딧, PRO는 장당 3크레딧으로 계산됩니다.
        </p>
      </section>
      {apiBatch && (
        <section className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-violet-950">
              AI 이미지 서버 자동 처리
            </strong>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-violet-800">
              {apiStalled ? "자동 복구 중" : apiRunning ? "진행 중" : "완료"}
            </span>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-violet-100">
            <div
              className="h-full bg-violet-600 transition-all duration-500"
              style={{ width: `${apiProgress}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-700">
            <span>
              {apiProcessed}/{apiBatch.requestedCount}장 ({Math.round(apiProgress)}%)
            </span>
            <span>성공 {apiBatch.completedCount}장</span>
            <span>실패 {apiBatch.failedCount}장</span>
            <span>경과 {duration(apiElapsed)}</span>
            {apiProcessed > 0 && apiElapsed > 0 && (
              <span>
                처리 속도 약{" "}
                {Math.max(0.1, (apiProcessed / apiElapsed) * 60).toFixed(1)}
                장/분
              </span>
            )}
            {apiRunning && (
              <span>
                {apiStalled
                  ? "멈춤 감지 · 서버가 자동으로 재연결하고 있습니다"
                  : `예상 남은 시간 ${duration(apiEta)}`}
              </span>
            )}
            <span>
              예상 사용 {apiBatch.requestedCount * (apiBatch.mode === "PRO" ? 3 : 1)}
              크레딧
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            이 화면을 닫거나 다른 메뉴로 이동하고 컴퓨터를 꺼도 서버에서 계속 처리됩니다.
          </p>
          {apiBatch.errorMessage && apiBatch.failedCount > 0 && (
            <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">
              최근 오류: {apiBatch.errorMessage}
            </p>
          )}
        </section>
      )}
      {msg && <p className="mb-4 rounded border bg-white p-3 text-sm">{msg}</p>}
      {ready.length > 0 && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
          통과 선택 {ready.length}개가 최종 업로드를 기다리고 있습니다.
        </div>
      )}
      <div>
        {current ? (
          <article key={current.id} className="rounded-xl border bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <strong>{current.sku}</strong>
                <span className="ml-2 text-sm text-zinc-500">
                  {current.productName}
                </span>
              </div>
              <span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-bold text-violet-800">
                남은 검수 {review.length}개
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-sm font-semibold">포카마켓 원본</p>
                <img
                  src={current.sourceUrl}
                  alt="원본"
                  className="h-[min(62vh,620px)] w-full rounded bg-zinc-100 object-contain"
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold">AI 자동 처리 결과</p>
                <img
                  src={
                    current.previewUrl
                      ? `${current.previewUrl}${current.previewUrl.includes("?") ? "&" : "?"}v=${current.previewVersion}`
                      : ""
                  }
                  alt="결과"
                  className="h-[min(62vh,620px)] w-full rounded bg-zinc-100 object-contain"
                />
              </div>
            </div>
            <div className="sticky bottom-3 z-20 mt-3 flex items-center justify-center gap-3 rounded-xl border bg-white/95 p-3 shadow-xl backdrop-blur">
              <button
                onClick={() => choose("pass", current.id)}
                className="min-w-36 cursor-pointer rounded-lg bg-emerald-700 px-7 py-3 text-lg font-bold text-white hover:bg-emerald-600"
              >
                통과 <span className="text-xs opacity-75">1 / Enter</span>
              </button>
              <button
                onClick={() => choose("hold", current.id)}
                className="min-w-36 cursor-pointer rounded-lg bg-amber-500 px-7 py-3 text-lg font-bold text-white hover:bg-amber-400"
              >
                보류 <span className="text-xs opacity-75">2 / H</span>
              </button>
              <button
                onClick={() => choose("rework", current.id)}
                className="min-w-36 cursor-pointer rounded-lg bg-rose-700 px-7 py-3 text-lg font-bold text-white hover:bg-rose-600"
              >
                미통과 <span className="text-xs opacity-75">3</span>
              </button>
              <a
                href={`/products/image-workbench?id=${current.productId}`}
                className="cursor-pointer rounded-lg border px-5 py-3 font-semibold hover:bg-zinc-50"
              >
                수동 작업
              </a>
            </div>
          </article>
        ) : (
          <div className="rounded border bg-white p-10 text-center text-zinc-500">
            검수 대기 결과가 없습니다.
            {held.length > 0 && (
              <button
                onClick={resumeHeld}
                className="mx-auto mt-4 block cursor-pointer rounded bg-amber-500 px-5 py-2 font-bold text-white"
              >
                보류 {held.length}개 다시 검수
              </button>
            )}
          </div>
        )}
      </div>
      {rework.length > 0 && (
        <details className="mt-5 rounded border border-rose-200 bg-white p-4">
          <summary className="cursor-pointer font-semibold text-rose-800">
            미통과·재작업 {rework.length}개
          </summary>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-rose-50 p-3">
            <span className="text-sm text-rose-900">
              미통과 항목을 새 엔진으로 처리한 뒤 다시 검수 대기에 올립니다.
            </span>
            <label className="ml-auto flex items-center gap-1 text-sm font-semibold text-rose-900">
              재작업
              <input
                type="number"
                min="1"
                max={rework.length}
                value={Math.min(reworkCount, rework.length)}
                onChange={(event) =>
                  setReworkCount(
                    Math.max(
                      1,
                      Math.min(rework.length, Number(event.target.value) || 1),
                    ),
                  )
                }
                className="w-20 rounded border border-rose-300 bg-white px-2 py-1.5 text-right"
              />
              개
            </label>
            <button
              disabled={busy}
              onClick={reprocessAllRework}
              className="cursor-pointer rounded bg-rose-700 px-4 py-2 font-bold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? "재처리 중…"
                : `${Math.min(reworkCount, rework.length)}개 자동 재처리`}
            </button>
          </div>
          {rework.map((item) => (
            <div
              key={item.id}
              className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
            >
              <span>
                {item.sku} · {item.productName}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => reprocessOne(item)}
                  className="cursor-pointer rounded border px-3 py-1.5 font-semibold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  즉시 자동 재처리
                </button>
                <a
                  href={`/products/image-workbench?id=${item.productId}`}
                  className="cursor-pointer rounded bg-zinc-900 px-3 py-1.5 font-semibold text-white"
                >
                  수동 작업
                </a>
              </div>
            </div>
          ))}
        </details>
      )}
      {failed.length > 0 && (
        <details className="mt-5 rounded border bg-white p-4">
          <summary className="cursor-pointer font-semibold">
            처리 실패 {failed.length}개
          </summary>
          {failed.map((i) => (
            <div
              key={i.id}
              className="mt-2 flex justify-between border-t pt-2 text-sm"
            >
              <span>
                {i.sku} · {i.error}
              </span>
              <button
                onClick={() => retry(i.id)}
                className="cursor-pointer font-semibold text-violet-700"
              >
                재시도
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
