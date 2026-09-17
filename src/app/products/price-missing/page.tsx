import { PriceMissingClient } from "@/components/PriceMissingClient";
import { TopNav } from "@/components/TopNav";
import { productImageExtrasById } from "@/lib/product-export-image-extras";
import { getOperationalProductIds } from "@/lib/product-operations";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// 한 화면에서 다루는 최대 개수. 더 있으면 저장할 때마다 목록이 줄어들고
// 새로고침하면 다음 묶음이 채워진다.
const pageLimit = 300;

export default async function PriceMissingPage() {
  const user = await requireUser();
  const ids = await getOperationalProductIds("price_missing");
  const [products, pricingSettings] = await Promise.all([
    ids.length
      ? prisma.product.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            sku: true,
            productName: true,
            optionName: true,
            brand: true,
            category: true,
            costPrice: true,
            imageUrl: true,
            ebayImageUrls: true,
            stockQuantity: true,
            pocamarketAvailableCount: true,
          },
          orderBy: { sku: "asc" },
          take: pageLimit,
        })
      : [],
    prisma.pricingSettings.findUnique({ where: { id: "default" }, select: { id: true } }),
  ]);
  const extrasById = await productImageExtrasById(products.map((product) => product.id));

  const items = products.map((product) => {
    const extras = extrasById.get(product.id);

    return {
      id: product.id,
      sku: product.sku,
      productName: product.productName,
      optionName: product.optionName,
      brand: product.brand,
      category: product.category,
      // 신규등록 파일이 고르는 순서와 같게 맞춘다(촬영본 → eBay 이미지 → 현재 이미지).
      imageUrl:
        extras?.userFrontImageUrl ||
        product.ebayImageUrls[0] ||
        product.imageUrl ||
        extras?.sourceImageUrl ||
        null,
      costPriceKrw: product.costPrice?.toString() ?? null,
      stockQuantity: product.stockQuantity,
      pocamarketAvailableCount: product.pocamarketAvailableCount,
    };
  });

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1100px] px-4 py-6">
        <h1 className="text-2xl font-semibold">최종가 미확정 상품</h1>
        <p className="mb-1 mt-1 text-sm text-zinc-500">
          공급과 이미지는 끝났지만 관리자가 확정한 최종 판매가(USD)가 없는 상품입니다.
          이미 판매 중인 과거 상품도 포함되므로, 가격을 확인해 확정한 뒤 채널 가격·수량
          반영에서 실제 Shopify/eBay 가격을 정정하세요.
          (현재 {ids.length.toLocaleString()}개
          {ids.length > items.length ? `, 이 화면에 ${items.length.toLocaleString()}개 표시` : ""})
        </p>
        <p className="mb-5 text-xs text-zinc-500">
          여기서 확정한 금액은 eBay와 Shopify에 공통으로 적용되는 최종 USD 판매가입니다.
          포카마켓 가격이 확인되면 가격관리에서 다시 계산·승인해 새 최종가를 확정하세요.
        </p>
        <PriceMissingClient items={items} pricingReady={Boolean(pricingSettings)} />
      </main>
    </div>
  );
}
