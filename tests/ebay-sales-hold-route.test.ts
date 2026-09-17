import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), productHold: vi.fn(), unlinkedHold: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireApiUser: mocks.user, UnauthorizedError: class UnauthorizedError extends Error {} }));
vi.mock("@/lib/ebay-sales-hold", () => ({ ensureEbayProductSalesHold: mocks.productHold, ensureEbayUnlinkedSalesHold: mocks.unlinkedHold }));
import { POST } from "@/app/api/ebay/sales-hold/route";
import { UnauthorizedError } from "@/lib/session";
const request = (body: unknown) => new Request("https://example.com/api/ebay/sales-hold", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "admin" }); mocks.unlinkedHold.mockResolvedValue({ verified: true, available: 0 }); });
it("requires admin authentication before performing a hold", async () => {
  mocks.user.mockRejectedValue(new UnauthorizedError());
  expect((await POST(request({ unlinkedItemIds: ["123"], confirmed: true }))).status).toBe(401);
  expect(mocks.unlinkedHold).not.toHaveBeenCalled();
});
it("requires explicit confirmation and rejects mixed or oversized scopes", async () => {
  for (const body of [{ unlinkedItemIds: ["123"] }, { unlinkedItemIds: ["123"], confirmed: false }, { productIds: ["p"], unlinkedItemIds: ["123"], confirmed: true }, { unlinkedItemIds: ["1", "2", "3", "4"], confirmed: true }]) {
    expect((await POST(request(body))).status).toBe(422);
  }
  expect(mocks.unlinkedHold).not.toHaveBeenCalled();
  expect(mocks.productHold).not.toHaveBeenCalled();
});
it("deduplicates the administrator's exact item IDs without selecting other listings", async () => {
  expect((await POST(request({ unlinkedItemIds: ["123", "123"], confirmed: true }))).status).toBe(200);
  expect(mocks.unlinkedHold).toHaveBeenCalledExactlyOnceWith("admin", "123");
  expect(mocks.productHold).not.toHaveBeenCalled();
});
