"use client";
import { useRouter } from "next/navigation";
import { LensCardCropper } from "@/components/LensCardCropper";
import { useEffect, useRef, useState } from "react";
import { shouldReloadAiImageWorkList } from "@/lib/ai-image-batch-progress";
import {
  applyLocalDecisions,
  type AiImageDecision,
} from "@/lib/ai-image-local-decisions";
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
  canRestore?: boolean;
  /** 렌즈 원본과 찍었던 네 점. 있으면 영역을 다시 잡을 수 있다. */
  lensSourceUrl?: string | null;
  lensCorners?: Array<{ x: number; y: number }> | null;
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
// 렌즈 창은 하나만 띄운다. 검수하며 여러 장을 볼 때 창이 계속 늘어나지 않게 한다.
let lensWindow: Window | null = null;

export function AiImageWorkClient({
  items,
  billingUrl,
}: {
  items: Item[];
  billingUrl: string;
}) {
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
  const [lensUrl, setLensUrl] = useState("");
  const lensWaitingRef = useRef<{ item: Item; clipboard: string; notified?: boolean } | null>(null);
  // 미통과 카드에서 직접 작업할 때 그 카드를 가리킨다. 검수 카드가 아니라 이쪽에
  // 붙여넣어야 하므로 붙여넣기·클립보드 읽기가 이 카드를 대상으로 삼는다.
  const [handTarget, setHandTarget] = useState<Item | null>(null);
  const [cropTarget, setCropTarget] = useState<{
    item: Item;
    url: string;
    local?: boolean;
    /** 다시 잡기일 때 전에 찍었던 네 점 */
    corners?: Array<{ x: number; y: number }> | null;
  } | null>(null);
  const [upload, setUpload] = useState<{
    done: number;
    total: number;
    started: number;
  } | null>(null);
  // 사람이 방금 내린 판정. 서버 목록을 다시 받아도 이 판정이 덮어써지면 안 된다.
  const decisionsRef = useRef(new Map<string, AiImageDecision>());
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setLocalItems((current) =>
          applyLocalDecisions(current, items, decisionsRef.current),
        ),
      0,
    );
    return () => window.clearTimeout(timer);
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
  // 서버 배치가 만든 결과는 목록을 다시 받아야 검수 화면에 나타난다. 상태만
  // 갱신하면 진행률은 움직여도 검수 카드가 비어 있는 것처럼 보인다.
  const processedRef = useRef(-1);
  const refreshedAtRef = useRef(0);
  // 판정을 보내는 동안에는 목록을 다시 받지 않는다. 처리 이전 시점의 응답이
  // 끼어들면 방금 끝낸 카드가 다시 보였다 사라졌다 한다.
  const decidingRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const refreshBatch = async () => {
      try {
        const response = await call({ action: "apiBatchStatus" });
        if (cancelled) return;
        const batch = response.batch as ApiBatch | null;
        setApiBatch(batch);
        if (!batch || decidingRef.current > 0) return;
        const processed = batch.completedCount + batch.failedCount;
        const now = Date.now();
        const reload = shouldReloadAiImageWorkList({
          batch,
          lastProcessed: processedRef.current,
          lastReloadedAt: refreshedAtRef.current,
          now,
        });
        if (processedRef.current < 0) {
          processedRef.current = processed;
          return;
        }
        if (!reload) return;
        processedRef.current = processed;
        refreshedAtRef.current = now;
        router.refresh();
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
    // router는 안정된 참조이고 call은 상태를 읽지 않으므로 한 번만 등록한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // 이미 끝난 결과를 버리고 크레딧을 다시 쓰는 작업이라 실수로 누르면 안 된다.
    const affected = review.length + held.length + ready.length;
    if (
      !window.confirm(
        `지금까지의 결과를 버리고 처음부터 다시 처리합니다.

` +
          `검수 대기 ${review.length}개 · 보류 ${held.length}개 · 통과(업로드 대기) ${ready.length}개
` +
          `합계 ${affected}개가 대기열로 돌아가고, 다시 처리할 때 크레딧이 그만큼 더 듭니다.

` +
          `계속할까요?`,
      )
    )
      return;
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
    // 검수 카드로 판정을 내렸으면 미통과 카드를 붙들고 있던 손작업 대상을 놓는다.
    setHandTarget(null);
    const previous = localItems;
    const decided: AiImageDecision =
      action === "pass" ? "pass_ready" : action === "hold" ? "held" : "rework";
    decisionsRef.current.set(id, decided);
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
        ? "✓ 통과 · 상품 이미지로 업로드 중 · 다음 카드"
        : action === "hold"
          ? "⏸ 보류 완료 · 다음 카드"
          : "✕ 미통과 · 재작업 목록으로 이동",
    );
    window.setTimeout(() => setFlash(""), 900);
    decidingRef.current += 1;
    try {
      const response = await call({ action, id });
      if (action !== "pass") return;
      if (response.uploadError) {
        setMsg(
          `통과는 저장했지만 상품 이미지 업로드에 실패했습니다: ${response.uploadError} 아래 "통과 N개 일괄 업로드"로 다시 시도해 주세요.`,
        );
        return;
      }
      // 업로드까지 끝났거나 이미 처리된 카드다. 어느 쪽이든 목록에서 내린다.
      decisionsRef.current.set(id, "removed");
      setLocalItems((current) => current.filter((item) => item.id !== id));
      router.refresh();
    } catch (e) {
      decisionsRef.current.delete(id);
      setLocalItems(previous);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      decidingRef.current -= 1;
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
  // 구글렌즈로 찾은 이미지를 이 카드의 검수 결과로 저장한다. 사람이 고른 주소만
  // 서버가 내려받아 같은 규격(540×860·카드별 라운드·흰 배경)으로 맞춘다.
  async function applyLensCandidate(
    id: string,
    image: string,
    source?: { sourceImage: string; corners: Array<{ x: number; y: number }> },
  ) {
    if (!image || busy) return;
    setBusy(true);
    setMsg("잘라낸 카드를 검수 이미지로 저장하는 중…");
    try {
      const response = await call({ action: "lensCandidate", id, image, ...(source ?? {}) });
      setLensUrl("");
      setCropTarget(null);
      setHandTarget(null);
      lensWaitingRef.current = null;
      setLocalItems((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "review",
                previewUrl: response.url as string,
                previewVersion: Date.now().toString(),
                error: "구글렌즈에서 고른 이미지",
                canRestore: Boolean(response.canRestore),
                lensSourceUrl: (response.lensSourceUrl as string | null) ?? null,
                lensCorners:
                  (response.lensCorners as Array<{ x: number; y: number }> | null) ?? null,
              }
            : item,
        ),
      );
      setMsg(`${response.sku} 검수 이미지를 구글렌즈 결과로 교체했습니다. 확인 후 통과를 눌러 주세요.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function restoreAiPreview(item: Item) {
    if (busy) return;
    setBusy(true);
    setMsg("AI가 만든 결과로 되돌리는 중…");
    try {
      const response = await call({ action: "restoreAiPreview", id: item.id });
      setLocalItems((current) =>
        current.map((target) =>
          target.id === item.id
            ? {
                ...target,
                status: "review",
                previewUrl: response.url as string,
                previewVersion: Date.now().toString(),
                error: "AI 결과로 되돌림",
                canRestore: false,
              }
            : target,
        ),
      );
      setMsg(`${response.sku} 검수 이미지를 AI 결과로 되돌렸습니다.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openLens(item: Item) {
    if (!item.sourceUrl) return;
    setHandTarget(item);
    const url = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(item.sourceUrl)}`;
    // 돌아왔을 때 새로 복사한 주소인지 가리려고 지금 클립보드를 적어 둔다. 이 읽기는
    // 사람이 버튼을 누른 순간에 일어나므로 브라우저가 클립보드 권한을 물어본다.
    lensWaitingRef.current = { item, clipboard: "" };
    void navigator.clipboard
      ?.readText()
      .then((value) => {
        lensWaitingRef.current = { item, clipboard: value.trim() };
      })
      .catch(() => undefined);
    if (!lensWindow || lensWindow.closed) lensWindow = window.open(url, "photocard-google-lens");
    else {
      try {
        lensWindow.location.href = url;
      } catch {
        lensWindow = window.open(url, "photocard-google-lens");
      }
    }
    lensWindow?.focus();
    setMsg(
      "렌즈 창에서 쓸 사진을 마우스 오른쪽으로 눌러 '이미지 주소 복사'를 고르고 이 화면으로 돌아오세요. 자동으로 가져옵니다.",
    );
  }

  /** 클립보드의 주소를 가져와 잘라내기 창을 연다. */
  function applyClipboardUrl(item: Item, value: string, silent: boolean) {
    const url = value.trim();
    if (!/^https?:\/\//i.test(url)) {
      if (!silent)
        setMsg("복사한 것이 이미지 주소가 아닙니다. 사진 위에서 '이미지 주소 복사'를 골라 주세요.");
      return false;
    }
    setLensUrl(url);
    setCropTarget({ item, url });
    setMsg("복사한 주소를 가져왔습니다. 카드 네 모서리를 맞춰 주세요.");
    return true;
  }

  async function importFromClipboard(item: Item) {
    setHandTarget(item);
    try {
      applyClipboardUrl(item, await navigator.clipboard.readText(), false);
    } catch {
      setMsg(
        "브라우저가 클립보드 읽기를 막았습니다. 주소 칸을 누르고 Ctrl+V 로 붙여넣어 주세요.",
      );
    }
  }

  async function excludeProduct(item: Item) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const response = await call({
        action: "exclude",
        productIds: [item.productId],
      });
      if (!response.excluded)
        throw new Error(
          `${item.sku}은(는) 이미 처리 중이거나 제외할 수 없는 상태입니다.`,
        );
      decisionsRef.current.set(item.id, "removed");
      setLocalItems((current) =>
        current.filter((target) => target.id !== item.id),
      );
      setMsg(`${item.sku}을(를) 앞으로의 AI 작업에서 제외했습니다.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
  const elapsed = upload ? Math.max(0, (clock - upload.started) / 1000) : 0;
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
    // 브라우저는 스크립트가 몰래 클립보드를 읽는 것을 막는다. 사람이 Ctrl+V를 누르는
    // 순간에는 허락 없이도 내용을 받을 수 있으므로 붙여넣기를 받아 처리한다.
    // 렌즈에서 '이미지 복사'를 하면 그림 자체가, '이미지 주소 복사'를 하면 주소가 온다.
    const onPaste = (event: ClipboardEvent) => {
      const item = lensWaitingRef.current?.item ?? handTarget ?? current;
      if (!item || busy || upload) return;
      const data = event.clipboardData;
      if (!data) return;
      const file = Array.from(data.files).find((entry) => entry.type.startsWith("image/"));
      if (file) {
        event.preventDefault();
        setCropTarget({ item, url: URL.createObjectURL(file), local: true });
        setMsg("붙여넣은 사진에서 카드 네 모서리를 찍어 주세요.");
        return;
      }
      const text = data.getData("text").trim();
      if (!text || !/^https?:\/\//i.test(text)) return;
      const target = event.target as HTMLElement | null;
      // 주소 칸에 직접 붙여넣는 중이면 그대로 둔다.
      if (target instanceof HTMLElement && target.closest("input,textarea")) return;
      event.preventDefault();
      setLensUrl(text);
      setCropTarget({ item, url: text });
      setMsg("붙여넣은 주소를 가져왔습니다. 카드 네 모서리를 맞춰 주세요.");
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [current, handTarget, busy, upload]);
  useEffect(() => {
    // 렌즈 창에서 돌아오면 복사한 주소를 그대로 가져온다. 브라우저가 클립보드 읽기를
    // 허용한 뒤에는 이것만으로 끝난다. 아직 허용 전이면 조용히 실패하므로 화면의
    // '복사한 주소 가져오기'로 한 번 눌러 허용을 받는다.
    const onFocus = async () => {
      const waiting = lensWaitingRef.current;
      if (!waiting || busy || upload) return;
      try {
        const value = (await navigator.clipboard.readText()).trim();
        if (!value || value === waiting.clipboard) return;
        if (!/^https?:\/\//i.test(value)) return;
        lensWaitingRef.current = null;
        setLensUrl(value);
        setCropTarget({ item: waiting.item, url: value });
        setMsg("복사한 주소를 가져왔습니다. 카드 네 모서리를 맞춰 주세요.");
      } catch {
        // 허용 전이라 읽지 못했다. 안내는 렌즈 창을 연 뒤 한 번만 한다.
        if (waiting.notified) return;
        waiting.notified = true;
        setMsg(
          "복사한 주소를 자동으로 읽으려면 브라우저에서 클립보드 읽기를 한 번 허용해야 합니다. 아래 '복사한 주소 가져오기'를 누르고 허용을 골라 주세요. 그 뒤로는 자동으로 들어옵니다.",
        );
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [busy, upload]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!current || busy || upload) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // 수량 입력이나 미리보기 창에서 누른 키를 검수 판정으로 바꾸지 않는다.
      if (document.body.dataset.aiImagePreview === "open") return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLElement &&
        target.closest("input,select,textarea,[contenteditable='true']")
      )
        return;
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
          기존 검수 결과 버리고 재처리
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
          <span className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">30초마다 자동 갱신</span>
            <a
              href={billingUrl}
              target="_blank"
              rel="noreferrer"
              className={`cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-white ${
                creditShortage ? "bg-red-600 hover:bg-red-500" : "bg-zinc-900 hover:bg-zinc-700"
              }`}
            >
              크레딧 충전하기
            </a>
          </span>
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
              {creditShortage ? (
                <a
                  href={billingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block font-bold underline"
                >
                  지금 충전하기 →
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            {creditError || "크레딧 잔액을 확인하는 중입니다…"}
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          일반 API는 장당 1크레딧, PRO는 장당 3크레딧으로 계산됩니다. 충전은
          Dewatermark 계정에서 직접 결제하며, 결제 후 이 화면의 잔액은 30초 안에
          갱신됩니다.{" "}
          <a
            href="https://dewatermark.ai/ko/api-pricing"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            크레딧 요금표 보기
          </a>
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
          업로드하지 못한 통과분 {ready.length}개가 남아 있습니다. 아래 일괄 업로드로 다시 올려 주세요.
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
                  loading="lazy"
                  decoding="async"
                  src={current.sourceUrl}
                  alt="원본"
                  className="h-[min(62vh,620px)] w-full rounded bg-zinc-100 object-contain"
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold">AI 자동 처리 결과</p>
                <img
                  loading="lazy"
                  decoding="async"
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
              <button
                type="button"
                disabled={busy}
                onClick={() => openLens(current)}
                className="cursor-pointer rounded-lg border px-5 py-3 font-semibold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                구글렌즈로 검색
              </button>
              <a
                href={`/products/${current.productId}`}
                target="_blank"
                rel="noreferrer"
                className="cursor-pointer rounded-lg border px-5 py-3 font-semibold hover:bg-zinc-50"
              >
                상품 열기
              </a>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border bg-zinc-50 p-3">
              <span className="text-sm font-semibold text-zinc-700">
                구글렌즈에서 고른 이미지 주소
              </span>
              <input
                value={lensUrl}
                onChange={(event) => setLensUrl(event.target.value)}
                placeholder="렌즈에서 복사하면 자동으로 들어옵니다 · Ctrl+V 도 됩니다"
                className="min-w-0 flex-1 rounded border px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => importFromClipboard(current)}
                className="cursor-pointer rounded border border-violet-400 px-4 py-2 text-sm font-bold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                복사한 주소 가져오기
              </button>
              <button
                type="button"
                disabled={busy || !lensUrl.trim()}
                onClick={() => setCropTarget({ item: current, url: lensUrl.trim() })}
                className="cursor-pointer rounded bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                카드 영역 선택
              </button>
              {current.lensSourceUrl ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setCropTarget({
                      item: current,
                      url: current.lensSourceUrl!,
                      corners: current.lensCorners ?? null,
                    })
                  }
                  className="cursor-pointer rounded border border-violet-500 px-4 py-2 text-sm font-bold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  영역 다시 잡기
                </button>
              ) : null}
              {current.canRestore ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => restoreAiPreview(current)}
                  className="cursor-pointer rounded border border-zinc-400 px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  AI 결과로 되돌리기
                </button>
              ) : null}
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
              미통과 항목을 새 엔진으로 처리한 뒤 다시 검수 대기에 올립니다. 아래 카드는
              왼쪽이 포카마켓 원본, 오른쪽이 미통과된 결과입니다.
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
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {rework.map((item) => (
              <li key={`${item.id}-card`} className="rounded-lg border bg-white p-2">
                <div className="grid grid-cols-2 gap-1">
                  <img
                    loading="lazy"
                    decoding="async"
                    src={item.sourceUrl}
                    alt={`${item.sku} 원본`}
                    className="aspect-[2/3] w-full rounded bg-zinc-100 object-contain"
                  />
                  <img
                    loading="lazy"
                    decoding="async"
                    src={
                      item.previewUrl
                        ? `${item.previewUrl}${item.previewUrl.includes("?") ? "&" : "?"}v=${item.previewVersion}`
                        : item.sourceUrl
                    }
                    alt={`${item.sku} 미통과 결과`}
                    className="aspect-[2/3] w-full rounded bg-zinc-100 object-contain"
                  />
                </div>
                <div className="mt-2 text-xs">
                  <strong className="block">{item.sku}</strong>
                  <span className="line-clamp-2 text-zinc-500">{item.productName}</span>
                </div>
                <button
                  disabled={busy}
                  onClick={() => reprocessOne(item)}
                  className="mt-2 w-full cursor-pointer rounded border px-2 py-1.5 text-xs font-bold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  즉시 자동 재처리
                </button>
                {/* 자동 재처리로 안 되는 카드는 여기서 바로 손으로 고친다. */}
                <div className="mt-1 grid grid-cols-2 gap-1">
                  <button
                    disabled={busy || !item.sourceUrl}
                    onClick={() => openLens(item)}
                    className="cursor-pointer rounded border border-violet-300 px-1 py-1.5 text-[11px] font-bold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    구글렌즈
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => importFromClipboard(item)}
                    className="cursor-pointer rounded border border-violet-300 px-1 py-1.5 text-[11px] font-bold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    주소 가져오기
                  </button>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    setCropTarget({ item, url: item.previewUrl || item.sourceUrl })
                  }
                  className="mt-1 w-full cursor-pointer rounded border border-emerald-300 px-2 py-1.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {item.previewUrl ? "결과에서 다시 잘라내기" : "원본에서 잘라내기"}
                </button>
                {handTarget?.id === item.id ? (
                  <p className="mt-1 text-[11px] font-semibold text-violet-800">
                    이 카드로 작업 중 · 복사한 주소를 Ctrl+V 하면 이 카드에 들어갑니다
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
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
                <button
                  disabled={busy || !item.sourceUrl}
                  onClick={() => openLens(item)}
                  className="cursor-pointer rounded border border-violet-300 px-3 py-1.5 font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  구글렌즈로 검색
                </button>
                <button
                  disabled={busy}
                  onClick={() => importFromClipboard(item)}
                  className="cursor-pointer rounded border border-violet-300 px-3 py-1.5 font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  복사한 주소 가져오기
                </button>
                <button
                  disabled={busy || !item.previewUrl}
                  onClick={() => setCropTarget({ item, url: item.previewUrl ?? "" })}
                  className="cursor-pointer rounded border border-emerald-300 px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  결과에서 다시 잘라내기
                </button>
                <button
                  disabled={busy || !item.sourceUrl}
                  onClick={() => setCropTarget({ item, url: item.sourceUrl })}
                  className="cursor-pointer rounded border border-emerald-300 px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  원본에서 잘라내기
                </button>
                <a
                  href={`/products/${item.productId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="cursor-pointer rounded bg-zinc-900 px-3 py-1.5 font-semibold text-white"
                >
                  상품 열기
                </a>
                <button
                  disabled={busy}
                  onClick={() => excludeProduct(item)}
                  className="cursor-pointer rounded border border-rose-300 px-3 py-1.5 font-semibold text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  작업 제외
                </button>
              </div>
            </div>
          ))}
        </details>
      )}
      {cropTarget ? (
        <LensCardCropper
          productId={cropTarget.item.productId}
          imageUrl={cropTarget.url}
          local={cropTarget.local}
          onCancel={() => setCropTarget(null)}
          initialCorners={cropTarget.corners ?? null}
          onCropped={(dataUrl, source) =>
            applyLensCandidate(cropTarget.item.id, dataUrl, source)
          }
        />
      ) : null}
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
              <span className="flex gap-3">
                <button
                  onClick={() => retry(i.id)}
                  className="cursor-pointer font-semibold text-violet-700"
                >
                  재시도
                </button>
                <button
                  disabled={busy}
                  onClick={() => excludeProduct(i)}
                  className="cursor-pointer font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  작업 제외
                </button>
              </span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
