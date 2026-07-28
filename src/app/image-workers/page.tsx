import Link from "next/link";
import { Prisma } from "@/generated/prisma";
import { ImageWorkerAdmin } from "@/components/ImageWorkerAdmin";
import { TopNav } from "@/components/TopNav";
import { ensureImageWorkAssignments } from "@/lib/image-work-assignments";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
type Params = { q?: string; group?: string; album?: string; member?: string; state?: string; sort?: string; page?: string; pageSize?: string };
type ProductRow = { id: string; sku: string; productName: string; optionName: string | null; brand: string | null; category: string | null; imageUrl: string | null; assignmentStatus: string | null; workerId: string | null; workerName: string | null };
const sizes = [50, 100, 200, 500, 1000];

export default async function ImageWorkersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser(); await ensureImageWorkAssignments();
  const p = await searchParams;
  const pageSize = sizes.includes(Number(p.pageSize)) ? Number(p.pageSize) : 100;
  const page = Math.max(1, Number(p.page) || 1);
  const state = ["unassigned", "assigned", "submitted", "approved", "rejected", "all"].includes(p.state ?? "") ? p.state! : "unassigned";
  const conditions: Prisma.Sql[] = [Prisma.sql`p."image_url" IS NOT NULL`, Prisma.sql`p."image_url" <> ''`, Prisma.sql`COALESCE(p."user_front_image_url", '') = ''`];
  if (state === "unassigned") conditions.push(
    Prisma.sql`a."id" IS NULL`,
    Prisma.sql`COALESCE(p."image_source", 'pocamarket') <> 'lens_workbench'`,
    Prisma.sql`NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p."ebay_image_urls", ARRAY[]::TEXT[])) saved_url WHERE saved_url LIKE '%/products/%/lens-card-%')`,
  );
  else if (state !== "all") conditions.push(Prisma.sql`a."status" = ${state}`);
  if (p.q?.trim()) { const q = `%${p.q.trim()}%`; conditions.push(Prisma.sql`(p."sku" ILIKE ${q} OR p."product_name" ILIKE ${q})`); }
  if (p.group) conditions.push(Prisma.sql`p."brand" = ${p.group}`);
  if (p.album) conditions.push(Prisma.sql`p."category" = ${p.album}`);
  if (p.member) conditions.push(Prisma.sql`p."option_name" = ${p.member}`);
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
  const order = p.sort === "newest" ? Prisma.sql`p."updated_at" DESC` : p.sort === "name" ? Prisma.sql`p."product_name" ASC` : Prisma.sql`p."sku" ASC`;
  const offset = (page - 1) * pageSize;
  const [workerRows, statusRows, products, totalRows, facets] = await Promise.all([
    prisma.user.findMany({ where: { role: "WORKER" }, select: { id: true, loginId: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.$queryRaw<Array<{ workerId: string; status: string; count: bigint }>>`SELECT "worker_id" AS "workerId", "status", COUNT(*) AS "count" FROM "image_work_assignments" GROUP BY "worker_id", "status"`,
    prisma.$queryRaw<ProductRow[]>`
      SELECT p."id",p."sku",p."product_name" AS "productName",p."option_name" AS "optionName",p."brand",p."category",p."image_url" AS "imageUrl",a."status" AS "assignmentStatus",a."worker_id" AS "workerId",COALESCE(u."name",u."login_id") AS "workerName"
      FROM "products" p LEFT JOIN "image_work_assignments" a ON a."product_id"=p."id" LEFT JOIN "users" u ON u."id"=a."worker_id"
      ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS "count" FROM "products" p LEFT JOIN "image_work_assignments" a ON a."product_id"=p."id" ${where}`,
    prisma.$queryRaw<Array<{ groups: string[]; albums: string[]; members: string[] }>>`
      SELECT ARRAY(SELECT DISTINCT "brand" FROM "products" WHERE COALESCE("brand",'')<>'' ORDER BY "brand") AS "groups", ARRAY(SELECT DISTINCT "category" FROM "products" WHERE COALESCE("category",'')<>'' ORDER BY "category") AS "albums", ARRAY(SELECT DISTINCT "option_name" FROM "products" WHERE COALESCE("option_name",'')<>'' ORDER BY "option_name") AS "members"`,
  ]);
  const getCount = (id: string, status: string) => Number(statusRows.find((r) => r.workerId === id && r.status === status)?.count ?? 0);
  const workers = workerRows.map((w) => ({ ...w, assigned: getCount(w.id,"assigned") + getCount(w.id,"in_progress"), submitted: getCount(w.id,"submitted"), approved: getCount(w.id,"approved"), rejected: getCount(w.id,"rejected") }));
  const total = Number(totalRows[0]?.count ?? 0); const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId}/><main className="mx-auto max-w-7xl px-4 py-6 sm:px-6"><div className="mb-5 flex items-end justify-between"><div><h1 className="text-2xl font-semibold">이미지 작업자 관리</h1><p className="mt-1 text-sm text-zinc-500">검색·필터 후 페이지당 최대 1,000개까지 선택해 배정하거나 재배정할 수 있습니다.</p></div><Link href="/image-workers/reviews" className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white">검수 대기 이미지</Link></div><ImageWorkerAdmin workers={workers} products={products} facets={facets[0] ?? {groups:[],albums:[],members:[]}} pagination={{page,pageSize,total,totalPages}} filters={{q:p.q??"",group:p.group??"",album:p.album??"",member:p.member??"",state,sort:p.sort??"sku"}}/></main></div>;
}
