import { AlertTriangle, PackageCheck, PackageOpen } from "lucide-react";
import Link from "next/link";
import type { ProductQuickEditValue } from "@/components/ProductQuickEdit";
import { ProductsPager } from "@/components/ProductsPager";
import { ProductsControls } from "@/components/ProductsControls";
import { ResizableProductsTable } from "@/components/ResizableProductsTable";
import { TopNav } from "@/components/TopNav";
import {
  resolveInventoryListingUploadStatus,
  listingUploadStatusLabel,
} from "@/lib/listing-upload-status";
import { productWhere } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type ProductsSearchParams = Promise<{
  q?: string;
  status?: string;
  stock?: string;
  page?: string;
  pageSize?: string;
}>;

const pageSizeOptions = [50, 100, 200, 500, 1000, 2000];

function parsePageSize(value?: string) {
  const parsed = Number(value);
  return pageSizeOptions.includes(parsed) ? parsed : 100;
}

function statsHref(pageSize: number, stock?: "in_stock" | "sold_out") {
  const params = new URLSearchParams();

  if (stock) {
    params.set("stock", stock);
  }

  if (pageSize !== 100) {
    params.set("pageSize", String(pageSize));
  }

  const query = params.toString();

  return query ? `/products?${query}` : "/products";
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: ProductsSearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const pageSize = parsePageSize(params.pageSize);
  const requestedPage = Math.max(1, Number(params.page) || 1);
  await prisma.product.updateMany({
    where: {
      stockQuantity: { lte: 0 },
      status: { not: "sold_out" },
    },
    data: { status: "sold_out" },
  });
  const where = productWhere(params);
  const [totalFiltered, totalCount, inStockCount, soldOutCount] =
    await Promise.all([
      prisma.product.count({ where }),
      prisma.product.count(),
      prisma.product.count({ where: productWhere({ stock: "in_stock" }) }),
      prisma.product.count({ where: productWhere({ stock: "sold_out" }) }),
    ]);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const products = await prisma.product.findMany({
    where,
    include: {
      listingDrafts: {
        where: { userId: user.id },
        select: { status: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 3,
      },
      listingLinks: true,
    },
    orderBy: { sku: "asc" },
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
  });
  const productRows: ProductQuickEditValue[] = products.map((product) => {
    const listingUploadStatus = resolveInventoryListingUploadStatus(product);

    return {
      id: product.id,
      sku: product.sku,
      internalCode: product.internalCode,
      productName: product.productName,
      optionName: product.optionName,
      category: product.category,
      brand: product.brand,
      costPrice: product.costPrice?.toString() ?? null,
      salePrice: product.salePrice?.toString() ?? null,
      stockQuantity: product.stockQuantity,
      safetyStock: product.safetyStock,
      location: product.location,
      memo: product.memo,
      imageUrl: product.imageUrl,
      status: product.status,
      listingStatus: product.listingStatus,
      listingUploadStatus,
      listingUploadStatusLabel: listingUploadStatusLabel(listingUploadStatus),
      ebayItemId: product.ebayItemId,
      uploadError: product.uploadError,
      lastUploadedAt: product.lastUploadedAt?.toISOString() ?? null,
    };
  });
  const start = totalFiltered ? (currentPage - 1) * pageSize + 1 : 0;
  const end = totalFiltered ? start + products.length - 1 : 0;

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <ProductsControls />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          <Link
            href={statsHref(pageSize)}
            className="rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
            aria-label="전체 상품 조회"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">상품 수</p>
              <PackageOpen className="h-5 w-5 text-zinc-700" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {totalCount}
            </p>
          </Link>
          <Link
            href={statsHref(pageSize, "in_stock")}
            className="rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
            aria-label="재고보유 상품 조회"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">재고보유</p>
              <PackageCheck className="h-5 w-5 text-emerald-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {inStockCount}
            </p>
          </Link>
          <Link
            href={statsHref(pageSize, "sold_out")}
            className="rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
            aria-label="품절 상품 조회"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">품절</p>
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {soldOutCount}
            </p>
          </Link>
        </section>

        <ResizableProductsTable products={productRows} />

        <ProductsPager
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={totalFiltered}
          start={start}
          end={end}
        />
      </main>
    </div>
  );
}
