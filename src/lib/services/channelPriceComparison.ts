import "server-only";

import { buildChannelPriceComparison } from "@/lib/channel-price-comparison";
import { prisma } from "@/lib/prisma";

export async function getChannelPriceComparison() {
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

  return buildChannelPriceComparison(listings);
}
