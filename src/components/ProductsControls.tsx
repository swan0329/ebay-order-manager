"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Plus, Search, Settings, Upload, UploadCloud } from "lucide-react";

export function ProductsControls() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const paramsText = useMemo(() => searchParams.toString(), [searchParams]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    for (const key of ["q", "status", "stock"]) {
      const value = String(form.get(key) ?? "").trim();
      if (value && value !== "all") {
        params.set(key, value);
      }
    }

    const pageSize = searchParams.get("pageSize");

    if (pageSize) {
      params.set("pageSize", pageSize);
    }

    router.push(`/products?${params.toString()}`);
  }

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    setUploading(true);
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/import/products", {
      method: "POST",
      body: form,
    });
    const data = (await response.json().catch(() => null)) as
      | { created?: number; updated?: number; errors?: string[]; error?: string }
      | null;

    setUploading(false);
    event.currentTarget.value = "";
    setMessage(
      response.ok
        ? `등록 ${data?.created ?? 0}건, 수정 ${data?.updated ?? 0}건${
            data?.errors?.length ? `, 오류 ${data.errors.length}건` : ""
          }`
        : data?.error ?? "업로드 실패",
    );
    router.refresh();
  }

  return (
    <section className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <form
            onSubmit={applyFilters}
            className="grid flex-1 gap-2 md:grid-cols-[1fr_150px_150px_auto]"
          >
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                name="q"
                defaultValue={searchParams.get("q") ?? ""}
                placeholder="상품번호, 상품명, 그룹명, 앨범명, 멤버"
                className="h-10 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-sm outline-none focus:border-zinc-900"
              />
            </label>
            <select
              name="status"
              defaultValue={searchParams.get("status") ?? "all"}
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            >
              <option value="all">전체 상태</option>
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
              <option value="sold_out">품절</option>
            </select>
            <select
              name="stock"
              defaultValue={searchParams.get("stock") ?? "all"}
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            >
              <option value="all">전체 재고</option>
              <option value="low">재고부족</option>
              <option value="sold_out">품절</option>
            </select>
            <button
              type="submit"
              className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              조회
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/products/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              <Plus className="h-4 w-4" />
              상품 등록
            </Link>
            <Link
              href="/listing-upload"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <UploadCloud className="h-4 w-4" />
              eBay 업로드
            </Link>
            <Link
              href="/listing-upload/templates"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <Settings className="h-4 w-4" />
              Templates
            </Link>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
              <Upload className="h-4 w-4" />
              {uploading ? "업로드 중" : "엑셀/CSV 업로드"}
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={importCsv}
                className="sr-only"
              />
            </label>
            <a
              href={`/api/export/products${paramsText ? `?${paramsText}` : ""}`}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
          </div>
        </div>
        {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
      </div>
    </section>
  );
}
