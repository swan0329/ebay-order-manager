// eBay's feed acknowledgment precedes the separate Inventory reflection.
// Only applyCompletedJob may publish final success/failure counts.
export function pendingEbayFeedProgress(externalStatus: string, confirmed: { successCount: number; failureCount: number }) {
  return {
    status: externalStatus === "COMPLETED" || externalStatus === "COMPLETED_WITH_ERROR" ? "IN_PROCESS" : externalStatus,
    successCount: confirmed.successCount,
    failureCount: confirmed.failureCount,
  };
}
