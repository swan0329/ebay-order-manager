import Link from "next/link";
import {
  AlertTriangle,
  Camera,
  DollarSign,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  ShoppingBag,
  Users,
} from "lucide-react";
import type { ProductStats } from "@/lib/product-stats";

function statsHref(pageSize: number, operation?: string) {
  const params = new URLSearchParams();
  if (operation) params.set("operation", operation);
  if (pageSize !== 25) params.set("pageSize", String(pageSize));
  const query = params.toString();
  return query ? `/products?${query}` : "/products";
}

function formatCount(value: number) {
  return value.toLocaleString();
}

const baseClass =
  "rounded-lg border p-4 transition focus-visible:outline focus-visible:outline-2";

export function ProductStatsCards({
  pageSize,
  stats,
}: {
  pageSize: number;
  stats: ProductStats;
}) {
  const cards = [
    {
      label: "전체 상품",
      count: stats.totalCount,
      description: "관리 중인 전체 SKU",
      href: statsHref(pageSize),
      icon: PackageOpen,
      className: "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
    },
    {
      label: "판매중",
      count: stats.sellingCount,
      description: "공급·이미지 완료 · eBay 등록됨",
      href: statsHref(pageSize, "selling"),
      icon: ShoppingBag,
      className: "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100",
    },
    {
      label: "판매 가능",
      count: stats.listableCount,
      // 가격이 없으면 신규등록 CSV에서 빠진다. 그 수를 여기서 알려주지 않으면
      // "판매 가능인데 다운로드하면 0개"로 보여 원인을 찾기 어렵다.
      description:
        stats.priceMissingCount > 0
          ? `내 재고 ${stats.inStockListableCount} + 포카조달 ${stats.procurementListableCount} · 가격 없어 CSV 제외 ${stats.priceMissingCount}`
          : `미등록 전체 · 내 재고 ${stats.inStockListableCount} + 포카조달 ${stats.procurementListableCount}`,
      href: statsHref(pageSize, "listable"),
      icon: ShoppingBag,
      className: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    },
    {
      label: "포카조달 미등록",
      count: stats.procurementListableCount,
      description: "재고 없음 · 포카 매물 있음 · 미등록(올리면 됨)",
      href: statsHref(pageSize, "procurement_listable"),
      icon: PackageSearch,
      className: "border-violet-300 bg-violet-100 text-violet-900 hover:bg-violet-200",
    },
    {
      label: "직접촬영 판매가능",
      count: stats.ownPhotoListableCount,
      description: "촬영본 이미지만 · 내 재고 · 미등록",
      href: statsHref(pageSize, "own_photo_listable"),
      icon: Camera,
      className: "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100",
    },
    {
      label: "유닛 멤버 미입력",
      count: stats.unitNoMembersCount,
      description: "판매가능 유닛 · 멤버 지정하기",
      href: "/products/unit-members",
      icon: Users,
      className: "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100",
    },
    {
      label: "가격 미입력",
      count: stats.priceMissingCount,
      description: "판매가능 · 포카마켓·수동 가격 모두 없음",
      href: "/products/price-missing",
      icon: DollarSign,
      className: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
    },
    {
      label: "재고보유 판매",
      count: stats.inStockCount,
      description: "내 재고 있음 · 이미지 완료 · 등록·미등록 포함",
      href: statsHref(pageSize, "in_stock"),
      icon: PackageCheck,
      className: "border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100",
    },
    {
      label: "포카 조달판매",
      count: stats.procurementReadyCount,
      description: "재고 없음 · 포카 매물 있음 · 등록·미등록 포함",
      href: statsHref(pageSize, "procurement_ready"),
      icon: PackageSearch,
      className: "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100",
    },
    {
      label: "판매중단 필요",
      count: stats.stopRequiredCount,
      description: "eBay 활성 · 공급 불가",
      href: statsHref(pageSize, "stop_required"),
      icon: AlertTriangle,
      className: "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100",
    },
    {
      label: "품절",
      count: stats.soldOutCount,
      description: "내 재고 없음 · 포카 매물 없음 · 판매중단 필요 제외",
      href: statsHref(pageSize, "sold_out"),
      icon: AlertTriangle,
      className: "border-zinc-300 bg-zinc-100 text-zinc-700 hover:bg-zinc-200",
    },
  ];

  return (
    <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.label}
            href={card.href}
            className={`${baseClass} ${card.className}`}
            aria-label={`${card.label} 상품 조회`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{card.label}</p>
              <Icon className="h-5 w-5 shrink-0" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {formatCount(card.count)}
            </p>
            <p className="mt-1 text-xs opacity-80">{card.description}</p>
          </Link>
        );
      })}
    </section>
  );
}
