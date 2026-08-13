export type EbayReviseCsvInput = {
  itemId: string | number;
  sku: string;
  price: string | number;
  quantity: string | number;
};

// Existing listings are identified by Item number, so a price/quantity revise
// must not declare a new item-location country in the Action header. In
// particular, Country=US means "the item is located in the US", not "listed on
// ebay.com", and can trigger eBay Korea's overseas-warehouse policy block.
export function ebayReviseCsvRow(input: EbayReviseCsvInput) {
  return {
    Action: "Revise",
    "Item number": input.itemId,
    "Custom label (SKU)": input.sku,
    "Start price": input.price,
    "Available quantity": input.quantity,
  };
}
