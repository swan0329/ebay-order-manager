import { ImageReviewQueue } from "@/components/ImageReviewQueue";
import { TopNav } from "@/components/TopNav";
import { ensureImageWorkAssignments } from "@/lib/image-work-assignments";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
type Row = { assignmentId: string; sku: string; productName: string; referenceUrl: string; resultUrl: string; workerName: string };
export default async function ReviewsPage() {
  const user = await requireUser(); await ensureImageWorkAssignments();
  const items = await prisma.$queryRaw<Row[]>`
    SELECT a."id" AS "assignmentId", p."sku", p."product_name" AS "productName", p."image_url" AS "referenceUrl",
      a."result_url" AS "resultUrl", COALESCE(u."name",u."login_id") AS "workerName"
    FROM "image_work_assignments" a JOIN "products" p ON p."id"=a."product_id" JOIN "users" u ON u."id"=a."worker_id"
    WHERE a."status"='submitted' AND a."result_url" IS NOT NULL ORDER BY a."submitted_at" ASC
  `;
  return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId}/><main className="mx-auto max-w-7xl px-4 py-6"><h1 className="text-2xl font-semibold">이미지 검수</h1><p className="mb-5 mt-1 text-sm text-zinc-500">승인된 결과만 Lens eBay CSV에 포함됩니다.</p><ImageReviewQueue items={items}/></main></div>;
}
