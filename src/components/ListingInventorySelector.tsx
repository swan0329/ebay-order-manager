"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckSquare, Search, Square, UploadCloud } from "lucide-react";
import {
  listingUploadStatusLabel,
  type ListingUploadStatus,
} from "@/lib/listing-upload-status";

type ProductRow = {
  id: string;
  sku: string;
  productName: string;
  brand: string | null;
  category: string | null;
  salePrice: string | number | null;
  stockQuantity: number;
  imageUrl: string | null;
  ebayItemId: string | null;
  listingStatus: string | null;
  listingUploadStatus: ListingUploadStatus;
};

function listingStatusClass(status: ListingUploadStatus) {
  if (status === "uploaded") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (status === "failed") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  if (status === "needs_update") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  if (status === "draft") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  return "bg-zinc-50 text-zinc-600 ring-zinc-200";
}

type TemplateOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

export function ListingInventorySelector({
  products,
  templates,
}: {
  products: ProductRow[];
  templates: TemplateOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState(
    templates.find((template) => template.isDefault)?.id ?? templates[0]?.id ?? "",
  );
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  function toggleAll() {
    setSelectedIds((current) =>
      current.length === products.length ? [] : products.map((product) => product.id),
    );
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    for (const key of ["q", "listing"]) {
      const value = String(form.get(key) ?? "").trim();
      if (value && value !== "all") {
        params.set(key, value);
      }
    }

    if (form.get("inStock") === "on") {
      params.set("inStock", "true");
    }

    router.push(`/listing-upload/from-inventory?${params.toString()}`);
  }

  async function createDrafts() {
    if (!selectedIds.length) {
      setMessage("상품을 하나 이상 선택해 주세요.");
      return;
    }

    setCreating(true);
    setMessage("");
    const response = await fetch("/api/listing-upload/drafts/from-inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productIds: selectedIds, templateId: templateId || null }),
    });
    const data = (await response.json().catch(() => null)) as
      | { created?: number; error?: string }
      | null;

    setCreating(false);
    if (!response.ok) {
      setMessage(data?.error ?? "Draft 생성 실패");
      return;
    }

    setMessage(`${data?.created ?? 0}개 draft를 저장했습니다.`);
    setSelectedIds([]);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={applyFilters}
        className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-4 md:grid-cols-[1fr_150px_auto_auto]"
      >
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            name="q"
            defaultValue={searchParams.get("q") ?? ""}
            placeholder="SKU, 상품명, 그룹명, 앨범명"
            className="h-10 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-sm outline-none focus:border-zinc-900"
          />
        </label>
        <select
          name="listing"
          defaultValue={searchParams.get("listing") ?? "all"}
          className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
        >
          <option value="all">전체</option>
          <option value="unlisted">미등록</option>
          <option value="listed">등록됨</option>
        </select>
        <label className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm text-zinc-800">
          <input
            name="inStock"
            type="checkbox"
            defaultChecked={searchParams.get("inStock") === "true"}
          />
          재고 있음
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          조회
        </button>
      </form>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              {selectedIds.length === products.length && products.length ? (
                <CheckSquare className="h-4 w-4" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              전체 선택
            </button>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className="h-9 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            >
              <option value="">템플릿 없음</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.isDefault ? " (기본)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={createDrafts}
              disabled={creating}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-400"
            >
              <UploadCloud className="h-4 w-4" />
              Draft 저장
            </button>
          </div>
          <div className="text-sm text-zinc-600">
            선택 {selectedIds.length} / 표시 {products.length}
            {message ? <span className="ml-3 text-zinc-950">{message}</span> : null}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th className="w-12 px-3 py-2">선택</th>
                <th className="px-3 py-2">상품</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">재고</th>
                <th className="px-3 py-2">가격</th>
                <th className="px-3 py-2">eBay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {products.map((product) => (
                <tr key={product.id} className="hover:bg-zinc-50">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggle(product.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                      aria-label="상품 선택"
                    >
                      {selectedSet.has(product.id) ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="min-w-[260px] px-3 py-2">
                    <div className="flex items-center gap-3">
                      {product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.imageUrl}
                          alt=""
                          className="h-12 w-12 rounded-md object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-md bg-zinc-100" />
                      )}
                      <div>
                        <Link
                          href={`/products/${product.id}`}
                          className="font-medium text-zinc-950 hover:underline"
                        >
                          {product.productName}
                        </Link>
                        <p className="text-xs text-zinc-500">
                          {[product.brand, product.category].filter(Boolean).join(" / ")}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    {product.sku}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{product.stockQuantity}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {product.salePrice?.toString() ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${listingStatusClass(
                        product.listingUploadStatus,
                      )}`}
                    >
                      {listingUploadStatusLabel(product.listingUploadStatus)}
                    </span>
                    {product.ebayItemId ? (
                      <p className="mt-1 text-xs text-zinc-500">{product.ebayItemId}</p>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!products.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-zinc-500">
                    표시할 상품이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
