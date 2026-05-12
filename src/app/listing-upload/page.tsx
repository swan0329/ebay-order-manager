import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
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
import { listListingTemplates } from "@/lib/services/listingTemplateService";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const actions = [
  {
    href: "/listing-upload/excel",
    label: "엑셀 파일 업로드",
    description: "수집한 XLSX/CSV를 Draft로 저장하고 필수값을 검증합니다.",
    icon: FileSpreadsheet,
    recommended: true,
  },
  {
    href: "/listing-upload/from-inventory",
    label: "재고에서 엑셀 준비",
    description: "현재 재고를 기준으로 업로드 후보를 만들고 템플릿 규칙을 적용합니다.",
    icon: PackageSearch,
  },
  {
    href: "/listing-upload/jobs",
    label: "Draft 검증/관리",
    description: "오류 확인, 일괄 수정, 결과 다운로드를 한 화면에서 처리합니다.",
    icon: ClipboardList,
  },
  {
    href: "/listing-upload/failed",
    label: "실패 목록",
    description: "실패한 항목만 모아서 재검증/재처리할 수 있습니다.",
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
    templates,
  ] = await Promise.all([
    prisma.listingDraft.count({ where: { userId: user.id, status: "draft" } }),
    prisma.listingDraft.count({ where: { userId: user.id, status: "validated" } }),
    prisma.listingDraft.count({ where: { userId: user.id, status: "uploaded" } }),
    prisma.listingDraft.count({ where: { userId: user.id, status: "failed" } }),
    prisma.inventoryListingLink.count(),
    getEbayConnectionSummary(user.id),
    listListingTemplates(user.id),
  ]);

  const defaultTemplate = templates.find((template) => template.isDefault) ?? templates[0] ?? null;
  const templateQuery = defaultTemplate
    ? `&templateId=${encodeURIComponent(defaultTemplate.id)}`
    : "";
  const xlsxTemplateHref = `/api/listings/upload/sample?format=xlsx${templateQuery}`;
  const csvTemplateHref = `/api/listings/upload/sample?format=csv${templateQuery}`;

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">상품 업로드</h1>
            <p className="mt-1 text-sm text-zinc-600">
              API 업로드보다 엑셀 수동 업로드를 우선으로 두고, Draft 검증과 결과 관리에 집중한
              화면입니다.
            </p>
            <div className="mt-2">
              <EbayEnvironmentBadge {...ebayConnection} />
            </div>
          </div>
          <ListingPolicySync />
        </div>

        <ListingUploadNav active="/listing-upload" />

        <section className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-900">수동 업로드 빠른 시작</p>
          <p className="mt-1 text-sm text-blue-800">
            템플릿 다운로드 → 엑셀 작성 → Draft 검증 순서로 진행하면 API 업로드 없이도 안전하게
            작업할 수 있습니다.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <a
              href={xlsxTemplateHref}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-900 hover:bg-blue-100"
            >
              <Download className="h-4 w-4" />
              템플릿 XLSX
            </a>
            <a
              href={csvTemplateHref}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-900 hover:bg-blue-100"
            >
              <Download className="h-4 w-4" />
              템플릿 CSV
            </a>
            <Link
              href="/listing-upload/excel"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-900 hover:bg-blue-100"
            >
              <FileSpreadsheet className="h-4 w-4" />
              엑셀 Draft 저장
            </Link>
            <a
              href="/api/listing-upload/jobs/export"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-900 hover:bg-blue-100"
            >
              <Download className="h-4 w-4" />
              결과 CSV 다운로드
            </a>
          </div>
          <p className="mt-2 text-xs text-blue-700">
            {defaultTemplate
              ? `기본 템플릿: ${defaultTemplate.name}`
              : "기본 템플릿이 없습니다. 템플릿 메뉴에서 먼저 1개를 만들어 두는 것을 권장합니다."}
          </p>
        </section>

        <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Draft" value={draftCount} icon={ClipboardList} />
          <StatCard label="검증 완료" value={validatedCount} icon={CheckCircle2} />
          <StatCard label="업로드 완료" value={uploadedCount} icon={UploadCloud} />
          <StatCard label="실패" value={failedCount} icon={AlertTriangle} />
          <StatCard label="재고 연결" value={linkedCount} icon={PackageSearch} />
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={`rounded-lg border p-4 text-zinc-900 transition-colors ${
                action.recommended
                  ? "border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800"
                  : "border-zinc-200 bg-white hover:border-zinc-400"
              }`}
            >
              <action.icon
                className={`h-5 w-5 ${action.recommended ? "text-white" : "text-zinc-700"}`}
              />
              <p className="mt-3 text-sm font-semibold">{action.label}</p>
              <p
                className={`mt-1 text-xs leading-5 ${
                  action.recommended ? "text-zinc-200" : "text-zinc-600"
                }`}
              >
                {action.description}
              </p>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
