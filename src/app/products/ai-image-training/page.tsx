import { AiImageTrainingClient } from "@/components/AiImageTrainingClient";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AiImageTrainingPage() {
  const user = await requireUser();
  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold text-zinc-950">워터마크 AI 자동 학습</h1>
        <p className="mt-1 text-sm text-zinc-500">
          PC의 before/after 샘플을 누적 학습하고, 검증을 통과한 모델만 AI 이미지 작업에서 사용합니다.
        </p>
        <div className="mt-6"><AiImageTrainingClient /></div>
      </main>
    </div>
  );
}
