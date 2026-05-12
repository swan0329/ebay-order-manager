import { EbayEnvironmentBadge } from "@/components/EbayEnvironmentBadge";
import { ListingInventorySelector } from "@/components/ListingInventorySelector";
import { ListingUploadNav } from "@/components/ListingUploadNav";
import { TopNav } from "@/components/TopNav";
import { resolveInventoryListingUploadStatus } from "@/lib/listing-upload-status";
import { productWhere } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { getEbayConnectionSummary } from "@/lib/services/ebayAccountService";
import { listListingTemplates } from "@/lib/services/listingTemplateService";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  q?: string;
  listing?: string;
  inStock?: string;
}>;

export default async function ListingUploadFromInventoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const where = productWhere({ q: params.q });

  if (params.inStock === "true") {
    where.stockQuantity = { gt: 0 };
  }

  if (params.listing === "unlisted") {
    where.ebayItemId = null;
  } else if (params.listing === "listed") {
    where.ebayItemId = { not: null };
  }

  const [products, templates, ebayConnection] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        listingDrafts: {
          where: { userId: user.id },
          select: { status: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 3,
        },
        listingLinks: true,
      },
    }),
    listListingTemplates(user.id),
    getEbayConnectionSummary(user.id),
  ]);

  const productRows = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    productName: product.productName,
    brand: product.brand,
    category: product.category,
    salePrice: product.salePrice?.toString() ?? null,
    stockQuantity: product.stockQuantity,
    imageUrl: product.imageUrl,
    ebayItemId: product.ebayItemId,
    listingStatus: product.listingStatus,
    listingUploadStatus: resolveInventoryListingUploadStatus(product),
  }));

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-zinc-950">재고에서 상품 선택</h1>
          <p className="mt-1 text-sm text-zinc-600">
            기존 재고 데이터를 기준으로 엑셀 업로드용 Draft를 빠르게 준비합니다.
          </p>
          <div className="mt-2">
            <EbayEnvironmentBadge {...ebayConnection} />
          </div>
        </div>
        <ListingUploadNav active="/listing-upload/from-inventory" />
        <ListingInventorySelector
          products={productRows}
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
