import { TopNav } from "@/components/TopNav";
import { UnitMembersClient } from "@/components/UnitMembersClient";
import { getOperationalProductIds } from "@/lib/product-operations";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UnitMembersPage() {
  const user = await requireUser();
  const ids = await getOperationalProductIds("unit_no_members", user.id);
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          sku: true,
          productName: true,
          brand: true,
          category: true,
          imageUrl: true,
        },
        orderBy: { sku: "asc" },
      })
    : [];

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1100px] px-4 py-6">
        <h1 className="text-2xl font-semibold">유닛 멤버 지정</h1>
        <p className="mb-5 mt-1 text-sm text-zinc-500">
          판매가능 유닛 카드 중 포함 멤버가 아직 지정되지 않은 상품입니다. 멤버를 선택해
          저장하면 목록에서 사라지고, eBay 리스팅에 실제 멤버로 반영됩니다. (현재{" "}
          {products.length.toLocaleString()}개)
        </p>
        <UnitMembersClient items={products} />
      </main>
    </div>
  );
}
