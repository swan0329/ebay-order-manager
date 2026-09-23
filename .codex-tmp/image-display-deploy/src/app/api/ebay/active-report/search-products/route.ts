import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { ensureFeaturedMembersColumn } from "@/lib/product-export-image-extras";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// 연결 화면 전용 상품 검색. 일반 상품 검색과 달리 featured_members(유닛 카드의
// 실제 멤버)까지 본다. 유닛 카드는 option_name이 "unit"이라 멤버 이름으로는
// 일반 검색에 걸리지 않아 아예 찾을 수 없었다.
const schema = z.object({
  q: z.string().trim().min(1, "찾을 값을 입력해 주세요.").max(120),
});

type Row = {
  id: string;
  sku: string;
  productName: string;
  brand: string | null;
  optionName: string | null;
  category: string | null;
  imageUrl: string | null;
  featuredMembers: string | null;
  ebayItemId: string | null;
};

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const { q } = schema.parse(await request.json());
    await ensureFeaturedMembersColumn();

    const like = `%${q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        "id",
        "sku",
        "product_name" AS "productName",
        "brand",
        "option_name" AS "optionName",
        "category",
        COALESCE(NULLIF("user_front_image_url", ''), "image_url") AS "imageUrl",
        "featured_members" AS "featuredMembers",
        "ebay_item_id" AS "ebayItemId"
      FROM "products"
      WHERE "status" <> 'inactive'
        AND (
          "sku" ILIKE ${like}
          OR COALESCE("product_name", '') ILIKE ${like}
          OR COALESCE("brand", '') ILIKE ${like}
          OR COALESCE("category", '') ILIKE ${like}
          OR COALESCE("option_name", '') ILIKE ${like}
          OR COALESCE("memo", '') ILIKE ${like}
          OR COALESCE("featured_members", '') ILIKE ${like}
        )
      ORDER BY
        -- 연결 가능한 상품(상품번호가 아직 없는 것)을 먼저 보여준다.
        (COALESCE("ebay_item_id", '') <> '') ASC,
        "sku" ASC
      LIMIT 20
    `;

    return Response.json({
      products: rows.map((row) => ({
        productId: row.id,
        sku: row.sku,
        productName: row.productName,
        brand: row.brand,
        // 유닛 카드는 지정된 멤버를 보여줘야 어떤 카드인지 알아볼 수 있다.
        optionName: row.featuredMembers?.trim() || row.optionName,
        category: row.category,
        imageUrl: row.imageUrl,
        score: 0,
        alreadyLinkedItemId: row.ebayItemId,
        memberMismatch: false,
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("찾을 값을 확인해 주세요.", 422, error.flatten());
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return jsonError("상품을 찾지 못했습니다.", 500);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
