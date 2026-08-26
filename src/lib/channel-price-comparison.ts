export type ChannelPriceListing = {
  productId: string;
  channel: string;
  externalId: string;
  price: { toString(): string } | number | null;
  status: string | null;
  updatedAt: Date;
  product: {
    sku: string;
    productName: string;
    ebayCurrency: string | null;
  };
};

const ACTIVE_STATUSES = new Set(["active", "published", "listed"]);

export function isActiveChannelListing(status: string | null) {
  return status != null && ACTIVE_STATUSES.has(status.trim().toLowerCase());
}

export function buildChannelPriceComparison(listings: ChannelPriceListing[]) {
  const byProduct = new Map<string, ChannelPriceListing[]>();
  for (const listing of listings) {
    byProduct.set(listing.productId, [...(byProduct.get(listing.productId) ?? []), listing]);
  }

  let inactiveExcluded = 0;
  const rows = [...byProduct.entries()].flatMap(([productId, productListings]) => {
    const ebay = productListings.find((listing) => listing.channel === "EBAY");
    const shopify = productListings.find((listing) => listing.channel === "SHOPIFY");
    if (!ebay || !shopify) return [];
    if (!isActiveChannelListing(ebay.status) || !isActiveChannelListing(shopify.status)) {
      inactiveExcluded += 1;
      return [];
    }

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

  return {
    summary: {
      activeOnBoth: rows.length,
      equal: rows.filter((row) => row.equal).length,
      different: rows.filter((row) => !row.equal && row.difference !== null).length,
      missingPrice: rows.filter((row) => row.difference === null).length,
      inactiveExcluded,
    },
    rows,
  };
}
