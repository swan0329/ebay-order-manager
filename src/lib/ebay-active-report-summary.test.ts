import { describe, expect, it } from "vitest";

import { summarizeActiveReportIssues } from "@/lib/ebay-active-report-summary";

describe("summarizeActiveReportIssues", () => {
  it("separates recognized variation parents from actionable unmatched listings", () => {
    const result = summarizeActiveReportIssues(
      [
        { itemId: "variation-1", matchStatus: "UNMATCHED" },
        { itemId: "single-1", matchStatus: "UNMATCHED" },
        { itemId: "single-2", matchStatus: "CONFLICT" },
      ],
      ["variation-1"],
    );

    expect(result.variationMatchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.actionRequiredListings.map(({ itemId }) => itemId)).toEqual([
      "single-1",
      "single-2",
    ]);
  });

  it("does not hide a variation item id when the report marks it as a conflict", () => {
    const result = summarizeActiveReportIssues(
      [{ itemId: "variation-1", matchStatus: "CONFLICT" }],
      ["variation-1"],
    );

    expect(result.variationMatchedCount).toBe(0);
    expect(result.duplicateCount).toBe(1);
    expect(result.actionRequiredListings).toHaveLength(1);
  });
});
