"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type Item = {
  id: string; productNumber: string; previousPrice: string | null;
  previousAvailableCount: number | null; previousIsSoldOut: boolean | null;
  observedPrice: string | null; observedAvailableCount: number | null;
  availability: string | null; status: string;
  errorMessage: string | null; errorCode: string | null; retryCount: number;
  responseAdapter: string | null; appliedAt: string | null;
  product: { productName: string };
};
type Batch = {
  id: string; status: string; totalCount: number; scannedCount: number;
  errorMessage: string | null; createdAt: string; startedAt: string | null;
  completedAt: string | null; updatedAt: string; items: Item[];
};
type Settings = {
  enabled: boolean; scheduledHour: number; dailyBatchSize: number; speedProfile: string;
  priorityStrategy: string;
};
type Summary = {
  totalProductCount: number;
  totalCount: number;
  invalidIdCount: number;
  missingIdCount: number;
  nonActiveIncludedCount: number;
  neverAttemptedCount: number;
  successfullySyncedCount: number;
  needsAttentionCount: number;
  nextBatchCount: number;
  estimatedCycleDays: number;
  excludedProducts: Array<{
    id: string;
    sku: string;
    productName: string;
    pocamarketId: string | null;
    reason: string;
  }>;
};

const terminal = new Set(["READY", "APPLIED", "FAILED", "PAUSED", "CANCELLED"]);
const applicable = new Set(["CHANGED", "UNCHANGED", "SOLD_OUT"]);
const statusLabel: Record<string, string> = {
  QUEUED: "서버 대기", RUNNING: "수집 중", READY: "결과 확인",
  APPLIED: "반영 완료", FAILED: "중단됨", PAUSED: "일시정지",
  CANCELLED: "정지됨",
  CHANGED: "가격 변경",
  UNCHANGED: "변경 없음", SOLD_OUT: "품절", ANOMALY: "이상 변동",
};

function duration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return `${hours ? `${hours}시간 ` : ""}${minutes ? `${minutes}분 ` : ""}${rest}초`;
}

function itemAlert(item: Item) {
  if (item.status === "SOLD_OUT" && item.previousIsSoldOut === false) {
    return "새로 품절";
  }
  if (item.availability === "AVAILABLE" && item.previousIsSoldOut === true) {
    return "판매 재개";
  }
  const previousPrice = Number(item.previousPrice);
  const observedPrice = Number(item.observedPrice);
  if (previousPrice > 0 && observedPrice > 0) {
    const change = (observedPrice - previousPrice) / previousPrice;
    if (Math.abs(change) >= 0.2) {
      return `가격 ${change > 0 ? "상승" : "하락"} ${Math.round(
        Math.abs(change) * 100,
      )}%`;
    }
  }
  if (
    item.previousAvailableCount &&
    item.observedAvailableCount !== null &&
    item.observedAvailableCount <= item.previousAvailableCount / 2
  ) {
    return "매물 급감";
  }
  return null;
}

