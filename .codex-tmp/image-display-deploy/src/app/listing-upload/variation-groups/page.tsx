import { VariationListingGroupsClient } from "@/components/VariationListingGroupsClient";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";

export default async function Page() {
  const user = await requireUser();
  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-zinc-950">옵션상품 자동 구성</h1>
          <p className="mt-1 text-sm text-zinc-600">
            이미지 작업과 최종 검수가 승인된 카드만 그룹 · 앨범 · 버전별로 묶습니다.
          </p>
      </div>
        <VariationListingGroupsClient />
      </main>
    </div>
  );
}
