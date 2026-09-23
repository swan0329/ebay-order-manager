import { ImageEnhancementSettings } from "@/components/ImageEnhancementSettings";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";
import Link from "next/link";

export default async function AiImageWorkSettingsPage() {
  const user = await requireUser();
  return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId} /><main className="mx-auto max-w-5xl px-4 py-6"><Link href="/products/ai-image-work" className="text-sm font-semibold text-violet-700">← AI 이미지 작업</Link><h1 className="mt-3 text-2xl font-bold">화질 개선 설정</h1><p className="mb-5 mt-1 text-sm text-zinc-600">작업 화면을 단순하게 유지하기 위한 별도 설정입니다.</p><ImageEnhancementSettings /></main></div>;
}
