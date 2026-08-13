import "server-only";

import { prisma } from "@/lib/prisma";

export type VariationReadyImage = {
  id: string;
  listingImageUrl: string;
};

/** Only cards whose final listing image has actually been completed/approved. */
export async function getVariationListingReadyImages() {
  const rows = await prisma.$queryRaw<VariationReadyImage[]>`
    SELECT p."id"
      , CASE
          WHEN EXISTS (
            SELECT 1 FROM "ai_image_jobs" j
            WHERE j."product_id" = p."id" AND j."status" = 'approved'
          ) THEN p."image_url"
          ELSE p."user_front_image_url"
        END AS "listingImageUrl"
    FROM "products" p
    WHERE (
      p."stock_quantity" > 0
      OR COALESCE(p."pocamarket_available_count", 0) > 0
    )
    AND (
      COALESCE(p."user_front_image_url", '') <> ''
      OR EXISTS (
        SELECT 1 FROM "ai_image_jobs" j
        WHERE j."product_id" = p."id" AND j."status" = 'approved'
      )
    )
    AND COALESCE(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM "ai_image_jobs" j
          WHERE j."product_id" = p."id" AND j."status" = 'approved'
        ) THEN p."image_url"
        ELSE p."user_front_image_url"
      END,
      ''
    ) <> ''
  `;
  return rows;
}
