import { Prisma } from "@/generated/prisma";
import { productDisplayImageUrl } from "@/lib/product-display-image";
import { TopNav } from "@/components/TopNav";
import { UnitMembersClient } from "@/components/UnitMembersClient";
import { getOperationalProductIds } from "@/lib/product-operations";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UnitMembersPage() {
  const user = await requireUser();
  const ids = await getOperationalProductIds("unit_no_members");
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          sku: true,
          productName: true,
          optionName: true,
          brand: true,
          category: true,
          imageUrl: true,
        },
        orderBy: { sku: "asc" },
      })
    : [];

  const images = ids.length ? await prisma.$queryRaw<Array<{ id: string; userImageRegistered: boolean; imageSource: string | null; sourceImageUrl: string | null; userFrontImageUrl: string | null }>>`
    SELECT id, COALESCE(user_front_image_url, '') <> '' AS "userImageRegistered",
      image_source AS "imageSource", source_image_url AS "sourceImageUrl", user_front_image_url AS "userFrontImageUrl"
    FROM products WHERE id IN (${Prisma.join(ids)})` : [];
  const imageById = new Map(images.map(image => [image.id, image]));
  const items = products.map(product => ({ ...product, searchImageUrl: imageById.get(product.id)?.userFrontImageUrl || product.imageUrl || imageById.get(product.id)?.sourceImageUrl, imageUrl: productDisplayImageUrl({
    ...product, userImageRegistered: false, imageSource: null, sourceImageUrl: null,
    ...imageById.get(product.id),
  }) }));

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <h1 className="text-2xl font-semibold">유닛 멤버 지정</h1>
        <p className="mb-5 mt-1 text-sm text-zinc-500">
          판매가능 유닛 카드 중 포함 멤버가 아직 지정되지 않은 상품입니다. 멤버를 선택해
          큰 사진으로 확인하고 저장하면 다음 카드로 이동합니다. 지정한 정보는 이후 판매채널 등록에 사용됩니다.
        </p>
        <UnitMembersClient items={items} />
      </main>
    </div>
  );
}
