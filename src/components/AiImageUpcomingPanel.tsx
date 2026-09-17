"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AiImageWorkExcludedItem,
  AiImageWorkPreviewItem,
} from "@/lib/ai-image-work";

type Props = {
  upcoming: AiImageWorkPreviewItem[];
  upcomingTotal: number;
  excluded: AiImageWorkExcludedItem[];
  excludedTotal: number;
  pageSize: number;
};

function supplyLabel(item: AiImageWorkPreviewItem) {
  return item.stockQuantity > 0
    ? `보유 ${item.stockQuantity}장`
    : `조달 ${item.supplyCount}장`;
}

function excludedAtLabel(value: string | null) {
  if (!value) return "제외 시각 미기록";
  return new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function AiImageUpcomingPanel({
  upcoming,
  upcomingTotal,
  excluded,
  excludedTotal,
  pageSize,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState(upcoming);
  const [total, setTotal] = useState(upcomingTotal);
  const [excludedItems, setExcludedItems] = useState(excluded);
  const [excludedCount, setExcludedCount] = useState(excludedTotal);
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // 서버가 보낸 첫 페이지는 시작값으로만 쓴다. 더 불러온 페이지와 방금 제외한 결과를
  // 화면 갱신 때마다 잃지 않도록, 목록을 다시 맞추는 일은 아래 새로고침이 담당한다.
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const call = useCallback(async (body: object) => {
    const response = await fetch("/api/ai-image-work", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await response.json();
    if (!response.ok) throw new Error(parsed.error || "처리에 실패했습니다.");
    return parsed;
  }, []);
  async function loadMore() {
    setBusy(true);
    setMsg("");
    try {
      const response = await call({
        action: "upcoming",
        offset: items.length,
        limit: pageSize,
      });
      const next = response.items as AiImageWorkPreviewItem[];
      setItems((current) => {
        const seen = new Set(current.map((item) => item.productId));
        return [...current, ...next.filter((item) => !seen.has(item.productId))];
      });
      if (next.length) setTotal(response.total as number);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function loadMoreExcluded() {
    setBusy(true);
    setMsg("");
    try {
      const response = await call({
        action: "excludedList",
        offset: excludedItems.length,
        limit: pageSize,
      });
      const next = response.items as AiImageWorkExcludedItem[];
      setExcludedItems((current) => {
        const seen = new Set(current.map((item) => item.productId));
        return [...current, ...next.filter((item) => !seen.has(item.productId))];
      });
      if (next.length) setExcludedCount(response.total as number);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    setMsg("");
    try {
      const [nextUpcoming, nextExcluded] = await Promise.all([
        call({ action: "upcoming", offset: 0, limit: pageSize }),
        call({ action: "excludedList", offset: 0, limit: pageSize }),
      ]);
      setItems(nextUpcoming.items as AiImageWorkPreviewItem[]);
      setTotal(nextUpcoming.total as number);
      setExcludedItems(nextExcluded.items as AiImageWorkExcludedItem[]);
      setExcludedCount(nextExcluded.total as number);
      setSelected([]);
      setPreviewIndex(null);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  // 고른 상품을 대기열 맨 앞으로 보내고 바로 처리까지 시작한다.
  async function prioritize(productIds: string[]) {
    if (!productIds.length || busy) return;
    // 처리 한 장마다 크레딧이 든다. 돈이 나가는 일은 사람이 확인하고 시작한다.
    if (
      !window.confirm(
        `${productIds.length}개를 지금 처리합니다. 크레딧 ${productIds.length}개가 쓰입니다. 시작할까요?`,
      )
    )
      return;
    setBusy(true);
    setMsg("");
    try {
      const response = await call({ action: "prioritize", productIds, start: true });
      setSelected([]);
      setMsg(
        response.started
          ? `${response.prioritized}개를 지금 처리하기 시작했습니다. 끝나면 검수 대기에 올라옵니다.`
          : response.alreadyRunning
            ? `${response.prioritized}개를 대기열 맨 앞으로 옮겼습니다. 지금 돌고 있는 자동 처리가 이 상품부터 가져갑니다.`
            : `${response.prioritized}개를 대기열 맨 앞으로 옮겼습니다.`,
      );
      await reload();
      router.refresh();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function exclude(productIds: string[]) {
    if (!productIds.length || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const response = await call({ action: "exclude", productIds });
      const done = new Set(response.productIds as string[]);
      const moved = items.filter((item) => done.has(item.productId));
      setItems((current) => current.filter((item) => !done.has(item.productId)));
      setTotal((current) => Math.max(0, current - done.size));
      setExcludedItems((current) => [
        ...moved.map((item) => ({
          ...item,
          queued: false,
          excludedAt: new Date().toISOString(),
        })),
        ...current.filter((item) => !done.has(item.productId)),
      ]);
      setExcludedCount((current) => current + done.size);
      setSelected((current) => current.filter((id) => !done.has(id)));
      setPreviewIndex(null);
      setMsg(
        response.skipped
          ? `${done.size}개를 작업에서 제외했습니다. ${response.skipped}개는 이미 처리 중이거나 제외할 수 없어 건너뛰었습니다.`
          : `${done.size}개를 앞으로의 AI 작업에서 제외했습니다.`,
      );
      router.refresh();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function restore(productIds: string[]) {
    if (!productIds.length || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const response = await call({ action: "restoreExcluded", productIds });
      const done = new Set(response.productIds as string[]);
      setExcludedItems((current) =>
        current.filter((item) => !done.has(item.productId)),
      );
      setExcludedCount((current) => Math.max(0, current - done.size));
      setMsg(
        `${done.size}개를 다시 작업 대기열에 넣었습니다. 목록 순서는 새로고침 후 반영됩니다.`,
      );
      router.refresh();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const preview = previewIndex === null ? null : (items[previewIndex] ?? null);
  useEffect(() => {
    if (!preview) return;
    // 검수 화면의 통과/보류 단축키가 미리보기 중에 실행되지 않게 알린다.
    document.body.dataset.aiImagePreview = "open";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewIndex(null);
      if (event.key === "ArrowLeft")
        setPreviewIndex((current) => Math.max(0, (current ?? 0) - 1));
      if (event.key === "ArrowRight")
        setPreviewIndex((current) =>
          Math.min(items.length - 1, (current ?? 0) + 1),
        );
    };
    window.addEventListener("keydown", onKey);
    return () => {
      delete document.body.dataset.aiImagePreview;
      window.removeEventListener("keydown", onKey);
    };
  }, [preview, items.length]);
  const allSelected =
    items.length > 0 && items.every((item) => selectedSet.has(item.productId));
  return (
    <section className="mt-5 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-lg">처리 예정 상품 미리보기</strong>
        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-sm font-bold text-violet-800">
          예정 {total.toLocaleString()}개
        </span>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-sm font-bold text-zinc-700">
          제외 {excludedCount.toLocaleString()}개
        </span>
        <button
          onClick={() => setOpen((current) => !current)}
          className="ml-auto cursor-pointer rounded border px-3 py-1.5 text-sm font-semibold hover:bg-zinc-50"
        >
          {open ? "사진 접기" : "사진 펼쳐 보기"}
        </button>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        자동 처리가 진행될 순서대로 원본 이미지를 보여줍니다. 펼치면 사진이 한꺼번에
        나오므로 검수 화면을 가리지 않도록 기본은 접어 둡니다. 사진을 누르면 크게 볼 수
        있고, 제외한 상품은 자동 처리와 대기열 추가에서 계속 빠집니다.
      </p>
      {msg && (
        <p className="mt-3 rounded border bg-zinc-50 p-3 text-sm">{msg}</p>
      )}
      {open && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              disabled={!items.length}
              onClick={() =>
                setSelected(
                  allSelected ? [] : items.map((item) => item.productId),
                )
              }
              className="cursor-pointer rounded border px-3 py-1.5 text-sm font-semibold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {allSelected ? "선택 해제" : `화면의 ${items.length}개 선택`}
            </button>
            <button
              disabled={busy || !selected.length}
              onClick={() => prioritize(selected)}
              className="cursor-pointer rounded bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              선택 {selected.length}개 지금 처리
            </button>
            <button
              disabled={busy || !selected.length}
              onClick={() => exclude(selected)}
              className="cursor-pointer rounded bg-rose-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              선택 {selected.length}개 작업 제외
            </button>
            <button
              disabled={busy}
              onClick={reload}
              className="cursor-pointer rounded border px-3 py-1.5 text-sm font-semibold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              목록 새로고침
            </button>
            <span className="text-sm text-zinc-500">
              {items.length.toLocaleString()}/{total.toLocaleString()}개 표시
            </span>
          </div>
          {items.length ? (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {items.map((item, index) => (
                <li
                  key={item.productId}
                  className={`relative rounded-lg border p-2 ${
                    selectedSet.has(item.productId)
                      ? "border-violet-500 bg-violet-50"
                      : "bg-white"
                  }`}
                >
                  <label className="absolute left-3 top-3 z-10 flex cursor-pointer items-center gap-1 rounded bg-white/90 px-1.5 py-1 text-xs font-semibold shadow">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(item.productId)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, item.productId]
                            : current.filter((id) => id !== item.productId),
                        )
                      }
                      className="h-4 w-4 cursor-pointer"
                    />
                    {index + 1}
                  </label>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(index)}
                    className="block w-full cursor-zoom-in"
                    aria-label={`${item.sku} 원본 크게 보기`}
                  >
                    <img
                      loading="lazy"
                      decoding="async"
                      src={item.sourceUrl}
                      alt={`${item.sku} 원본`}
                      className="aspect-[2/3] w-full rounded bg-zinc-100 object-contain"
                    />
                  </button>
                  <div className="mt-2 text-xs">
                    <strong className="block">{item.sku}</strong>
                    <span className="line-clamp-2 text-zinc-500">
                      {item.productName}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">
                        {supplyLabel(item)}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          item.queued
                            ? "bg-sky-100 text-sky-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {item.queued ? "대기열" : "대기열 예정"}
                      </span>
                    </span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    <button
                      disabled={busy}
                      onClick={() => prioritize([item.productId])}
                      className="flex-1 cursor-pointer rounded border border-emerald-300 px-2 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      지금 처리
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => exclude([item.productId])}
                      className="flex-1 cursor-pointer rounded border border-rose-300 px-2 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      작업 제외
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded border bg-zinc-50 p-6 text-center text-sm text-zinc-500">
              앞으로 처리할 상품이 없습니다.
            </p>
          )}
          {items.length < total && (
            <button
              disabled={busy}
              onClick={loadMore}
              className="mt-3 w-full cursor-pointer rounded border px-4 py-2 font-semibold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "불러오는 중…" : `${pageSize}개 더 보기`}
            </button>
          )}
        </>
      )}
      <div className="mt-4 border-t pt-3">
        <button
          onClick={() => setShowExcluded((current) => !current)}
          className="cursor-pointer text-sm font-bold text-zinc-700"
        >
          {showExcluded ? "▾" : "▸"} 제외한 상품 {excludedCount.toLocaleString()}
          개
        </button>
        {showExcluded &&
          (excludedItems.length ? (
            <>
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {excludedItems.map((item) => (
                  <li
                    key={item.productId}
                    className="rounded-lg border bg-zinc-50 p-2"
                  >
                    <img
                      loading="lazy"
                      decoding="async"
                      src={item.sourceUrl}
                      alt={`${item.sku} 원본`}
                      className="aspect-[2/3] w-full rounded bg-zinc-100 object-contain opacity-70"
                    />
                    <div className="mt-2 text-xs">
                      <strong className="block">{item.sku}</strong>
                      <span className="line-clamp-2 text-zinc-500">
                        {item.productName}
                      </span>
                      <span className="mt-1 block text-zinc-400">
                        {excludedAtLabel(item.excludedAt)}
                      </span>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => restore([item.productId])}
                      className="mt-2 w-full cursor-pointer rounded border border-emerald-300 px-2 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      제외 해제
                    </button>
                  </li>
                ))}
              </ul>
              {excludedItems.length < excludedCount && (
                <button
                  disabled={busy}
                  onClick={loadMoreExcluded}
                  className="mt-3 w-full cursor-pointer rounded border px-4 py-2 font-semibold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "불러오는 중…" : `${pageSize}개 더 보기`}
                </button>
              )}
            </>
          ) : (
            <p className="mt-3 rounded border bg-zinc-50 p-6 text-center text-sm text-zinc-500">
              제외한 상품이 없습니다.
            </p>
          ))}
      </div>
      {preview && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewIndex(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center gap-2">
              <strong>{preview.sku}</strong>
              <span className="text-sm text-zinc-500">
                {preview.productName}
              </span>
              <span className="ml-auto text-sm text-zinc-500">
                {(previewIndex ?? 0) + 1}/{items.length}
              </span>
            </div>
            <img
              src={preview.sourceUrl}
              alt={`${preview.sku} 원본`}
              className="mt-3 h-[min(70vh,720px)] w-full rounded bg-zinc-100 object-contain"
            />
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button
                disabled={(previewIndex ?? 0) <= 0}
                onClick={() =>
                  setPreviewIndex((current) => Math.max(0, (current ?? 0) - 1))
                }
                className="cursor-pointer rounded border px-4 py-2 font-semibold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← 이전
              </button>
              <button
                disabled={(previewIndex ?? 0) >= items.length - 1}
                onClick={() =>
                  setPreviewIndex((current) =>
                    Math.min(items.length - 1, (current ?? 0) + 1),
                  )
                }
                className="cursor-pointer rounded border px-4 py-2 font-semibold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                다음 →
              </button>
              <button
                disabled={busy}
                onClick={() => exclude([preview.productId])}
                className="cursor-pointer rounded bg-rose-700 px-4 py-2 font-bold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                작업 제외
              </button>
              <a
                href={`/products/${preview.productId}`}
                target="_blank"
                rel="noreferrer"
                className="cursor-pointer rounded border px-4 py-2 font-semibold hover:bg-zinc-50"
              >
                상품 열기
              </a>
              <button
                onClick={() => setPreviewIndex(null)}
                className="cursor-pointer rounded bg-zinc-900 px-4 py-2 font-semibold text-white"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
