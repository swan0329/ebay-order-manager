export type ActiveReportIssue = {
  itemId: string;
  matchStatus: string;
};

export function summarizeActiveReportIssues<T extends ActiveReportIssue>(
  listings: T[],
  variationItemIds: Iterable<string>,
) {
  const variationIds = new Set(variationItemIds);
  const variationListings = listings.filter(
    (listing) =>
      listing.matchStatus === "UNMATCHED" && variationIds.has(listing.itemId),
  );
  const variationListingIds = new Set(variationListings.map((listing) => listing.itemId));
  const actionRequiredListings = listings.filter(
    (listing) => !variationListingIds.has(listing.itemId),
  );

  return {
    actionRequiredListings,
    variationMatchedCount: variationListings.length,
    unmatchedCount: actionRequiredListings.filter(
      (listing) => listing.matchStatus === "UNMATCHED",
    ).length,
    duplicateCount: actionRequiredListings.filter((listing) =>
      ["DUPLICATE", "CONFLICT"].includes(listing.matchStatus),
    ).length,
  };
}
