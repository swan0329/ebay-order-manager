import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const latestReport = vi.hoisted(() => vi.fn());
const findStates = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { ebayReportImport: { findFirst: latestReport }, variationListingState: { findMany: findStates } } }));

const { getActiveVariationProductListings } = await import("@/lib/variation-selling-state");

describe("active variation selling state", () => {
  beforeEach(() => { vi.clearAllMocks(); findStates.mockResolvedValue([]); });

  it("does not trust stale saved parent ids without a complete active report", async () => {
    latestReport.mockResolvedValue(null);
    expect(await getActiveVariationProductListings("user")).toEqual(new Map());
    expect(findStates).not.toHaveBeenCalled();
  });

  it("loads only parent item ids present in the latest active report", async () => {
    latestReport.mockResolvedValue({ listings: [{ itemId: "ACTIVE-PARENT" }] });
    findStates.mockResolvedValue([{ ebayItemId: "ACTIVE-PARENT", title: "Bundle", includedProductIds: ["option"] }]);
    const result = await getActiveVariationProductListings("user");
    expect(findStates).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ebayItemId: { in: ["ACTIVE-PARENT"] } }) }));
    expect(result.get("option")).toEqual({ itemId: "ACTIVE-PARENT", title: "Bundle" });
  });
});
