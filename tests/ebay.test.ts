import { describe, expect, it } from "vitest";
import { buildOrderFilter } from "../src/lib/ebay-filter";

describe("buildOrderFilter", () => {
  it("builds an open order fulfillment filter", () => {
    expect(buildOrderFilter({ fulfillmentStatus: "OPEN" })).toBe(
      "orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}",
    );
  });

  it("uses creation date when creation and modified dates are both present", () => {
    expect(
      buildOrderFilter({
        creationDateFrom: "2026-05-01T00:00:00.000Z",
        modifiedDateFrom: "2026-05-02T00:00:00.000Z",
        fulfillmentStatus: "FULFILLED",
      }),
    ).toBe(
      "creationdate:[2026-05-01T00:00:00.000Z..],orderfulfillmentstatus:{FULFILLED}",
    );
  });
});
