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
  const ids = await getOperationalProductIds("price_missing", user.id);
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
        <h1 className="text-2xl font-semibold">가격 미입력 상품</h1>
        <p className="mb-1 mt-1 text-sm text-zinc-500">
          공급과 이미지는 끝났는데 포카마켓 가격도, 수동 eBay 판매가도 없어서 신규등록
          파일에서 빠지는 상품입니다. 판매가(USD)를 넣어 저장하면 목록에서 사라지고 바로
          신규등록 대상이 됩니다. (현재 {ids.length.toLocaleString()}개
          {ids.length > items.length ? `, 이 화면에 ${items.length.toLocaleString()}개 표시` : ""})
        </p>
        <p className="mb-5 text-xs text-zinc-500">
          여기서 저장한 금액은 마진 계산을 거치지 않고 그대로 eBay 시작가로 나갑니다.
          나중에 포카마켓 가격이 확인되면 그때부터는 계산된 권장가가 우선합니다.
        </p>
        <PriceMissingClient items={items} pricingReady={Boolean(pricingSettings)} />
      </main>
    </div>
  );
}
