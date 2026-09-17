import { expect, it } from "vitest";
import { pendingEbayFeedProgress } from "@/lib/ebay-feed-progress";
it.each(["COMPLETED", "COMPLETED_WITH_ERROR"])("does not report %s before remaining Inventory writes finish", status => {
  expect(pendingEbayFeedProgress(status, { successCount: 8, failureCount: 0 })).toEqual({ status: "IN_PROCESS", successCount: 8, failureCount: 0 });
});
it("preserves confirmed progress while the external task is still processing", () => {
  expect(pendingEbayFeedProgress("IN_PROGRESS", { successCount: 8, failureCount: 2 })).toEqual({ status: "IN_PROGRESS", successCount: 8, failureCount: 2 });
});
