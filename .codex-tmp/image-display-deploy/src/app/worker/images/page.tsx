/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ProductImageWorkbench } from "@/components/ProductImageWorkbench";
import { WorkerHeader } from "@/components/WorkerHeader";
import { ensureImageWorkAssignments } from "@/lib/image-work-assignments";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/session";

export const dynamic = "force-dynamic";
type Item = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  optionName: string | null;
  imageUrl: string;
  status: string;
  rejectionReason: string | null;
};

export default async function WorkerImagesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireWorker();
  await ensureImageWorkAssignments();
  const params = await searchParams;
  const items = await prisma.$queryRaw<Item[]>`
    SELECT a."id", p."id" AS "productId", p."sku", p."product_name" AS "productName",
      p."option_name" AS "optionName", p."image_url" AS "imageUrl", a."status", a."rejection_reason" AS "rejectionReason"
    FROM "image_work_assignments" a JOIN "products" p ON p."id" = a."product_id"
    WHERE a."worker_id" = ${user.id} AND a."status" IN ('assigned', 'in_progress', 'rejected')
    ORDER BY a."assigned_at" ASC
  `;
  const index = Math.max(
    0,
    params.id ? items.findIndex((item) => item.productId === params.id) : 0,
  );
  const selected = items[index] ?? items[0] ?? null;
  const next =
    items[index + 1] ??
    items.find((item) => item.productId !== selected?.productId) ??
    null;
  return (
    <div className="min-h-screen bg-zinc-50">
      <WorkerHeader name={user.name ?? user.loginId} />
      <main className="mx-auto max-w-[1800px] px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">내 이미지 작업</h1>
            <p className="text-sm text-zinc-500">
              배정된 상품만 표시됩니다. 가격·재고·주문 정보에는 접근할 수
              없습니다.
            </p>
          </div>
          <span className="rounded-full bg-violet-100 px-3 py-1 font-semibold text-violet-800">
            남은 작업 {items.length}개
          </span>
        </div>
        {!selected ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-10 text-center text-emerald-800">
            배정된 작업을 모두 완료했습니다.
          </div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-xl border bg-white p-4 shadow-sm">
              {selected.rejectionReason ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">
                  <strong>반려 사유:</strong> {selected.rejectionReason}
                </div>
              ) : null}
              <div className="mt-3 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)_420px]">
                <img src={selected.imageUrl} alt="현재 작업 카드" className="mx-auto h-[300px] w-[190px] rounded-xl border bg-zinc-100 object-contain shadow-sm" />
                <div className="flex min-w-0 flex-col justify-center"><span className="mb-2 w-fit rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">현재 작업</span><strong className="text-xl">{selected.sku}</strong><span className="mt-2 text-base text-zinc-700">{selected.productName}</span><span className="mt-1 text-sm text-zinc-500">{selected.optionName ?? ""}</span><p className="mt-4 text-sm text-zinc-500">이 카드만 확인하고 작업하세요. 승인하면 자동으로 다음 카드로 이동합니다.</p></div>
                <div><strong className="text-sm">다음 작업</strong><div className="mt-2 grid grid-cols-3 gap-2">{items.filter((item) => item.productId !== selected.productId).slice(0, 3).map((item) => <Link key={item.id} href={`/worker/images?id=${item.productId}`} className="rounded-lg border p-2 hover:bg-zinc-50"><img src={item.imageUrl} alt="" className="h-28 w-full rounded bg-zinc-100 object-contain"/><span className="mt-1 block truncate text-xs font-semibold">{item.sku}</span></Link>)}</div></div>
              </div>
              <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-sm font-semibold text-zinc-700">전체 배정 목록 펼치기 ({items.length.toLocaleString("ko-KR")}개)</summary><div className="mt-3 grid max-h-[520px] grid-cols-2 gap-2 overflow-auto sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">{items.map((item) => <Link key={item.id} href={`/worker/images?id=${item.productId}`} className={`rounded-lg border p-2 ${item.productId === selected.productId ? "border-violet-500 bg-violet-50" : item.status === "rejected" ? "border-rose-300 bg-rose-50" : "hover:bg-zinc-50"}`}><img src={item.imageUrl} alt="" className="h-32 w-full rounded bg-zinc-100 object-contain"/><strong className="mt-1 block truncate text-xs">{item.sku}</strong></Link>)}</div></details>
            </section>
            <ProductImageWorkbench key={selected.productId} productId={selected.productId} referenceUrl={selected.imageUrl} imageSource="pocamarket" nextHref={next ? `/worker/images?id=${next.productId}` : "/worker/images"} />
          </div>
        )}
      </main>
    </div>
  );
}
