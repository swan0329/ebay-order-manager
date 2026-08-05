import { EbayLinkClient } from "@/components/EbayLinkClient";
import { EbayUnlinkPanel } from "@/components/EbayUnlinkPanel";
import { TopNav } from "@/components/TopNav";
import { getEbayLinkSuggestions } from "@/lib/ebay-listing-link-suggestions";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// 한 화면에서 다루는 리스팅 수. eBay 사진을 이 개수만큼 받아오므로 너무 크게
// 잡지 않는다. 처리한 만큼 목록에서 빠지고 새로고침하면 다음 묶음이 채워진다.
const pageLimit = 20;

export default async function EbayLinkPage() {
  const user = await requireUser();
  const suggestions = await getEbayLinkSuggestions(user.id, pageLimit);

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1100px] px-4 py-6">
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
        <EbayLinkClient
          initial={suggestions.listings}
          totalPending={suggestions.totalPending}
          reportImportedAt={suggestions.reportImportedAt}
        />
      </main>
    </div>
  );
}
