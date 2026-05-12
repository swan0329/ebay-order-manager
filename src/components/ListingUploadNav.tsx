"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  PackageSearch,
  Settings,
} from "lucide-react";

const items = [
  { href: "/listing-upload", label: "현황", icon: LayoutDashboard },
  { href: "/listing-upload/excel", label: "엑셀 업로드", icon: FileSpreadsheet },
  { href: "/listing-upload/from-inventory", label: "재고에서 선택", icon: PackageSearch },
  { href: "/listing-upload/templates", label: "템플릿", icon: Settings },
  { href: "/listing-upload/jobs", label: "작업내역", icon: ClipboardList },
  { href: "/listing-upload/failed", label: "실패 목록", icon: AlertTriangle },
];

type ListingUploadNavProps = {
  active?: string;
};

function isActiveItem(pathname: string, href: string, active?: string) {
  if (active) {
    return active === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ListingUploadNav({ active }: ListingUploadNavProps) {
  const pathname = usePathname();

  return (
    <nav className="mb-5 flex gap-2 overflow-x-auto border-b border-zinc-200 pb-3">
      {items.map((item) => {
        const selected = isActiveItem(pathname, item.href, active);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={selected ? "page" : undefined}
            className={`inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-sm font-semibold transition-colors ${
              selected
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
  );
}
