import Link from "next/link";
/* eslint-disable @next/next/no-img-element */
import { ProductImageWorkbench } from "@/components/ProductImageWorkbench";
import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type QueueProduct = {
  id: string;
  sku: string;
  productName: string;
  optionName: string | null;
  imageUrl: string;
  imageSource: string | null;
};

export default async function ImageWorkbenchQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const queue = await prisma.$queryRaw<QueueProduct[]>`
    SELECT
      "id", "sku", "product_name" AS "productName", "option_name" AS "optionName",
      "image_url" AS "imageUrl", "image_source" AS "imageSource"
    FROM "products"
    WHERE "image_url" IS NOT NULL
      AND "image_url" <> ''
      AND ("user_front_image_url" IS NULL OR "user_front_image_url" = '')
      AND COALESCE("image_source", 'pocamarket') <> 'r2_user_uploaded'
      AND COALESCE("image_source", 'pocamarket') <> 'lens_workbench'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE("ebay_image_urls", ARRAY[]::TEXT[])) AS saved_url
        WHERE saved_url LIKE '%/products/%/lens-card-%'
      )
    ORDER BY "sku" ASC
    LIMIT 500
  `;
  const selectedIndex = Math.max(0, params.id ? queue.findIndex((product) => product.id === params.id) : 0);
  const selected = queue[selectedIndex] ?? queue[0] ?? null;
  const next = selected ? queue[selectedIndex + 1] ?? queue.find((product) => product.id !== selected.id) ?? null : null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">미작업 포토카드 이미지</h1>
            <p className="mt-1 text-sm text-zinc-500">직접 촬영된 상품과 Lens 작업 완료 상품은 자동 제외됩니다. 현재 최대 500개를 표시합니다.</p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">미작업 {queue.length.toLocaleString("ko-KR")}개</span>
        </div>
        {!selected ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-8 text-center text-emerald-800">모든 대상 상품의 이미지 작업이 완료되었습니다.</div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)_420px]">
                <img src={selected.imageUrl} alt="현재 작업 카드" className="mx-auto h-[300px] w-[190px] rounded-xl border bg-zinc-100 object-contain shadow-sm" />
                <div className="flex min-w-0 flex-col justify-center"><span className="mb-2 w-fit rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">현재 작업</span><strong className="text-xl">{selected.sku}</strong><span className="mt-2 text-base text-zinc-700">{selected.productName}</span><span className="mt-1 text-sm text-zinc-500">{selected.optionName ?? ""}</span><p className="mt-4 text-sm text-zinc-500">이 카드만 확인하고 작업하세요. 승인하면 자동으로 다음 카드로 이동합니다.</p></div>
                <div><strong className="text-sm">다음 작업</strong><div className="mt-2 grid grid-cols-3 gap-2">{queue.filter((product) => product.id !== selected.id).slice(0, 3).map((product) => <Link key={product.id} href={`/products/image-workbench?id=${product.id}`} className="rounded-lg border p-2 hover:bg-zinc-50"><img src={product.imageUrl} alt="" className="h-28 w-full rounded bg-zinc-100 object-contain"/><span className="mt-1 block truncate text-xs font-semibold">{product.sku}</span></Link>)}</div></div>
              </div>
              <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-sm font-semibold text-zinc-700">전체 미작업 목록 펼치기 ({queue.length.toLocaleString("ko-KR")}개)</summary><div className="mt-3 grid max-h-[520px] grid-cols-2 gap-2 overflow-auto sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">{queue.map((product) => <Link key={product.id} href={`/products/image-workbench?id=${product.id}`} className={`rounded-lg border p-2 ${product.id === selected.id ? "border-violet-500 bg-violet-50" : "hover:bg-zinc-50"}`}><img src={product.imageUrl} alt="" className="h-32 w-full rounded bg-zinc-100 object-contain"/><strong className="mt-1 block truncate text-xs">{product.sku}</strong></Link>)}</div></details>
            </section>
            <ProductImageWorkbench key={selected.id} productId={selected.id} referenceUrl={selected.imageUrl} imageSource={selected.imageSource} nextHref={next ? `/products/image-workbench?id=${next.id}` : "/products/image-workbench"} />
          </div>
        )}
      </main>
    </div>
  );
}
