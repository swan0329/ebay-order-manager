// Shared with phone requests: source listings above this cap cannot back sales.
export function procurementPriceLimit(referencePrice: number) {
  return Math.round(referencePrice * 1.2);
}
