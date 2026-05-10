import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  PackageSearch,
  UploadCloud,
} from "lucide-react";
import { EbayEnvironmentBadge } from "@/components/EbayEnvironmentBadge";
import { ListingPolicySync } from "@/components/ListingPolicySync";
import { ListingUploadNav } from "@/components/ListingUploadNav";
import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import { getEbayConnectionSummary } from "@/lib/services/ebayAccountService";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const actions = [
  {
    href: "/listing-upload/from-inventory",
    label: "재고에서 상품 선택",
    icon: PackageSearch,
  },
  {
    href: "/listing-upload/excel",
    label: "엑셀 대량 업로드",
    icon: FileSpreadsheet,
  },
  {
    href: "/listing-upload/jobs",
    label: "Draft 검증/업로드",
    icon: ClipboardList,
  },
  {
    href: "/listing-upload/failed",
    label: "실패 재시도",
    icon: AlertTriangle,
  },
];

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof UploadCloud;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-500">{label}</p>
        <Icon className="h-5 w-5 text-zinc-700" />
      </div>
      <p className="mt-3 text-2xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

export default async function ListingUploadPage() {
  const user = await requireUser();
  const [
    draftCount,
    validatedCount,
    uploadedCount,
    failedCount,
    linkedCount,
    ebayConnection,
  ] =
    await Promise.all([
      prisma.listingDraft.count({ where: { userId: user.id, status: "draft" } }),
      prisma.listingDraft.count({ where: { userId: user.id, status: "validated" } }),
      prisma.listingDraft.count({ where: { userId: user.id, status: "uploaded" } }),
      prisma.listingDraft.count({ where: { userId: user.id, status: "failed" } }),
      prisma.inventoryListingLink.count(),
      getEbayConnectionSummary(user.id),
    ]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">상품 업로드</h1>
            <p className="mt-1 text-sm text-zinc-600">
              SKU 기반 재고 상품을 eBay Inventory API 업로드 draft로 관리합니다.
            </p>
            <div className="mt-2">
              <EbayEnvironmentBadge {...ebayConnection} />
            </div>
          </div>
          <ListingPolicySync />
        </div>

        <ListingUploadNav active="/listing-upload" />

        <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Draft" value={draftCount} icon={ClipboardList} />
          <StatCard label="검증 완료" value={validatedCount} icon={CheckCircle2} />
          <StatCard label="업로드 완료" value={uploadedCount} icon={UploadCloud} />
          <StatCard label="실패" value={failedCount} icon={AlertTriangle} />
          <StatCard label="재고 연결" value={linkedCount} icon={PackageSearch} />
        </section>

        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 hover:border-zinc-400"
            >
              <action.icon className="h-5 w-5 text-zinc-700" />
              <p className="mt-3 text-sm font-semibold">{action.label}</p>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