export function PocamarketSyncClient({
  initialBatches,
  initialSettings,
  initialSummary,
}: {
  initialBatches: Batch[];
  initialSettings: Settings;
  initialSummary: Summary;
}) {
  const [batches, setBatches] = useState(initialBatches);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState(initialSettings);
  const [summary, setSummary] = useState(initialSummary);
  const [itemQuery, setItemQuery] = useState("");
  const [itemStatus, setItemStatus] = useState("ALL");
  const [errorCodeFilter, setErrorCodeFilter] = useState("ALL");
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthMessage, setHealthMessage] = useState("");
  const [batchSize, setBatchSize] = useState(
    String(Math.min(1_000, Math.max(1, initialSummary.totalCount))),
  );
  const [now, setNow] = useState(0);
  const activeBatchId =
    batches.find((batch) => ["QUEUED", "RUNNING"].includes(batch.status))?.id ??
    null;
  const refresh = useCallback(async () => {
    const response = await fetch("/api/pocamarket-sync/batches", { cache: "no-store" });
    const body = await response.json();
    if (response.ok) {
      setBatches(body.batches);
      if (body.summary) setSummary(body.summary);
    }
  }, []);
  const kickWorker = useCallback(async (batchId: string) => {
    await fetch(`/api/pocamarket-sync/batches/${batchId}/process`, {
      method: "POST",
    });
  }, []);

  useEffect(() => {
    const immediate = window.setTimeout(() => setNow(Date.now()), 0);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(immediate);
      window.clearInterval(clock);
    };
  }, []);
  useEffect(() => {
    const active = batches.find((batch) => !terminal.has(batch.status));
    if (!active) return;
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [batches, refresh]);
  useEffect(() => {
    if (!activeBatchId) return;
    const initial = window.setTimeout(() => void kickWorker(activeBatchId), 500);
    return () => {
      window.clearTimeout(initial);
    };
  }, [activeBatchId, kickWorker]);

  async function start() {
    const requestedCount = Number(batchSize);
    if (
      !Number.isInteger(requestedCount) ||
      requestedCount < 1 ||
      requestedCount > 10_000
    ) {
      setMessage("최신화 개수는 1개 이상 10,000개 이하로 입력해 주세요.");
      return;
    }
    const actualCount = Math.min(requestedCount, summary.totalCount);
    if (!window.confirm(`마지막 시도가 가장 오래된 상품 ${actualCount.toLocaleString()}개를 최신화할까요? 다음 실행은 그다음 상품부터 이어집니다.`)) return;
    setBusy(true); setMessage("");
    const response = await fetch("/api/pocamarket-sync/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: requestedCount }),
    });
    const body = await response.json();
    setMessage(response.ok ? "서버 최신화를 시작했습니다. 완료 후 다시 누르면 다음 순서의 상품을 처리합니다." : body.error ?? "작업을 만들지 못했습니다.");
    await refresh(); setBusy(false);
  }

  async function startUnsynced() {
    if (
      !window.confirm(
        `아직 정상 반영되지 않은(확인 필요) 상품 ${summary.needsAttentionCount.toLocaleString()}개와 미시도 ${summary.neverAttemptedCount.toLocaleString()}개를 최신화할까요?`,
      )
    )
      return;
    setBusy(true); setMessage("");
    const response = await fetch("/api/pocamarket-sync/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "unsynced" }),
    });
    const body = await response.json();
    setMessage(response.ok ? "확인 필요(미완료) 상품만 최신화를 시작했습니다." : body.error ?? "작업을 만들지 못했습니다.");
    await refresh(); setBusy(false);
  }

  async function saveSettings() {
    if (
      !Number.isInteger(settings.dailyBatchSize) ||
      settings.dailyBatchSize < 1 ||
      settings.dailyBatchSize > 10_000
    ) {
      setMessage("하루 처리 개수는 1개 이상 10,000개 이하로 입력해 주세요.");
      return;
    }
    setBusy(true);
    const response = await fetch("/api/pocamarket-sync/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    const body = await response.json();
    setMessage(response.ok ? "예약과 속도 설정을 저장했습니다." : body.error ?? "설정을 저장하지 못했습니다.");
    setBusy(false);
  }

  async function resume(batch: Batch, errorCode?: string) {
    setBusy(true);
    const response = await fetch(`/api/pocamarket-sync/batches/${batch.id}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ errorCode }),
    });
    const body = await response.json();
    setMessage(response.ok ? `미완료 ${body.resumedCount}개를 이어서 수집합니다.` : body.error ?? "이어하지 못했습니다.");
    await refresh(); setBusy(false);
  }

  async function pause(batch: Batch) {
    setBusy(true);
    const response = await fetch(`/api/pocamarket-sync/batches/${batch.id}/pause`, {
      method: "POST",
    });
    const body = await response.json();
    setMessage(
      response.ok
        ? "일시정지를 요청했습니다. 현재 조회 중인 카드까지 마친 뒤 멈춥니다."
        : body.error ?? "일시정지하지 못했습니다.",
    );
    await refresh();
    setBusy(false);
  }

  async function stop(batch: Batch) {
    if (!window.confirm("이 최신화 작업을 완전히 정지할까요? 남은 항목은 취소되며 자동으로 다시 시작되지 않습니다.")) return;
    setBusy(true);
    const response = await fetch(`/api/pocamarket-sync/batches/${batch.id}/stop`, {
      method: "POST",
    });
    const body = await response.json();
    setMessage(
      response.ok
        ? `최신화를 정지했습니다. 남은 ${body.stoppedCount}개 항목은 취소됐습니다.`
        : body.error ?? "최신화를 정지하지 못했습니다.",
    );
    await refresh();
    setBusy(false);
  }

  async function checkApiHealth() {
    setHealthChecking(true);
    setHealthMessage("");
    const response = await fetch("/api/pocamarket-sync/health", {
      method: "POST",
    });
    const body = await response.json();
    setHealthMessage(
      response.ok
        ? `정상 · ${body.adapter} · ${body.latencyMs.toLocaleString()}ms`
        : body.schemaChanged
          ? `API 구조 변경 의심 · ${body.error}`
          : `연결 확인 실패 · ${body.error}`,
    );
    setHealthChecking(false);
  }

  return <section className="space-y-5">
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-lg font-bold">자동 최신화 설정</h2><p className="mt-1 text-sm text-zinc-600">휴대폰 없이 서버가 하루 한 번 다음 순서의 상품을 최신화합니다.</p></div>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((value) => ({ ...value, enabled: event.target.checked }))} className="h-4 w-4"/>자동 최신화 사용</label>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_180px_1fr_220px_auto]">
        <label className="rounded-xl border border-violet-200 bg-violet-50 p-3">
          <span className="text-sm font-semibold text-violet-950">
            매일 자동 시작 시간
          </span>
          <select
            disabled={!settings.enabled}
            value={settings.scheduledHour}
            onChange={(event) =>
              setSettings((value) => ({
                ...value,
                scheduledHour: Number(event.target.value),
              }))
            }
            className="mt-2 block w-full rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm disabled:bg-zinc-100"
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {hour.toString().padStart(2, "0")}:00 ~ {hour
                  .toString()
                  .padStart(2, "0")}:59
              </option>
            ))}
          </select>
          <span className="mt-2 block text-xs leading-5 text-violet-800">
            한국시간 기준입니다. 무료 서버 특성상 선택한 시간대 안에서 시작되며 분 단위는
            지정할 수 없습니다.
          </span>
        </label>
        <label className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <span className="text-sm font-semibold text-emerald-950">
            하루 처리 개수
          </span>
          <input
            type="number"
            min={1}
            max={10_000}
            step={1}
            disabled={!settings.enabled}
            value={settings.dailyBatchSize}
            onChange={(event) =>
              setSettings((value) => ({
                ...value,
                dailyBatchSize: Number(event.target.value),
              }))
            }
            className="mt-2 block w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-right text-sm disabled:bg-zinc-100"
          />
          <span className="mt-2 block text-xs leading-5 text-emerald-800">
            매일 예약 실행 시 1~10,000개를 처리합니다.
          </span>
        </label>
        <div><p className="text-sm font-medium">수집 속도</p><div className="mt-1 grid gap-2 sm:grid-cols-2">
          {[
            ["AUTO","자동 조절","응답 속도·오류에 따라 1~7초 자동 조절 · 권장"],
            ["FAST","빠름","약 20~30분/1,000개 · 차단 위험 증가"],
            ["BALANCED","균형","약 34~50분/1,000개 · 권장"],
            ["SAFE","안전","약 50~90분/1,000개"],
          ].map(([value,label,detail]) => <button type="button" key={value} onClick={() => setSettings((current) => ({ ...current, speedProfile: value }))} className={`rounded-xl border p-3 text-left ${settings.speedProfile === value ? "border-violet-600 bg-violet-50" : "border-zinc-200"}`}><b className="block text-sm">{label}</b><span className="text-xs text-zinc-500">{detail}</span></button>)}
        </div></div>
        <label className="text-sm font-medium">
          처리 우선순위
          <select
            value={settings.priorityStrategy}
            onChange={(event) =>
              setSettings((value) => ({
                ...value,
                priorityStrategy: event.target.value,
              }))
            }
            className="mt-1 block w-full rounded-xl border border-zinc-300 px-3 py-2.5"
          >
            <option value="SMART">스마트 권장</option>
            <option value="MISSING_PRICE">가격 없는 상품 나중</option>
            <option value="NEVER_SYNCED">한 번도 안 한 상품 우선</option>
            <option value="OLDEST">가장 오래된 상품 우선</option>
            <option value="PRICE_CHANGED">최근 변동 상품 우선</option>
          </select>
          <span className="mt-2 block text-xs font-normal leading-5 text-zinc-500">
            같은 우선순위에서는 마지막 시도가 오래된 상품부터 처리합니다.
          </span>
        </label>
        <button disabled={busy} onClick={saveSettings} className="self-end rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">설정 저장</button>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ["전체 상품", summary.totalProductCount, "재고관리에 등록된 상품"],
        ["최신화 대상", summary.totalCount, `상태와 무관하게 포함 · 비판매중 ${summary.nonActiveIncludedCount.toLocaleString()}개`],
        ["최신화 완료", summary.successfullySyncedCount, "한 번 이상 정상 반영됨"],
        ["아직 미시도", summary.neverAttemptedCount, "다음 실행에서 우선 처리"],
        ["확인 필요", summary.needsAttentionCount, "시도했지만 정상 반영되지 않음"],
        ["상품번호 확인", summary.invalidIdCount + summary.missingIdCount, `형식 오류 ${summary.invalidIdCount.toLocaleString()} · 없음 ${summary.missingIdCount.toLocaleString()}`],
        ["전체 순환 예상", Math.max(1, Math.ceil(summary.totalCount / Math.max(1, settings.dailyBatchSize || 1))), `하루 ${Number.isInteger(settings.dailyBatchSize) && settings.dailyBatchSize > 0 ? settings.dailyBatchSize.toLocaleString() : "-"}개 기준`],
      ].map(([label, value, detail]) => (
        <div key={String(label)} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-zinc-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-zinc-950">
            {Number(value).toLocaleString()}
            {label === "전체 순환 예상" ? "일" : "개"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{detail}</p>
        </div>
      ))}
    </div>
    {summary.excludedProducts.length ? (
      <details className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-amber-950">
          최신화에서 제외된 상품 확인
        </summary>
        <p className="mt-2 text-xs text-amber-800">
          포카마켓 API 조회에는 숫자로 된 카드 상품번호가 필요합니다. 아래 상품은 상품
          상세에서 번호를 수정하면 다음 최신화부터 자동 포함됩니다.
        </p>
        <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-amber-200 bg-white">
          {summary.excludedProducts.map((product) => (
            <a
              key={product.id}
              href={`/products/${product.id}/edit`}
              className="grid gap-1 border-b px-3 py-2 text-xs hover:bg-amber-50 sm:grid-cols-[140px_1fr_180px]"
            >
              <b>{product.sku}</b>
              <span>{product.productName}</span>
              <span className="text-amber-700">{product.reason}</span>
            </a>
          ))}
        </div>
        {summary.invalidIdCount + summary.missingIdCount > summary.excludedProducts.length ? (
          <p className="mt-2 text-xs text-amber-700">
            우선 50개만 표시합니다.
          </p>
        ) : null}
      </details>
    ) : null}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
      <div>
        <p className="text-sm font-semibold text-sky-950">포카마켓 API 상태</p>
        <p className="mt-1 text-xs text-sky-800">
          실제 카드 한 장으로 조회 주소와 응답 구조를 확인합니다. API가 바뀌면 구조 변경
          의심으로 구분해 알려줍니다.
        </p>
        {healthMessage ? (
          <p className="mt-2 text-sm font-semibold text-sky-900">{healthMessage}</p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={healthChecking}
        onClick={checkApiHealth}
        className="rounded-xl border border-sky-600 bg-white px-4 py-2 text-sm font-semibold text-sky-800 disabled:opacity-50"
      >
        {healthChecking ? "점검 중..." : "API 연결 점검"}
      </button>
    </div>
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-lg font-bold">최신화 작업</h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600">마지막 조회 시도가 가장 오래된 상품부터 입력한 개수만큼 처리합니다. 완료 후 다시 실행하면 앞서 처리한 상품을 반복하지 않고 다음 순서로 넘어갑니다. 실패 상품도 마지막 시각 기준으로 다시 순서가 돌아옵니다.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm font-semibold text-zinc-700">
            최신화 개수
            <input
              type="number"
              min={1}
              max={10_000}
              step={1}
              value={batchSize}
              onChange={(event) => setBatchSize(event.target.value)}
              className="mt-1 block w-36 rounded-xl border border-zinc-300 px-3 py-2.5 text-right"
            />
          </label>
          <button disabled={busy || batches.some((batch) => ["QUEUED","RUNNING","PAUSED"].includes(batch.status))} onClick={start} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">지금 최신화 시작</button>
          <button disabled={busy || batches.some((batch) => ["QUEUED","RUNNING","PAUSED"].includes(batch.status))} onClick={startUnsynced} className="rounded-xl border border-violet-600 px-4 py-2.5 text-sm font-semibold text-violet-700 disabled:opacity-40">확인 필요만 최신화</button>
        </div>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        수동 실행은 한 번에 최대 10,000개까지 선택할 수 있습니다. 개수가 많을수록 완료 시간이 길어집니다.
        매일 예약 실행 개수는 위 자동 최신화 설정에서 변경할 수 있으며 기본값은 1,000개입니다.
      </p>
      {message && <p className="mt-3 text-sm font-medium text-violet-700">{message}</p>}
    </div>
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-sm font-semibold text-emerald-950">결과는 자동으로 반영됩니다</p>
      <p className="mt-1 text-xs leading-5 text-emerald-800">
        정상적으로 확인된 포카마켓 가격·판매 가능 여부·판매 매물 수는 수집 즉시 재고관리에 반영됩니다.
        가격 변동 폭과 관계없이 반영하며, 조회에 실패한 상품만 아래에 확인 필요로 남깁니다.
        내부 보유 재고 수량은 변경하지 않습니다.
      </p>
    </div>
    <div className="flex flex-wrap gap-2 rounded-2xl border border-zinc-200 bg-white p-3">
      <input
        value={itemQuery}
        onChange={(event) => setItemQuery(event.target.value)}
        placeholder="상품번호 또는 상품명 검색"
        className="min-w-64 flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm"
      />
      <select
        value={itemStatus}
        onChange={(event) => setItemStatus(event.target.value)}
        className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
      >
        <option value="ALL">전체 처리 상태</option>
        <option value="QUEUED">대기</option>
        <option value="RUNNING">처리 중</option>
        <option value="FAILED">실패</option>
        <option value="ANOMALY">가격 이상 변동</option>
        <option value="CHANGED">가격 변경</option>
        <option value="UNCHANGED">변경 없음</option>
        <option value="SOLD_OUT">품절</option>
      </select>
      <select
        value={errorCodeFilter}
        onChange={(event) => setErrorCodeFilter(event.target.value)}
        className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
      >
        <option value="ALL">전체 오류 원인</option>
        {[...new Set(batches.flatMap((batch) => batch.items.map((item) => item.errorCode).filter((value): value is string => Boolean(value))))].map((code) => (
          <option key={code} value={code}>{code}</option>
        ))}
      </select>
    </div>
    {batches.map((batch) => {
      const normalizedQuery = itemQuery.trim().toLowerCase();
      const visibleItems = batch.items.filter(
        (item) =>
          (itemStatus === "ALL" || item.status === itemStatus) &&
          (errorCodeFilter === "ALL" || item.errorCode === errorCodeFilter) &&
          (!normalizedQuery ||
            item.productNumber.toLowerCase().includes(normalizedQuery) ||
            item.product.productName.toLowerCase().includes(normalizedQuery)),
      );
      const progress = batch.totalCount ? Math.round(batch.scannedCount / batch.totalCount * 100) : 0;
      const elapsedUntil = batch.completedAt
        ? new Date(batch.completedAt).getTime()
        : terminal.has(batch.status)
          ? new Date(batch.updatedAt).getTime()
          : now;
      const elapsed = batch.startedAt ? Math.max(0, (elapsedUntil - new Date(batch.startedAt).getTime()) / 1000) : 0;
      const appliedCount = batch.items.filter((item) => item.appliedAt).length;
      const attentionCount = batch.items.filter((item) =>
        ["ANOMALY", "FAILED"].includes(item.status),
      ).length;
      const secondsPerItem = batch.scannedCount
        ? Math.min(10, Math.max(1, elapsed / batch.scannedCount))
        : null;
      const eta = secondsPerItem === null
        ? null
        : secondsPerItem * Math.max(0, batch.totalCount - batch.scannedCount);
      const stalled =
        ["QUEUED", "RUNNING"].includes(batch.status) &&
        now - new Date(batch.updatedAt).getTime() > 120_000;
      return <article key={batch.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <header className="border-b p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="flex items-center gap-2 font-bold">{["QUEUED","RUNNING"].includes(batch.status) ? <Loader2 className="h-4 w-4 animate-spin text-violet-600"/> : null}{new Date(batch.createdAt).toLocaleString()} · {statusLabel[batch.status] ?? batch.status}</h3><p className="text-sm text-zinc-500">{batch.scannedCount}/{batch.totalCount} · {progress}% · 경과 {duration(elapsed)} · {terminal.has(batch.status) ? `자동 반영 ${appliedCount}개 · 확인 필요 ${attentionCount}개` : `예상 남은 시간 ${eta === null ? "첫 결과 계산 중" : duration(eta)}`}</p>{stalled && <p className="mt-1 text-sm font-semibold text-amber-700">작업 정체를 감지했습니다. 자동 복구를 시도하고 있습니다.</p>}</div>
            <div className="flex gap-2">
              <a href={`/api/pocamarket-sync/batches/${batch.id}/export`} className="rounded-xl border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700">결과 CSV</a>
              {["QUEUED","RUNNING"].includes(batch.status) && <button disabled={busy} onClick={() => pause(batch)} className="rounded-xl border border-zinc-400 px-4 py-2 text-sm font-semibold text-zinc-700">일시정지</button>}
              {["QUEUED","RUNNING","PAUSED"].includes(batch.status) && <button disabled={busy} onClick={() => stop(batch)} className="rounded-xl border border-red-600 px-4 py-2 text-sm font-semibold text-red-700">정지</button>}
              {stalled && <button disabled={busy} onClick={() => void kickWorker(batch.id)} className="rounded-xl border border-amber-600 px-4 py-2 text-sm font-semibold text-amber-700">작업 복구</button>}
              {["FAILED","PAUSED"].includes(batch.status) && <button disabled={busy} onClick={() => resume(batch)} className="rounded-xl border border-amber-600 px-4 py-2 text-sm font-semibold text-amber-700">{batch.status === "PAUSED" ? "중단 지점부터 재시작" : "미완료만 이어하기"}</button>}
              {["READY","APPLIED"].includes(batch.status) && batch.items.some((item) => item.status === "FAILED") && <button disabled={busy} onClick={() => resume(batch)} className="rounded-xl border border-amber-600 px-4 py-2 text-sm font-semibold text-amber-700">실패만 재시도</button>}
              {["READY","APPLIED"].includes(batch.status) && errorCodeFilter !== "ALL" && batch.items.some((item) => item.status === "FAILED" && item.errorCode === errorCodeFilter) && <button disabled={busy} onClick={() => resume(batch, errorCodeFilter)} className="rounded-xl border border-red-600 px-4 py-2 text-sm font-semibold text-red-700">{errorCodeFilter}만 재시도</button>}
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-violet-600 transition-all" style={{ width: `${progress}%` }}/></div>
          {batch.errorMessage && <p className="mt-2 text-sm text-red-600">{batch.errorMessage}</p>}
        </header>
        <div className="max-h-[520px] overflow-auto"><table className="w-full min-w-[900px] text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-zinc-500"><tr>{["상품","이전 가격","확인 가격","판매 매물 수","변화 알림","판매 상태","판정","처리 결과"].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead>
          <tbody>{visibleItems.map((item) => <tr key={item.id} className="border-t">
            <td className="px-3 py-3"><b>{item.productNumber}</b><br/><span className="text-zinc-500">{item.product.productName}</span></td>
            <td className="px-3">{item.previousPrice ? `${Number(item.previousPrice).toLocaleString()}원` : "-"}</td>
            <td className="px-3">{item.observedPrice ? `${Number(item.observedPrice).toLocaleString()}원` : "-"}</td>
            <td className="px-3">{item.observedAvailableCount ?? "-"}</td>
            <td className="px-3">{itemAlert(item) ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">{itemAlert(item)}</span> : "-"}</td>
            <td className="px-3">{item.availability === "SOLD_OUT" ? "품절" : item.availability === "AVAILABLE" ? "판매 가능" : "-"}</td>
            <td className={`px-3 font-medium ${["ANOMALY","FAILED"].includes(item.status) ? "text-red-600" : ""}`}>{statusLabel[item.status] ?? item.status}{item.errorCode && <span className="block text-[11px] font-semibold">{item.errorCode} · 재시도 {item.retryCount}회</span>}{item.errorMessage && <span className="block max-w-sm text-xs font-normal">{item.errorMessage}</span>}</td>
            <td className="px-3">{item.appliedAt ? "자동 반영 완료" : applicable.has(item.status) ? "자동 반영 처리 중" : ["ANOMALY", "FAILED"].includes(item.status) ? "확인 필요" : "-"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>;
    })}
  </section>;
}
