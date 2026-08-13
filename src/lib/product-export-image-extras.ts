import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import type { ProductImageExtras } from "@/lib/ebay-listing-fields";

type ProductImageExtraRow = ProductImageExtras & {
  id: string;
};

// "featured_members" is a raw column (not in the Prisma model) added at runtime,
// so guarantee it exists before selecting it here.
let featuredMembersColumnPromise: Promise<void> | null = null;
function ensureFeaturedMembersColumn() {
  featuredMembersColumnPromise ??= prisma
    .$executeRaw`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "featured_members" TEXT`
    .then(() => undefined)
    .catch((error) => {
      featuredMembersColumnPromise = null;
      throw error;
    });
  return featuredMembersColumnPromise;
}

export async function productImageExtrasById(ids: string[]) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (!uniqueIds.length) {
    return new Map<string, ProductImageExtras>();
  }

  await ensureFeaturedMembersColumn();

  const rows = await prisma.$queryRaw<ProductImageExtraRow[]>`
    SELECT
      "id",
      "source_image_url" AS "sourceImageUrl",
      "user_front_image_url" AS "userFrontImageUrl",
      "user_back_image_url" AS "userBackImageUrl",
      "featured_members" AS "featuredMembers"
    FROM "products"
    WHERE "id" IN (${Prisma.join(uniqueIds)})
  `;

  return new Map(rows.map((row) => [row.id, row]));
}

export { ensureFeaturedMembersColumn };

export function withProductImageExtras<T extends { id: string }>(
  products: T[],
  extrasById: Map<string, ProductImageExtras>,
) {
  return products.map((product) => ({
    ...product,
    ...(extrasById.get(product.id) ?? {}),
  }));
}
