"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Unlink } from "lucide-react";

type LinkedPair = {
  listingId: string;
  itemId: string;
  listingTitle: string | null;
  listingImageUrl: string | null;
  matchStatus: string;
  linkedAt: string | null;
  product: {
    id: string;
    sku: string;
    productName: string;
    brand: string | null;
    optionName: string | null;
    imageUrl: string | null;
    ebayItemId: string | null;
  } | null;
};

// 잘못 연결한 짝을 찾아 푸는 상자. 연결된 항목은 대기 목록에서 빠지므로
// 여기서만 손이 닿는다. 풀면 그 리스팅이 다시 대기 목록으로 돌아온다.
export function EbayUnlinkPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [links, setLinks] = useState<LinkedPair[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // 검색어를 비우고 부르면 최근에 연결한 것부터 돌아온다.
  const lookup = useCallback(async (q?: string) => {
    const term = q?.trim() ?? "";
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/ebay/active-report/linked${term ? `?q=${encodeURIComponent(term)}` : ""}`,
        { cache: "no-store" },
      );
      const body = (await response.json().catch(() => null)) as
        | { links?: LinkedPair[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "찾지 못했습니다.");
      }

      setLinks(body?.links ?? []);
      if (!body?.links?.length) {
        setMessage(term ? `"${term}"로 연결된 항목이 없습니다.` : "연결된 항목이 없습니다.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "찾지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, []);

  // 상자를 열면서 최근 연결 목록을 바로 불러온다. 무엇을 연결했는지 기억나지
  // 않아도 눈으로 훑어 고를 수 있어야 한다.
  function openPanel() {
    setOpen(true);
    if (links === null) void lookup();
  }

  async function unlink(pair: LinkedPair) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ebay/active-report/linked", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId: pair.listingId }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "연결을 풀지 못했습니다.");
      }

      setLinks((prev) => (prev ?? []).filter((row) => row.listingId !== pair.listingId));
      setMessage(
        `${pair.product?.sku ?? "상품"} ↔ 상품번호 ${pair.itemId} 연결을 풀었습니다. 이 리스팅은 다시 연결 대기 목록에 나옵니다.`,
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "연결을 풀지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
      >
        <Unlink className="h-3.5 w-3.5" />
        방금 연결한 것 확인 · 잘못된 건 풀기
      </button>
    );
  }

  return (
    <section className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-900">최근 연결한 항목</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-amber-700 underline hover:text-amber-900"
        >
          닫기
        </button>
      </div>
      <p className="mt-1 text-xs text-amber-800">
        최근에 연결한 것부터 보여줍니다. 풀면 그 상품은 다시 &quot;미등록&quot;이 되고,
        리스팅은 연결 대기 목록으로 돌아옵니다. eBay에는 아무런 영향이 없습니다.
      </p>

      <div className="mt-2 flex gap-1.5">
        <input
          value={term}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setTerm(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void lookup(term);
          }}
          placeholder="특정 SKU·상품번호로 좁히기 (비우면 최근 연결 전체)"
          className="h-9 flex-1 rounded-md border border-amber-300 bg-white px-2 text-sm text-zinc-900"
        />
        <button
          type="button"
          onClick={() => void lookup(term)}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-md bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
        >
          {busy ? "처리 중..." : "찾기"}
        </button>
      </div>

      {message ? <p className="mt-2 text-xs text-amber-900">{message}</p> : null}

      {links?.length ? (
        <ul className="mt-3 space-y-2">
          {links.map((pair) => (
            <li
              key={pair.listingId}
              className="flex items-center gap-2 rounded-md border border-amber-200 bg-white p-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pair.listingImageUrl ?? pair.product?.imageUrl ?? ""}
                alt=""
                loading="lazy"
                className="h-12 w-12 shrink-0 rounded border border-zinc-200 object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900">
                  {pair.product?.sku ?? "(상품 없음)"} ↔ {pair.itemId}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {pair.listingTitle ?? "(제목 없음)"}
                </p>
                <p className="truncate text-xs text-zinc-400">
                  상품: {pair.product?.productName ?? "-"}
                  {pair.product?.optionName ? ` · ${pair.product.optionName}` : ""}
                </p>
                {pair.linkedAt ? (
                  <p className="text-[11px] text-zinc-400">
                    연결 {new Date(pair.linkedAt).toLocaleString("ko-KR")}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void unlink(pair)}
                disabled={busy}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-rose-600 px-2.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
              >
                <Unlink className="h-3.5 w-3.5" />
                연결 풀기
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
