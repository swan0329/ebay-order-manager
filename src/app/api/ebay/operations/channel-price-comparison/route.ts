import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApiUser();

    const listings = await prisma.productListing.findMany({
      where: { channel: { in: ["EBAY", "SHOPIFY"] } },
      select: {
        productId: true,
        channel: true,
        externalId: true,
        price: true,
        status: true,
        updatedAt: true,
        product: {
          select: {
            sku: true,
            productName: true,
            ebayCurrency: true,
          },
        },
      },
      orderBy: [{ productId: "asc" }, { channel: "asc" }],
    });

    const byProduct = new Map<string, typeof listings>();
    for (const listing of listings) {
      byProduct.set(listing.productId, [...(byProduct.get(listing.productId) ?? []), listing]);
    }

    const rows = [...byProduct.entries()].flatMap(([productId, productListings]) => {
      const ebay = productListings.find((listing) => listing.channel === "EBAY");
      const shopify = productListings.find((listing) => listing.channel === "SHOPIFY");
      if (!ebay || !shopify) return [];

      const ebayPrice = ebay.price == null ? null : Number(ebay.price);
      const shopifyPrice = shopify.price == null ? null : Number(shopify.price);
      const difference = ebayPrice == null || shopifyPrice == null
        ? null
        : Number((shopifyPrice - ebayPrice).toFixed(2));

      return [{
        productId,
        sku: ebay.product.sku,
        productName: ebay.product.productName,
        currency: ebay.product.ebayCurrency ?? "USD",
        ebay: {
          externalId: ebay.externalId,
          price: ebayPrice,
          status: ebay.status,
          updatedAt: ebay.updatedAt,
        },
        shopify: {
          externalId: shopify.externalId,
          price: shopifyPrice,
          status: shopify.status,
          updatedAt: shopify.updatedAt,
        },
        difference,
        equal: difference === 0,
      }];
    }).sort((a, b) => {
      if (a.equal !== b.equal) return a.equal ? 1 : -1;
      return Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0);
    });

    return Response.json({
      checkedAt: new Date().toISOString(),
      summary: {
        commonProducts: rows.length,
        equal: rows.filter((row) => row.equal).length,
        different: rows.filter((row) => !row.equal && row.difference !== null).length,
        missingPrice: rows.filter((row) => row.difference === null).length,
      },
      rows,
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
