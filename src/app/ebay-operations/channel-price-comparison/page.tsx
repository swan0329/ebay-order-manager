import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";
import { getChannelPriceComparison } from "@/lib/services/channelPriceComparison";

export const dynamic = "force-dynamic";

export default async function ChannelPriceComparisonPage() {
  const user = await requireUser();
  const { rows, summary } = await getChannelPriceComparison();

  return <div className="min-h-screen bg-zinc-50">
    <TopNav loginId={user.loginId} />
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6">
      <h1 className="text-2xl font-bold">eBay·Shopify 등록 가격 대조</h1>
      <p className="mt-1 text-sm text-zinc-600">같은 SKU가 양쪽 채널에서 모두 판매 중인 상품만 실제 등록 완료 가격을 비교합니다. 종료·비활성 이력은 가격 불일치에서 제외합니다.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-5">
        <Summary label="양쪽 판매 중" value={summary.activeOnBoth} />
        <Summary label="가격 일치" value={summary.equal} />
        <Summary label="가격 불일치" value={summary.different} />
        <Summary label="가격 미확인" value={summary.missingPrice} />
        <Summary label="비활성 이력 제외" value={summary.inactiveExcluded} />
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-100 text-left">
            <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">상품</th><th className="px-3 py-2">eBay</th><th className="px-3 py-2">Shopify</th><th className="px-3 py-2">차이</th><th className="px-3 py-2">상태</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => <tr key={`${row.sku}:${row.ebay.externalId}:${row.shopify.externalId}`} className="border-t">
              <td className="whitespace-nowrap px-3 py-2 font-mono">{row.sku}</td>
              <td className="px-3 py-2">{row.productName}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatPrice(row.ebay.price, row.currency)}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatPrice(row.shopify.price, row.currency)}</td>
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
