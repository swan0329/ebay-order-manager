import { Prisma } from "@/generated/prisma";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

type ProductFacetOptions = {
  groups: string[];
  members: string[];
  albums: string[];
  versions: string[];
};

type FacetColumn = "brand" | "option_name" | "category" | "product_name";

const cacheTtlMs = 5 * 60_000;
const facetLimit = 300;
let facetsCache: { expiresAt: number; value: ProductFacetOptions } | null = null;

function columnSql(column: FacetColumn) {
  switch (column) {
    case "brand":
      return Prisma.sql`"brand"`;
    case "option_name":
      return Prisma.sql`"option_name"`;
    case "category":
      return Prisma.sql`"category"`;
    case "product_name":
      return Prisma.sql`"product_name"`;
  }
}

async function distinctFacet(column: FacetColumn) {
  const columnExpr = columnSql(column);
  const rows = await prisma.$queryRaw<Array<{ value: string | null }>>`
    SELECT DISTINCT ${columnExpr} AS value
    FROM "products"
    WHERE ${columnExpr} IS NOT NULL
      AND ${columnExpr} <> ''
      AND "status" <> 'inactive'
    ORDER BY ${columnExpr} ASC
    LIMIT ${facetLimit}
  `;

  return rows
    .map((row) => row.value?.trim())
    .filter((value): value is string => Boolean(value));
}

async function loadFacets(): Promise<ProductFacetOptions> {
  const [groups, members, albums, versions] = await Promise.all([
    distinctFacet("brand"),
    distinctFacet("option_name"),
    distinctFacet("category"),
    distinctFacet("product_name"),
  ]);

  return { groups, members, albums, versions };
}

export async function GET() {
  try {
    await requireApiUser();

    if (facetsCache && facetsCache.expiresAt > Date.now()) {
      return Response.json({ facets: facetsCache.value });
    }

    const value = await loadFacets();
    facetsCache = {
      expiresAt: Date.now() + cacheTtlMs,
      value,
    };

    return Response.json({ facets: value });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
