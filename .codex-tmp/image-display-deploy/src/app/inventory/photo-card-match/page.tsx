import { PhotoCardMatchClient } from "@/components/PhotoCardMatchClient";
import { R2ConnectionStatusPanel } from "@/components/R2ConnectionStatusPanel";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PhotoCardMatchPage() {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-900">촬영본 업로드 사용 방법</p>
          <p className="mt-1 text-sm text-blue-800">
            이 화면에서 앞면/뒷면 촬영본을 저장하면, 서버가 이미지를 압축해 Cloudflare R2에 자동 업로드합니다.
          </p>
          <p className="mt-1 text-xs text-blue-700">
            저장 후 카드 목록의 `R2 상태`가 `등록`으로 바뀌면 업로드가 완료된 것입니다.
          </p>
        </div>
        <div className="mb-4">
          <R2ConnectionStatusPanel />
        </div>
        <PhotoCardMatchClient />
      </main>
    </div>
  );
}
