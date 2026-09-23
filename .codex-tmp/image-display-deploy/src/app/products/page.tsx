import { memberOptions } from "@/lib/product-member";
import { Prisma } from "@/generated/prisma";
import type { ProductQuickEditValue } from "@/components/ProductQuickEdit";
import { ProductStatsCards } from "@/components/ProductStatsCards";
import { EbayActiveReportPanel } from "@/components/EbayActiveReportPanel";
import { ProductsPager } from "@/components/ProductsPager";
import {
  ProductsControls,
  type ProductFacetOptions,
} from "@/components/ProductsControls";
import { ResizableProductsTable } from "@/components/ResizableProductsTable";
import { TopNav } from "@/components/TopNav";
import { getProductStats } from "@/lib/product-stats";
import { productImageExtrasById } from "@/lib/product-export-image-extras";
import {
  getOperationalProductIds,
  type ProductOperationalView,
  type ProductSalesChannel,
} from "@/lib/product-operations";
import { productOrderBy } from "@/lib/products";
import { productSearchWhere } from "@/lib/product-search-where";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

type ProductPhotoStatus = {
  id: string;
  userImageRegistered: boolean;
  hasBackImage: boolean;
  sourceImageUrl: string | null;
  imageSource: string | null;
  imageWorkReady: boolean;
};
type PocamarketChange = {
  productId: string;
  status: string;
  previousPrice: Prisma.Decimal | null;
  observedPrice: Prisma.Decimal | null;
  previousAvailableCount: number | null;
  observedAvailableCount: number | null;
};

type VariationMembership = {
  itemId: string | null;
  state: "INCLUDED" | "PENDING";
  title: string;
};

function jsonStringIds(value: Prisma.JsonValue) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function fetchVariationMembershipByProductId(userId: string) {
  const states = await prisma.variationListingState.findMany({
    where: { userId },
    select: {
      ebayItemId: true,
      includedProductIds: true,
      pendingProductIds: true,
      title: true,
    },
  });
  const result = new Map<string, VariationMembership>();

  for (const state of states) {
    for (const productId of jsonStringIds(state.pendingProductIds)) {
      if (!result.has(productId)) {
        result.set(productId, {
          itemId: state.ebayItemId,
          state: "PENDING",
          title: state.title,
        });
      }
    }
    for (const productId of jsonStringIds(state.includedProductIds)) {
      result.set(productId, {
        itemId: state.ebayItemId,
        state: "INCLUDED",
        title: state.title,
      });
    }
  }

  return result;
}

async function fetchPhotoStatusByIds(ids: string[]): Promise<Map<string, ProductPhotoStatus>> {
  if (!ids.length) return new Map();

  try {
    const rows = await prisma.$queryRaw<ProductPhotoStatus[]>`
      SELECT
        "id",
        ("user_front_image_url" IS NOT NULL AND "user_front_image_url" <> '') AS "userImageRegistered",
        COALESCE("has_back_image", false) AS "hasBackImage",
        "source_image_url" AS "sourceImageUrl",
        CASE
          WHEN "image_source" = 'lens_workbench'
            OR COALESCE("ebay_image_urls"::text, '') LIKE '%/products/%/lens-card-%'
          THEN 'lens_workbench'
          ELSE "image_source"
        END AS "imageSource"
        ,(
          ("user_front_image_url" IS NOT NULL AND "user_front_image_url" <> '')
          OR "image_source" IN ('r2_user_uploaded','lens_workbench')
        ) AS "imageWorkReady"
      FROM "products"
      WHERE "id" IN (${Prisma.join(ids)})
    `;
    return new Map(rows.map((row) => [row.id, row]));
  } catch {
    return new Map();
  }
}

