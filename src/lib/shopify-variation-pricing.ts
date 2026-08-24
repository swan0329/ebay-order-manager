export type ShopifyPricedVariation = {
  sku: string;
  optionName: string;
  priceUsd: string;
  variantId?: string | null;
};

export function buildShopifyVariationVariants(items: ShopifyPricedVariation[]) {
  return items.map((item) => ({
    ...(item.variantId ? { id: Number(item.variantId) } : {}),
    sku: item.sku,
    option1: item.optionName,
    // 대표상품 가격을 복사하지 않는다. 각 카드에서 계산한 값을 그 SKU에 넣는다.
    price: item.priceUsd,
    inventory_management: "shopify",
  }));
}
