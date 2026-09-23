import {
  aiProductAllowedSql,
  aiProductWorkPendingSql,
  aiProductSupplySql,
} from "@/lib/ai-image-policy";
import { AiImageUpcomingPanel } from "@/components/AiImageUpcomingPanel";
import { AiImageWorkClient } from "@/components/AiImageWorkClient";
import {
  listExcludedAiImageWork,
  listUpcomingAiImageWork,
} from "@/lib/ai-image-work";
import { TopNav } from "@/components/TopNav";
import { Suspense } from "react";
import { Prisma } from "@/generated/prisma";
import { getDewatermarkBillingUrl } from "@/lib/dewatermark-api";
import { prisma } from "@/lib/prisma";
import { imageReadySql } from "@/lib/product-operations";
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
  canRestore: boolean;
  /** 렌즈 원본과 찍었던 네 점. 있으면 영역을 다시 잡을 수 있다. */
  lensSourceUrl: string | null;
  lensCorners: Array<{ x: number; y: number }> | null;
};
const PREVIEW_PAGE_SIZE = 48;

async function PendingCount() {
  const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS "count" FROM "products" p
    WHERE ${aiProductAllowedSql} AND ${aiProductSupplySql}
      AND NOT ${Prisma.raw(imageReadySql)} AND ${aiProductWorkPendingSql}`;
  return <>이미지 작업 필요 {row.count.toLocaleString()}건</>;
}

async function UpcomingPanel() {
  const page = { limit: PREVIEW_PAGE_SIZE, offset: 0 };
  const upcoming = await listUpcomingAiImageWork(page);
  const excluded = await listExcludedAiImageWork(page);
  return (
    <AiImageUpcomingPanel
      upcoming={upcoming.items}
      upcomingTotal={upcoming.total}
      excluded={excluded.items}
      excludedTotal={excluded.total}
      pageSize={PREVIEW_PAGE_SIZE}
    />
  );
}

async function WorkList() {
  const items = await prisma.$queryRaw<
    Item[]
  >`SELECT j."id",j."product_id" AS "productId",p."sku",p."product_name" AS "productName",j."source_url" AS "sourceUrl",j."preview_url" AS "previewUrl",CASE WHEN j."status"='waiting_supply' THEN 'queued' ELSE j."status" END AS "status",CASE WHEN j."status"='waiting_supply' THEN NULL ELSE j."error" END AS "error",COALESCE(to_char(j."processed_at",'YYYYMMDDHH24MISSMS'),'') AS "previewVersion",COALESCE(j."backup_preview_url",'')<>'' AS "canRestore",j."lens_source_url" AS "lensSourceUrl",j."lens_corners_json" AS "lensCorners" FROM "ai_image_jobs" j JOIN "products" p ON p."id"=j."product_id" WHERE ${aiProductAllowedSql} AND (j."status" IN ('processing','enhancement_queued','enhancing','enhancement_failed','review','held','pass_ready','rework','failed') OR (j."status" IN ('queued','waiting_supply') AND (p."stock_quantity">0 OR COALESCE(p."pocamarket_available_count",0)>0))) ORDER BY CASE WHEN j."status"='review' THEN 0 WHEN j."status"='held' THEN 1 WHEN j."status"='pass_ready' THEN 2 WHEN j."status"='enhancement_failed' THEN 3 WHEN j."status"='rework' THEN 4 ELSE 5 END,j."created_at",p."sku" LIMIT 500`;
  return (
    <AiImageWorkClient items={items} billingUrl={getDewatermarkBillingUrl()} />
  );
}

export default async function Page() {
  const user = await requireUser();
  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">AI 이미지 작업</h1>
          <Link href="/products/ai-image-work/settings" className="rounded border bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">화질 개선 설정</Link>
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sm font-bold text-sky-700">
            <Suspense fallback="작업 건수 조회 중…"><PendingCount /></Suspense>
          </span>
        </div>
        <p className="mb-5 mt-1 text-sm text-zinc-500">
          BTS는 수동 이미지 작업 전용으로 이 목록과 자동 처리에서 제외됩니다. 포카마켓 원본은 워터마크 제거 뒤 이 PC의 로컬 GPU에서 자연스럽게 화질 개선됩니다. 검수에는 원본과 최종 결과만 보이며, 통과한 결과만 상품 R2 이미지로 업로드됩니다. 개선이 실패해도 제거본은 보존되어 크레딧 없이 화질 개선만 다시 시도할 수 있습니다.
        </p>
        <Suspense fallback={<p role="status" className="rounded-xl border bg-white p-6">AI 이미지 작업 목록을 불러오는 중입니다…</p>}><WorkList /></Suspense>
        <Suspense
          fallback={
            <p role="status" className="mt-5 rounded-xl border bg-white p-6">
              처리 예정 상품을 불러오는 중입니다…
            </p>
          }
        >
          <UpcomingPanel />
        </Suspense>
      </main>
    </div>
  );
}
