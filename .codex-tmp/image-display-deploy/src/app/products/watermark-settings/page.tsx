import { TopNav } from "@/components/TopNav";
import { WatermarkSettingsPanel } from "@/components/WatermarkSettingsPanel";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function WatermarkSettingsPage() {
  const user = await requireUser();
  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <h1 className="text-2xl font-semibold text-zinc-950">워터마크 설정</h1>
        <p className="mb-5 mt-1 text-sm text-zinc-500">한 번 저장한 이미지 가공 설정을 eBay·Shopify·옵션 대표 썸네일이 함께 사용합니다.</p>
        <WatermarkSettingsPanel defaultOpen standalone />
      </main>
    </div>
  );
}
