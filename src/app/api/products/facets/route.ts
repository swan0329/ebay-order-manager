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

type ProductFacetKey = keyof ProductFacetOptions;
type FacetRow = {
  facet: ProductFacetKey;
  value: string | null;
};

const cacheTtlMs = 5 * 60_000;
const facetLimit = 300;
let facetsCache: { expiresAt: number; value: ProductFacetOptions } | null = null;

async function loadFacets(): Promise<ProductFacetOptions> {
  const rows = await prisma.$queryRaw<FacetRow[]>`
    SELECT 'groups' AS facet, value
    FROM (
      SELECT DISTINCT "brand" AS value
      FROM "products"
      WHERE "brand" IS NOT NULL
        AND "brand" <> ''
        AND "status" <> 'inactive'
      ORDER BY "brand" ASC
      LIMIT ${facetLimit}
    ) groups
    UNION ALL
    SELECT 'members' AS facet, value
    FROM (
      SELECT DISTINCT "option_name" AS value
      FROM "products"
      WHERE "option_name" IS NOT NULL
        AND "option_name" <> ''
        AND "status" <> 'inactive'
      ORDER BY "option_name" ASC
      LIMIT ${facetLimit}
    ) members
    UNION ALL
    SELECT 'albums' AS facet, value
    FROM (
      SELECT DISTINCT "category" AS value
      FROM "products"
      WHERE "category" IS NOT NULL
        AND "category" <> ''
        AND "status" <> 'inactive'
      ORDER BY "category" ASC
      LIMIT ${facetLimit}
    ) albums
    UNION ALL
    SELECT 'versions' AS facet, value
    FROM (
      SELECT DISTINCT "product_name" AS value
      FROM "products"
      WHERE "product_name" IS NOT NULL
        AND "product_name" <> ''
        AND "status" <> 'inactive'
      ORDER BY "product_name" ASC
      LIMIT ${facetLimit}
    ) versions
  `;
  const facets: ProductFacetOptions = {
    groups: [],
    members: [],
    albums: [],
    versions: [],
  };

  for (const row of rows) {
    const value = row.value?.trim();

    if (value && row.facet in facets) {
      facets[row.facet].push(value);
    }
  }

  return facets;
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
