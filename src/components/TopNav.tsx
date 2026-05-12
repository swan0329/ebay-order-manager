"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Camera,
  Package,
  PackageOpen,
  PlugZap,
  Smartphone,
  Truck,
  UploadCloud,
} from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Package;
  matchPrefixes: string[];
  excludePrefixes?: string[];
};

const nav: NavItem[] = [
  { href: "/orders", label: "주문", icon: Package, matchPrefixes: ["/orders"] },
  {
    href: "/products",
    label: "재고관리",
    icon: PackageOpen,
    matchPrefixes: ["/products", "/inventory", "/inventory/movements"],
    excludePrefixes: ["/inventory/photo-card-match"],
  },
  {
    href: "/inventory/photo-card-match",
    label: "촬영본 연결",
    icon: Camera,
    matchPrefixes: ["/inventory/photo-card-match"],
  },
  {
    href: "/listing-upload",
    label: "상품업로드",
    icon: UploadCloud,
    matchPrefixes: ["/listing-upload"],
  },
  { href: "/shipping", label: "배송처리", icon: Truck, matchPrefixes: ["/shipping"] },
  { href: "/mobile", label: "모바일", icon: Smartphone, matchPrefixes: ["/mobile"] },
  { href: "/connect", label: "eBay 연결", icon: PlugZap, matchPrefixes: ["/connect"] },
];

function isActive(pathname: string, item: NavItem) {
  if (item.excludePrefixes?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }

  return item.matchPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function TopNav({ loginId }: { loginId: string }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center justify-between">
          <Link href="/orders" className="text-base font-semibold text-zinc-950">
            eBay Order Manager
          </Link>
          <div className="lg:hidden">
            <LogoutButton />
          </div>
        </div>
        <nav className="flex gap-2 overflow-x-auto pb-1">
          {nav.map((item) => {
            const active = isActive(pathname, item);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-sm font-semibold transition-colors ${
                  active
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <span className="text-sm text-zinc-500">{loginId}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
