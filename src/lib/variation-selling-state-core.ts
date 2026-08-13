type VariationStateIds = {
  ebayItemId: string | null;
  includedProductIds: unknown;
};

export function collectActiveVariationProductIds(states: VariationStateIds[]) {
  return [...new Set(states.flatMap((state) =>
    state.ebayItemId && Array.isArray(state.includedProductIds)
      ? state.includedProductIds.filter((id): id is string => typeof id === "string")
      : [],
  ))];
}