async function fetchPocamarketChanges(ids: string[]) {
  if (!ids.length) return new Map<string, PocamarketChange>();
  const rows = await prisma.$queryRaw<PocamarketChange[]>`
    SELECT DISTINCT ON ("product_id")
      "product_id" AS "productId", "status", "previous_price" AS "previousPrice",
      "observed_price" AS "observedPrice",
      "previous_available_count" AS "previousAvailableCount",
      "observed_available_count" AS "observedAvailableCount"
    FROM "pocamarket_sync_items"
    WHERE "product_id" IN (${Prisma.join(ids)}) AND "applied_at" IS NOT NULL
    ORDER BY "product_id", "observed_at" DESC NULLS LAST
  `;
  return new Map(rows.map((row) => [row.productId, row]));
}

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
  sort?: string;
  freshness?: string;
  upload?: string;
  operation?: string;
  channel?: string;
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
    members: memberOptions(products.map((product) => product.optionName)),
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
  const channel: ProductSalesChannel = params.channel === "SHOPIFY" ? "SHOPIFY" : "EBAY";
  const where = await productSearchWhere(params, user.id);
  const operationalViews = new Set<ProductOperationalView>([
    "sellable",
    "selling",
    "listable",
    "own_photo_listable",
    "unit_no_members",
    "price_missing",
    "image_pending",
    "in_stock",
    "procurement_ready",
    "procurement_listable",
    "stop_required",
    "sold_out",
    "review",
  ]);
  if (
    params.operation &&
    operationalViews.has(params.operation as ProductOperationalView)
  ) {
    const operationIds = await getOperationalProductIds(
      params.operation as ProductOperationalView,
      channel,
    );
    const existingAnd = Array.isArray(where.AND)
      ? where.AND
      : where.AND
        ? [where.AND]
        : [];
    where.AND = [...existingAnd, { id: { in: operationIds } }];
  }
  const [totalFiltered, productStats] = await Promise.all([
    prisma.product.count({ where }),
    getProductStats(channel),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
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
        isSoldOut: true,
        pocamarketAvailableCount: true,
        pocamarketSyncedAt: true,
        ebayPrice: true,
        stockQuantity: true,
        safetyStock: true,
        location: true,
        memo: true,
        imageUrl: true,
        ebayImageUrls: true,
        status: true,
        updatedAt: true,
        shopifyProductId: true,
        shopifyStatus: true,
        shopifyLastUploadedAt: true,
        ebayItemId: true,
        listingStatus: true,
        lastUploadedAt: true,
      },
      orderBy: productOrderBy(params.sort),
      skip,
      take: pageSize,
    });
  const hasNextPage = currentPage < totalPages;
  const products = fetchedProducts;
  const initialFacets = facetsFromProducts(products);
  const productIds = products.map((p) => p.id);
  const [
    photoStatusById,
    extrasById,
    changeById,
    variationByProductId,
  ] = await Promise.all([
    fetchPhotoStatusByIds(productIds),
    productImageExtrasById(productIds),
    fetchPocamarketChanges(productIds),
    fetchVariationMembershipByProductId(user.id),
  ]);
  const productRows: ProductQuickEditValue[] = products.map((product) => {
    const photo = photoStatusById.get(product.id);
    const change = changeById.get(product.id);
    const variation = variationByProductId.get(product.id);

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
      isSoldOut: product.isSoldOut,
      pocamarketAvailableCount: product.pocamarketAvailableCount,
      pocamarketSyncedAt: product.pocamarketSyncedAt?.toISOString() ?? null,
      pocamarketChangeStatus: change?.status ?? null,
      pocamarketPreviousPrice: change?.previousPrice?.toString() ?? null,
      pocamarketPreviousAvailableCount: change?.previousAvailableCount ?? null,
      ebayPrice: product.ebayPrice?.toString() ?? null,
      stockQuantity: product.stockQuantity,
      safetyStock: product.safetyStock,
      location: product.location,
      memo: product.memo,
      imageUrl:
        photo?.imageSource === "lens_workbench"
          ? product.imageUrl ?? product.ebayImageUrls[0]
          : product.imageUrl,
      sourceImageUrl:
        photo?.sourceImageUrl && photo.sourceImageUrl !== product.imageUrl
          ? photo.sourceImageUrl
          : product.ebayItemId
            ? product.ebayImageUrls[0] ?? `/api/products/${product.id}/ebay-display-image`
            : photo?.sourceImageUrl ?? null,
      imageSource: photo?.imageSource ?? null,
      userImageRegistered: photo?.userImageRegistered ?? false,
      hasBackImage: photo?.hasBackImage ?? false,
      imageWorkReady: photo?.imageWorkReady ?? false,
      procurementSellable:
        product.stockQuantity <= 0 &&
        (product.pocamarketAvailableCount ?? 0) > 0 &&
        (photo?.imageWorkReady ?? false),
      imageUpdatedAt: product.updatedAt.toISOString(),
      status: product.status,
      featuredMembers: extrasById.get(product.id)?.featuredMembers ?? null,
      shopifyProductId: product.shopifyProductId,
      shopifyStatus: product.shopifyStatus,
      shopifyLastUploadedAt: product.shopifyLastUploadedAt?.toISOString() ?? null,
      ebayItemId: product.ebayItemId,
      listingStatus: product.listingStatus,
      ebayVariationItemId: variation?.itemId ?? null,
      ebayVariationState: variation?.state ?? null,
      ebayVariationTitle: variation?.title ?? null,
      lastUploadedAt: product.lastUploadedAt?.toISOString() ?? null,
    };
  });
  const shopifyStoreHandle = process.env.SHOPIFY_STORE_DOMAIN ?? null;
  const shortcutLabels: Record<string, string> = {
    image_pending: "판매 이미지 작업 필요",
    price_missing: "판매가격 입력 필요",
    review: "포카 정보 확인 필요",
    in_stock: "내 재고 중 이미지 준비 완료",
  };
  const resultLabel = shortcutLabels[params.operation ?? ""] ?? "상품 조회 결과";
  const start = totalFiltered ? (currentPage - 1) * pageSize + 1 : 0;
  const end = totalFiltered ? start + products.length - 1 : 0;

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <ProductStatsCards key={channel} pageSize={pageSize} stats={productStats} channel={channel} />
        <EbayActiveReportPanel />
      </main>
      <ProductsControls initialFacets={initialFacets} />
      <main id="product-results" tabIndex={-1} className="mx-auto max-w-7xl scroll-mt-16 px-4 py-6 outline-none sm:px-6">
        <h1 className="mb-4 text-lg font-bold text-zinc-900">{resultLabel} <span className="text-sm font-medium text-zinc-500">{totalFiltered.toLocaleString()}개</span></h1>
        <ResizableProductsTable
          products={productRows}
          shopifyStoreHandle={shopifyStoreHandle}
        />

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
