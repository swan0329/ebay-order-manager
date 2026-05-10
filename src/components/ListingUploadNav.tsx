import Link from "next/link";
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
  { href: "/listing-upload/from-inventory", label: "재고에서 선택", icon: PackageSearch },
  { href: "/listing-upload/excel", label: "엑셀 업로드", icon: FileSpreadsheet },
  { href: "/listing-upload/templates", label: "템플릿", icon: Settings },
  { href: "/listing-upload/jobs", label: "작업내역", icon: ClipboardList },
  { href: "/listing-upload/failed", label: "실패 목록", icon: AlertTriangle },
];

export function ListingUploadNav({ active }: { active: string }) {
  return (
    <nav className="mb-5 flex gap-2 overflow-x-auto border-b border-zinc-200 pb-3">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium ${
            active === item.href
              ? "bg-zinc-950 text-white"
              : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
