import { AlertTriangle, PackageOpen } from "lucide-react";
import type { ProductQuickEditValue } from "@/components/ProductQuickEdit";
import { ProductsPager } from "@/components/ProductsPager";
import { ProductsControls } from "@/components/ProductsControls";
import { ResizableProductsTable } from "@/components/ResizableProductsTable";
import { TopNav } from "@/components/TopNav";
import { matchesProductStockFilter, productWhere } from "@/lib/products";
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

const pageSizeOptions = [50, 100, 200, 500];

function parsePageSize(value?: string) {
  const parsed = Number(value);
  return pageSizeOptions.includes(parsed) ? parsed : 100;
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
  const filteredProducts = (
    await prisma.product.findMany({
      where: productWhere(params),
      orderBy: { sku: "asc" },
    })
  ).filter((product) => matchesProductStockFilter(product, params.stock));
  const totalFiltered = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const products = filteredProducts.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const [totalCount, lowCount, soldOutCount] = await Promise.all([
    prisma.product.count(),
    prisma.product.findMany({
      select: { id: true, stockQuantity: true, safetyStock: true },
    }),
    prisma.product.count({ where: { stockQuantity: { lte: 0 } } }),
  ]);
  const lowStockCount = lowCount.filter(
    (product) =>
      product.stockQuantity > 0 && product.stockQuantity <= product.safetyStock,
  ).length;
  const productRows: ProductQuickEditValue[] = products.map((product) => ({
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
    ebayItemId: product.ebayItemId,
    uploadError: product.uploadError,
    lastUploadedAt: product.lastUploadedAt?.toISOString() ?? null,
  }));
  const start = totalFiltered ? (currentPage - 1) * pageSize + 1 : 0;
  const end = totalFiltered ? start + products.length - 1 : 0;

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <ProductsControls />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">상품 수</p>
              <PackageOpen className="h-5 w-5 text-zinc-700" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {totalCount}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">재고부족</p>
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {lowStockCount}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">품절</p>
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-950">
              {soldOutCount}
            </p>
          </div>
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
