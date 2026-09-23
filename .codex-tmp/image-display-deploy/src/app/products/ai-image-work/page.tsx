import { aiProductAllowedSql } from "@/lib/ai-image-policy";
import { AiImageWorkClient } from "@/components/AiImageWorkClient";
import { TopNav } from "@/components/TopNav";
import { Suspense } from "react";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { imageReadySql } from "@/lib/product-operations";
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
async function PendingCount() {
  const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS "count" FROM "products"
    WHERE ${aiProductAllowedSql} AND ("stock_quantity">0 OR COALESCE("pocamarket_available_count",0)>0)
      AND NOT ${Prisma.raw(imageReadySql)}`;
  return <>이미지 작업 필요 {row.count.toLocaleString()}건</>;
}

async function WorkList() {
  const items = await prisma.$queryRaw<
    Item[]
  >`SELECT j."id",j."product_id" AS "productId",p."sku",p."product_name" AS "productName",j."source_url" AS "sourceUrl",j."preview_url" AS "previewUrl",CASE WHEN j."status"='waiting_supply' THEN 'queued' ELSE j."status" END AS "status",CASE WHEN j."status"='waiting_supply' THEN NULL ELSE j."error" END AS "error",COALESCE(to_char(j."processed_at",'YYYYMMDDHH24MISSMS'),'') AS "previewVersion" FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id" WHERE ${aiProductAllowedSql} AND (j."status" IN ('processing','review','held','pass_ready','rework','failed') OR (j."status" IN ('queued','waiting_supply') AND (p."stock_quantity">0 OR COALESCE(p."pocamarket_available_count",0)>0))) ORDER BY CASE WHEN j."status"='review' THEN 0 WHEN j."status"='held' THEN 1 WHEN j."status"='pass_ready' THEN 2 WHEN j."status"='rework' THEN 3 ELSE 4 END,j."created_at" LIMIT 500`;
  return <AiImageWorkClient items={items} />;
}

export default async function Page() {
  const user = await requireUser();
  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">AI 이미지 작업</h1>
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sm font-bold text-sky-700">
            <Suspense fallback="작업 건수 조회 중…"><PendingCount /></Suspense>
          </span>
        </div>
        <p className="mb-5 mt-1 text-sm text-zinc-500">
          BTS는 수동 이미지 작업 전용으로 이 목록과 자동 처리에서 제외됩니다. Dewatermark API로 미작업 포토카드를 자동 복원·라운드 처리합니다. 통과한
          결과만 상품 R2 이미지로 최종 업로드됩니다.
        </p>
        <Suspense fallback={<p role="status" className="rounded-xl border bg-white p-6">AI 이미지 작업 목록을 불러오는 중입니다…</p>}><WorkList /></Suspense>
      </main>
    </div>
  );
}
