"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

const pageSizeOptions = [50, 100, 200, 500];

export function ProductsPager({
  currentPage,
  totalPages,
  pageSize,
  totalCount,
  start,
  end,
}: {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalCount: number;
  start: number;
  end: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pageDraft, setPageDraft] = useState({
    page: currentPage,
    value: String(currentPage),
  });
  const pageInput =
    pageDraft.page === currentPage ? pageDraft.value : String(currentPage);

  function pushParams(nextParams: URLSearchParams) {
    const query = nextParams.toString();
    router.push(query ? `/products?${query}` : "/products");
  }

  function goToPage(page: number) {
    const nextPage = Math.min(Math.max(1, page), totalPages);
    const nextParams = new URLSearchParams(searchParams.toString());

    if (nextPage <= 1) {
      nextParams.delete("page");
    } else {
      nextParams.set("page", String(nextPage));
    }

    pushParams(nextParams);
  }

  function changePageSize(nextSize: string) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("pageSize", nextSize);
    nextParams.delete("page");
    pushParams(nextParams);
  }

  function submitPage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    goToPage(Number(pageInput) || 1);
  }

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-700 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-medium">
        {totalCount ? `${start}-${end} / ${totalCount}` : "표시할 상품이 없습니다."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-zinc-500">표시</span>
          <select
            value={pageSize}
            onChange={(event) => changePageSize(event.currentTarget.value)}
            className="h-9 rounded-md border border-zinc-300 px-2 text-sm outline-none focus:border-zinc-900"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}개
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => goToPage(1)}
          disabled={currentPage <= 1}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
          title="첫 페이지"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
          title="이전 페이지"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <form onSubmit={submitPage} className="flex items-center gap-2">
          <input
            value={pageInput}
            onChange={(event) =>
              setPageDraft({
                page: currentPage,
                value: event.currentTarget.value,
              })
            }
            type="number"
            min={1}
            max={totalPages}
            className="h-9 w-20 rounded-md border border-zinc-300 px-2 text-center text-sm outline-none focus:border-zinc-900"
            aria-label="페이지 번호"
          />
          <span className="shrink-0 text-zinc-500">/ {totalPages}</span>
        </form>
        <button
          type="button"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
          title="다음 페이지"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => goToPage(totalPages)}
          disabled={currentPage >= totalPages}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
          title="마지막 페이지"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
