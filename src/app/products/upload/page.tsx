import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle2, UploadCloud } from "lucide-react";
import { ProductListingUploader } from "@/components/ProductListingUploader";
import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import { listListingTemplates } from "@/lib/services/listingTemplateService";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProductUploadPage() {
  const user = await requireUser();
  const [recentJobs, successCount, failedCount, activeListingCount, templates] =
    await Promise.all([
      prisma.productUploadJob.findMany({
        where: { userId: user.id },
        include: {
          template: {
            select: {
              id: true,
              name: true,
            },
          },
          product: {
            select: {
              id: true,
              sku: true,
              productName: true,
              listingStatus: true,
              ebayItemId: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.productUploadJob.count({
        where: { userId: user.id, status: "success" },
      }),
      prisma.productUploadJob.count({
        where: { userId: user.id, status: "failed" },
      }),
      prisma.product.count({
        where: { listingStatus: "ACTIVE" },
      }),
      listListingTemplates(user.id),
    ]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              href="/products"
              className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950"
            >
              <ArrowLeft className="h-4 w-4" />
              재고관리
            </Link>
            <h1 className="text-xl font-semibold text-zinc-950">
              eBay 상품 업로드
            </h1>
          </div>
        </div>

        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">Active listings</p>
              <UploadCloud className="h-5 w-5 text-zinc-700" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {activeListingCount}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">Upload success</p>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {successCount}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">Upload failed</p>
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {failedCount}
            </p>
          </div>
        </section>

        <ProductListingUploader
          recentJobs={recentJobs}
          templates={templates.map((template) => ({
            id: template.id,
            name: template.name,
            isDefault: template.isDefault,
          }))}
        />
      </main>
    </div>
  );
}
