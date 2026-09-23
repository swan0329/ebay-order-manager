import { AiImageWorkClient } from "@/components/AiImageWorkClient";
import { TopNav } from "@/components/TopNav";
import {
  ensureAiImageJobs,
  reconcileAiImageJobsForSupply,
} from "@/lib/ai-image-work";
import { prisma } from "@/lib/prisma";
import { getProductStats } from "@/lib/product-stats";
import { requireUser } from "@/lib/session";
import Link from "next/link";
export const dynamic = "force-dynamic";
type Item = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  sourceUrl: string;
  previewUrl: string | null;
  status: string;
  error: string | null;
  previewVersion: string;
};
export default async function Page() {
  const user = await requireUser();
  await ensureAiImageJobs();
  await reconcileAiImageJobsForSupply();
  const stats = await getProductStats(user.id);
  const items = await prisma.$queryRaw<
    Item[]
  >`SELECT j."id",j."product_id" AS "productId",p."sku",p."product_name" AS "productName",j."source_url" AS "sourceUrl",j."preview_url" AS "previewUrl",j."status",j."error",COALESCE(to_char(j."processed_at",'YYYYMMDDHH24MISSMS'),'') AS "previewVersion" FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id" WHERE j."status" IN ('queued','processing','enhancement_queued','enhancing','enhancement_failed','review','held','pass_ready','rework','failed') ORDER BY CASE WHEN j."status"='review' THEN 0 WHEN j."status"='held' THEN 1 WHEN j."status"='pass_ready' THEN 2 WHEN j."status"='enhancement_failed' THEN 3 WHEN j."status"='rework' THEN 4 ELSE 5 END,j."created_at" LIMIT 500`;
  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">AI 이미지 작업</h1>
          <Link href="/products/ai-image-work/settings" className="rounded border bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700">화질 개선 설정</Link>
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sm font-bold text-sky-700">
            이미지 작업 필요 {stats.imagePendingCount.toLocaleString()}건
          </span>
        </div>
        <p className="mb-5 mt-1 text-sm text-zinc-500">
          포카마켓 원본은 워터마크 제거 뒤 이 PC의 로컬 GPU에서 자연스럽게 화질 개선됩니다. 검수에는 원본과 최종 결과만 보이며, 개선 실패 시에도 제거본은 보존되어 크레딧 없이 개선만 다시 시도할 수 있습니다.
        </p>
        <AiImageWorkClient items={items} />
      </main>
    </div>
  );
}
