import type { ProductQuickEditValue } from "@/components/ProductQuickEdit";
import { ProductStatsCards } from "@/components/ProductStatsCards";
import { ProductsPager } from "@/components/ProductsPager";
import {
  ProductsControls,
  type ProductFacetOptions,
} from "@/components/ProductsControls";
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
  group?: string;
  member?: string;
  album?: string;
  version?: string;
  page?: string;
  pageSize?: string;
}>;

const pageSizeOptions = [25, 50, 100, 200, 500, 1000, 2000];

function parsePageSize(value?: string) {
  const parsed = Number(value);
  return pageSizeOptions.includes(parsed) ? parsed : 25;
}

function uniqueOptions(values: Array<string | null>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 50);
}

function facetsFromProducts(
  products: Array<{
    brand: string | null;
    optionName: string | null;
    category: string | null;
    productName: string;
  }>,
): ProductFacetOptions {
  return {
    groups: uniqueOptions(products.map((product) => product.brand)),
    members: uniqueOptions(products.map((product) => product.optionName)),
    albums: uniqueOptions(products.map((product) => product.category)),
    versions: uniqueOptions(products.map((product) => product.productName)),
  };
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
  const where = productWhere(params);
  const currentPage = requestedPage;
  const skip = (currentPage - 1) * pageSize;
  const fetchedProducts = await prisma.product.findMany({
    where,
    select: {
      id: true,
      sku: true,
      internalCode: true,
      productName: true,
      optionName: true,
      category: true,
      brand: true,
      costPrice: true,
      salePrice: true,
      stockQuantity: true,
      safetyStock: true,
      location: true,
      memo: true,
      imageUrl: true,
      status: true,
      listingStatus: true,
      ebayItemId: true,
      uploadError: true,
      lastUploadedAt: true,
      updatedAt: true,
    },
    orderBy: { sku: "asc" },
    skip,
    take: pageSize + 1,
  });
  const hasNextPage = fetchedProducts.length > pageSize;
  const products = fetchedProducts.slice(0, pageSize);
  const initialFacets = facetsFromProducts(products);
  const totalFiltered = skip + products.length + (hasNextPage ? 1 : 0);
  const totalPages = Math.max(1, hasNextPage ? currentPage + 1 : currentPage);
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
      sourceImageUrl: null,
      userImageRegistered: false,
      hasBackImage: false,
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
      <ProductsControls initialFacets={initialFacets} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <ProductStatsCards pageSize={pageSize} />

        <ResizableProductsTable products={productRows} />

        <ProductsPager
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={totalFiltered}
          start={start}
          end={end}
          hasNextPage={hasNextPage}
        />
      </main>
    </div>
  );
}
