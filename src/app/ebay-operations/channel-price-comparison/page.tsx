import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChannelPriceComparisonPage() {
  const user = await requireUser();
  const listings = await prisma.productListing.findMany({
    where: { channel: { in: ["EBAY", "SHOPIFY"] } },
    select: {
      productId: true,
      channel: true,
      externalId: true,
      price: true,
      status: true,
      updatedAt: true,
      product: { select: { sku: true, productName: true, ebayCurrency: true } },
    },
  });

  const byProduct = new Map<string, typeof listings>();
  for (const listing of listings) {
    byProduct.set(listing.productId, [...(byProduct.get(listing.productId) ?? []), listing]);
  }

  const rows = [...byProduct.values()].flatMap((productListings) => {
    const ebay = productListings.find((listing) => listing.channel === "EBAY");
    const shopify = productListings.find((listing) => listing.channel === "SHOPIFY");
    if (!ebay || !shopify) return [];
    const ebayPrice = ebay.price == null ? null : Number(ebay.price);
    const shopifyPrice = shopify.price == null ? null : Number(shopify.price);
    const difference = ebayPrice == null || shopifyPrice == null
      ? null
      : Number((shopifyPrice - ebayPrice).toFixed(2));
    return [{
      sku: ebay.product.sku,
      productName: ebay.product.productName,
      currency: ebay.product.ebayCurrency ?? "USD",
      ebayPrice,
      shopifyPrice,
      difference,
      ebayId: ebay.externalId,
      shopifyId: shopify.externalId,
      ebayUpdatedAt: ebay.updatedAt,
      shopifyUpdatedAt: shopify.updatedAt,
    }];
  }).sort((a, b) => {
    const aEqual = a.difference === 0;
    const bEqual = b.difference === 0;
    if (aEqual !== bEqual) return aEqual ? 1 : -1;
    return Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0);
  });

  const equal = rows.filter((row) => row.difference === 0).length;
  const different = rows.filter((row) => row.difference !== null && row.difference !== 0).length;
  const missing = rows.filter((row) => row.difference === null).length;

  return <div className="min-h-screen bg-zinc-50">
    <TopNav loginId={user.loginId} />
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6">
      <h1 className="text-2xl font-bold">eBay·Shopify 등록 가격 대조</h1>
      <p className="mt-1 text-sm text-zinc-600">같은 SKU에 저장된 양쪽 채널의 실제 등록 완료 가격을 비교합니다.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Summary label="양쪽 등록" value={rows.length} />
        <Summary label="가격 일치" value={equal} />
        <Summary label="가격 불일치" value={different} />
        <Summary label="가격 미확인" value={missing} />
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-100 text-left">
            <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">상품</th><th className="px-3 py-2">eBay</th><th className="px-3 py-2">Shopify</th><th className="px-3 py-2">차이</th><th className="px-3 py-2">상태</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => <tr key={`${row.sku}:${row.ebayId}:${row.shopifyId}`} className="border-t">
              <td className="whitespace-nowrap px-3 py-2 font-mono">{row.sku}</td>
              <td className="px-3 py-2">{row.productName}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatPrice(row.ebayPrice, row.currency)}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatPrice(row.shopifyPrice, row.currency)}</td>
              <td className="whitespace-nowrap px-3 py-2">{row.difference == null ? "-" : formatPrice(row.difference, row.currency)}</td>
              <td className={`whitespace-nowrap px-3 py-2 font-semibold ${row.difference === 0 ? "text-emerald-700" : "text-red-700"}`}>{row.difference === 0 ? "일치" : row.difference == null ? "미확인" : "불일치"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </main>
  </div>;
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border bg-white p-4"><p className="text-sm text-zinc-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>;
}

function formatPrice(value: number | null, currency: string) {
  return value == null ? "-" : `${currency} ${value.toFixed(2)}`;
}
