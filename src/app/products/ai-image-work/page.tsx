import { AiImageWorkClient } from "@/components/AiImageWorkClient";
import { TopNav } from "@/components/TopNav";
import {
  ensureAiImageJobs,
  reconcileAiImageJobsForSupply,
} from "@/lib/ai-image-work";
import { prisma } from "@/lib/prisma";
import { getProductStats } from "@/lib/product-stats";
import { requireUser } from "@/lib/session";
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
  const stats = await getProductStats();
  const items = await prisma.$queryRaw<
    Item[]
  >`SELECT j."id",j."product_id" AS "productId",p."sku",p."product_name" AS "productName",j."source_url" AS "sourceUrl",j."preview_url" AS "previewUrl",j."status",j."error",COALESCE(to_char(j."processed_at",'YYYYMMDDHH24MISSMS'),'') AS "previewVersion" FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id" WHERE j."status" IN ('queued','processing','review','held','pass_ready','rework','failed') ORDER BY CASE WHEN j."status"='review' THEN 0 WHEN j."status"='held' THEN 1 WHEN j."status"='pass_ready' THEN 2 WHEN j."status"='rework' THEN 3 ELSE 4 END,j."created_at" LIMIT 500`;
  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">AI 이미지 작업</h1>
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sm font-bold text-sky-700">
            이미지 작업 필요 {stats.imagePendingCount.toLocaleString()}건
          </span>
        </div>
        <p className="mb-5 mt-1 text-sm text-zinc-500">
          Dewatermark API로 미작업 포토카드를 자동 복원·라운드 처리합니다. 통과한
          결과만 상품 R2 이미지로 최종 업로드됩니다.
        </p>
        <AiImageWorkClient items={items} />
      </main>
    </div>
  );
}
