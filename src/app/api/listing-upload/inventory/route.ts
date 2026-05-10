import { productWhere } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    const listing = url.searchParams.get("listing");
    const inStock = url.searchParams.get("inStock") === "true";
    const where = productWhere({ q });

    if (inStock) {
      where.stockQuantity = { gt: 0 };
    }

    if (listing === "unlisted") {
      where.ebayItemId = null;
    } else if (listing === "listed") {
      where.ebayItemId = { not: null };
    }

    const products = await prisma.product.findMany({
      where,
      include: { listingLinks: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    return Response.json({ products });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
