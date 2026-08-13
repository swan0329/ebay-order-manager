"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [{ href: "/pricing/settings", label: "가격 설정 · 권장가" }];

export function PricingNav() {
  const pathname = usePathname();
  return <nav className="mb-6 mt-5 flex gap-2 border-b border-zinc-200">
    {items.map((item) => <Link key={item.href} href={item.href} className={`border-b-2 px-4 py-3 text-sm font-semibold ${pathname.startsWith(item.href) ? "border-violet-600 text-violet-700" : "border-transparent text-zinc-500"}`}>{item.label}</Link>)}
  </nav>;
}
