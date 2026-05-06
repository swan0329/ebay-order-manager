import Link from "next/link";
import {
  Package,
  PackageOpen,
  PlugZap,
  Smartphone,
  Truck,
} from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";

const nav = [
  { href: "/orders", label: "주문", icon: Package },
  { href: "/products", label: "재고관리", icon: PackageOpen },
  { href: "/shipping", label: "배송처리", icon: Truck },
  { href: "/mobile", label: "모바일", icon: Smartphone },
  { href: "/connect", label: "eBay 연결", icon: PlugZap },
];

export function TopNav({ loginId }: { loginId: string }) {
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
        <nav className="flex gap-1 overflow-x-auto">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <span className="text-sm text-zinc-500">{loginId}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
