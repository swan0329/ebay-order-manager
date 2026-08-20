import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/orders", () => ({ syncOrdersForUser: vi.fn(), writeSyncLog: vi.fn() }));
vi.mock("@/lib/services/shopifyOrderSync", () => ({ syncShopifyOrders: vi.fn() }));
vi.mock("@/lib/services/ebayReturnSync", () => ({ syncReceivedEbayReturns: vi.fn() }));

import { incrementalSyncStart } from "@/lib/scheduled-order-sync";

describe("incrementalSyncStart", () => {
  it("starts five minutes before the last success to cover boundary updates", () => {
    const lastSuccess = new Date("2026-08-20T10:00:00.000Z");
    const now = new Date("2026-08-20T10:30:00.000Z");

    expect(incrementalSyncStart(lastSuccess, now).toISOString()).toBe(
      "2026-08-20T09:55:00.000Z",
    );
  });

  it("looks back 24 hours on the first scheduled run", () => {
    const now = new Date("2026-08-20T10:30:00.000Z");

    expect(incrementalSyncStart(null, now).toISOString()).toBe(
      "2026-08-19T10:30:00.000Z",
    );
  });
});
