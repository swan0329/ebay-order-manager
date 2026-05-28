import Link from "next/link";
import { AlertTriangle, PackageCheck, PackageOpen } from "lucide-react";
import type { ProductStats } from "@/lib/product-stats";

function statsHref(pageSize: number, stock?: "in_stock" | "sold_out") {
  const params = new URLSearchParams();

  if (stock) {
    params.set("stock", stock);
  }

  if (pageSize !== 25) {
    params.set("pageSize", String(pageSize));
  }

  const query = params.toString();

  return query ? `/products?${query}` : "/products";
}

function formatCount(value: number) {
  return value.toLocaleString();
}

export function ProductStatsCards({
  pageSize,
  stats,
}: {
  pageSize: number;
  stats: ProductStats;
}) {
  return (
    <section className="mb-5 grid gap-3 sm:grid-cols-3">
      <Link
        href={statsHref(pageSize)}
        className="rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
        aria-label="전체 상품 조회"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-500">상품 수</p>
          <PackageOpen className="h-5 w-5 text-zinc-700" />
        </div>
        <p className="mt-3 text-2xl font-semibold text-zinc-950">
          {formatCount(stats.totalCount)}
        </p>
      </Link>
      <Link
        href={statsHref(pageSize, "in_stock")}
        className="rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
        aria-label="재고보유 상품 조회"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-500">재고보유</p>
          <PackageCheck className="h-5 w-5 text-emerald-600" />
        </div>
        <p className="mt-3 text-2xl font-semibold text-zinc-950">
          {formatCount(stats.inStockCount)}
        </p>
      </Link>
      <Link
        href={statsHref(pageSize, "sold_out")}
        className="rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
        aria-label="품절 상품 조회"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-500">품절</p>
          <AlertTriangle className="h-5 w-5 text-rose-600" />
        </div>
        <p className="mt-3 text-2xl font-semibold text-zinc-950">
          {formatCount(stats.soldOutCount)}
        </p>
      </Link>
    </section>
  );
}
