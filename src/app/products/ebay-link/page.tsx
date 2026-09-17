import { EbayLinkClient } from "@/components/EbayLinkClient";
import { EbayUnlinkPanel } from "@/components/EbayUnlinkPanel";
import { TopNav } from "@/components/TopNav";
import { getEbayLinkSuggestions } from "@/lib/ebay-listing-link-suggestions";
import { requireUser } from "@/lib/session";
import Link from "next/link";

export const dynamic = "force-dynamic";

// 한 화면에서 다루는 리스팅 수. eBay 사진을 이 개수만큼 받아오므로 너무 크게
// 잡지 않는다. 처리한 만큼 목록에서 빠지고 새로고침하면 다음 묶음이 채워진다.
const pageLimit = 20;

export default async function EbayLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ itemId?: string; page?: string; productSku?: string }>;
}) {
  const user = await requireUser();
  const { itemId, page: pageParam, productSku } = await searchParams;
  const parsedPage = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const suggestions = await getEbayLinkSuggestions(
    user.id,
    pageLimit,
    /^\d+$/.test(itemId ?? "") ? itemId : undefined,
    (page - 1) * pageLimit,
    /^\d+$/.test(productSku ?? "") ? productSku : undefined,
  );
  const totalPages = Math.max(1, Math.ceil(suggestions.totalPending / pageLimit));

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <h1 className="text-2xl font-semibold">eBay 리스팅 연결</h1>
        <p className="mb-1 mt-1 text-sm text-zinc-500">
          eBay에는 올라가 있는데 프로그램의 상품과 연결되지 않은 리스팅입니다. 주로 수동으로
          올려 SKU가 맞지 않는 경우입니다. 연결하면 해당 상품이 &quot;판매중&quot;으로 바뀌고,
          그 리스팅에서 주문이 들어올 때 재고가 정상적으로 차감됩니다.
        </p>
        <p className="mb-5 text-xs text-zinc-500">
          연결은 프로그램 안의 짝만 맞추는 작업이며 eBay에는 아무것도 올리거나 바꾸지 않습니다.
          제목으로 고른 후보는 확실한 것만 보여주므로, 비어 있거나 맞는 게 없으면{" "}
          <strong>사진으로 찾기</strong>를 쓰세요. 사진 비교가 제목보다 정확합니다.
        </p>
        <EbayUnlinkPanel />
        {productSku ? (
          <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            SKU {productSku}의 연결 복구 후보를 표시 중입니다. eBay 사진과 촬영본이 같은 항목만 연결하세요.
          </p>
        ) : null}
        <EbayLinkClient
          initial={suggestions.listings}
          totalPending={suggestions.totalPending}
          reportImportedAt={suggestions.reportImportedAt}
        />
        {!itemId && totalPages > 1 ? (
          <nav className="mt-6 flex items-center justify-center gap-3 text-sm">
            {page > 1 ? (
              <Link className="rounded border bg-white px-3 py-2" href={`/products/ebay-link?page=${page - 1}${productSku ? `&productSku=${encodeURIComponent(productSku)}` : ""}`}>
                이전 20건
              </Link>
            ) : null}
            <span>{page} / {totalPages} 페이지</span>
            {page < totalPages ? (
              <Link className="rounded border bg-white px-3 py-2" href={`/products/ebay-link?page=${page + 1}${productSku ? `&productSku=${encodeURIComponent(productSku)}` : ""}`}>
                다음 20건
              </Link>
            ) : null}
          </nav>
        ) : null}
      </main>
    </div>
  );
}
