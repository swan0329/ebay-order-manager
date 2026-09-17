"use client";

import Link, { useLinkStatus } from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ImageIcon,
  DollarSign,
  PackageCheck,
  PackageOpen,
  Users,
  RefreshCw,
} from "lucide-react";
import type { ProductStats } from "@/lib/product-stats";
import type { ProductSalesChannel } from "@/lib/product-operations";
import { notifyProductDataChanged, productDataChangedEvent } from "@/lib/client-product-refresh";

function statsHref(
  currentParams: URLSearchParams,
  pageSize: number,
  channel: ProductSalesChannel,
  operation?: string,
  preserveFilters = false,
) {
  const params = preserveFilters
    ? new URLSearchParams(currentParams)
    : new URLSearchParams();
  params.set("channel", channel);
  params.delete("page");
  if (operation) params.set("operation", operation);
  else params.delete("operation");
  if (pageSize !== 25) params.set("pageSize", String(pageSize));
  const query = params.toString();
  return query ? `/products?${query}` : "/products";
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function ShortcutStatus() {
  const { pending } = useLinkStatus();
  return <span role="status" className="mt-2 block text-xs font-semibold text-blue-700">{pending ? "상품 목록 조회 중…" : "상품 목록으로 이동 →"}</span>;
}

export function ProductStatsCards({ pageSize, stats, channel }: { pageSize: number; stats: ProductStats; channel: ProductSalesChannel }) {
  const searchParams = useSearchParams();
  const currentParams = new URLSearchParams(searchParams.toString());
  const [refreshedStats, setRefreshedStats] = useState<{ source: ProductStats; value: ProductStats } | null>(null);
  // router.refresh()로 새 서버 집계가 들어오면 이전 클라이언트 집계가 가리지 않게 한다.
  const currentStats = refreshedStats?.source === stats ? refreshedStats.value : stats;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const refreshStats = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/products/stats?channel=${channel}`, { cache: "no-store" });
      if (!response.ok) throw new Error("상품 현황을 갱신하지 못했습니다. 다시 시도해 주세요.");
      setRefreshedStats({ source: stats, value: (await response.json()) as ProductStats });
      setRefreshError("");
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "상품 현황 조회 실패");
    } finally {
      setRefreshing(false);
    }
  }, [channel, stats]);

  useEffect(() => {
    const refresh = () => void refreshStats();
    window.addEventListener(productDataChangedEvent, refresh);
    return () => window.removeEventListener(productDataChangedEvent, refresh);
  }, [refreshStats]);

  const primary = [
    { label: "전체 상품", count: currentStats.totalCount, description: "관리 중인 카드 SKU 수 · 카드 실물 장수나 판매페이지 수가 아닙니다", href: statsHref(currentParams, pageSize, channel), icon: PackageOpen, tone: "zinc" },
    { label: "내 재고 보유", count: currentStats.ownStockCount, description: "재고가 1장 이상 있는 SKU · 이미지 준비 여부와 무관", href: `${statsHref(currentParams, pageSize, channel)}&stock=in_stock`, icon: PackageCheck, tone: "blue" },
    { label: "내 재고 중 이미지 준비 완료", count: currentStats.inStockCount, description: "내 재고 보유 상품 중 판매 이미지가 준비된 SKU · 위 재고 수에 포함", href: statsHref(currentParams, pageSize, channel, "in_stock"), icon: PackageCheck, tone: "teal" },
  ] as const;

  const tasks = [
    { label: "판매 이미지 작업 필요", description: "내 재고 또는 포카 재고가 있지만 판매 이미지가 준비되지 않은 상품", count: currentStats.imagePendingCount, href: statsHref(currentParams, pageSize, channel, "image_pending"), icon: ImageIcon, priority: currentStats.imagePendingCount > 0 },
    { label: "판매가격 입력 필요", description: "공급·이미지는 준비됐지만 포카 가격과 직접 지정 USD 가격이 모두 없음 · 등록된 상품 포함", count: currentStats.priceMissingCount, href: statsHref(currentParams, pageSize, channel, "price_missing"), icon: DollarSign, priority: currentStats.priceMissingCount > 0 },
    { label: "포카 정보 확인 필요", description: "포카마켓 최신화 이력이 없어 공급 정보를 확인해야 하는 상품", count: currentStats.reviewCount, href: statsHref(currentParams, pageSize, channel, "review"), icon: AlertTriangle, priority: currentStats.reviewCount > 0 },
  ];

  const toneClass = {
    zinc: "bg-zinc-100 text-zinc-700",
    blue: "bg-blue-100 text-blue-700",
    emerald: "bg-emerald-100 text-emerald-700",
    teal: "bg-teal-100 text-teal-700",
  };

  return (
    <section className={`mb-5 space-y-3 transition-opacity ${refreshing ? "opacity-70" : ""}`} aria-busy={refreshing}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3">
        <div><h2 className="text-sm font-bold text-zinc-900">상품·재고 현황</h2><p className="mt-0.5 text-xs text-zinc-500">전체 카드 SKU 기준 · 등록·변동·판매중단 대상은 아래 판매채널 자동 반영에서 확인하세요.</p></div>
        <button type="button" onClick={notifyProductDataChanged} disabled={refreshing} className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-xs font-semibold disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />현황 함께 갱신</button>

      </div>
      {refreshError ? <p role="alert" className="text-sm text-rose-700">{refreshError}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {primary.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.label} href={`${card.href}#product-results`} prefetch={false} className="group rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md" aria-label={`${card.label} 상품 조회`}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-sm font-semibold text-zinc-600">{card.label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-zinc-950">{formatCount(card.count)}</p></div>
                <span className={`rounded-lg p-2.5 ${toneClass[card.tone]}`}><Icon className="h-5 w-5" /></span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">{card.description}</p><ShortcutStatus />
            </Link>
          );
        })}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-bold text-zinc-900">업무 바로가기</h2><p className="mt-0.5 text-xs text-zinc-500">직접 확인하거나 준비할 작업입니다. 카드를 누르면 해당 조건의 상품 목록으로 바로 이동합니다.</p></div></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task) => {
            const Icon = task.icon;
            return (
              <Link key={task.label} href={`${task.href}#product-results`} prefetch={false} className={`flex min-h-20 items-start gap-3 rounded-lg border px-3 py-3 transition hover:bg-zinc-50 ${task.priority ? "border-amber-200 bg-amber-50/60" : "border-zinc-200 bg-white"}`} aria-label={`${task.label} 상품 조회`}>
                <Icon className={`h-4 w-4 shrink-0 ${task.priority ? "text-amber-700" : "text-zinc-400"}`} />
                <div className="min-w-0"><div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold text-zinc-700">{task.label}</p><p className={`shrink-0 text-lg font-bold ${task.priority ? "text-amber-800" : "text-zinc-950"}`}>{formatCount(task.count)}</p></div><p className="mt-1 text-xs leading-4 text-zinc-500">{task.description}</p><ShortcutStatus /></div>
              </Link>
            );
          })}
        </div>
        <div className="mt-3 border-t border-zinc-100 pt-3"><Link href="/products/unit-members" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-600 hover:text-zinc-950"><Users className="h-4 w-4" />유닛 멤버 지정</Link><span className="ml-2 text-xs text-zinc-500">멤버 정보 보완이 필요할 때 열기</span></div>
      </div>
    </section>
  );
}
