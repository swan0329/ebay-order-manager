import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ evidence: vi.fn(), find: vi.fn(), claim: vi.fn(), create: vi.fn(), update: vi.fn(), fetch: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findUniqueOrThrow: m.find, updateMany: m.claim },
  pocamarketSyncBatch: { create: m.create, update: m.update }, pocamarketSyncItem: { findMany: m.evidence } } }));
vi.mock("@/lib/pocamarket-sync", () => ({ recordPocamarketObservation: m.record }));
vi.mock("@/lib/pocamarket-api-collector", () => ({ fetchPocamarketProductState: m.fetch, loadPocamarketApiConfig: () => ({}) }));
import { refreshProcurementProduct } from "@/lib/procurement-refresh";
const stale = { id: "product", pocamarketId: "182895", pocamarketLastAttemptAt: new Date(0), pocamarketSyncedAt: new Date(0) };
beforeEach(() => {
  vi.clearAllMocks(); m.find.mockResolvedValue(stale); m.claim.mockResolvedValue({ count: 1 });
  m.evidence.mockResolvedValue([]);
  m.create.mockResolvedValue({ id: "batch", items: [{ id: "item" }] });
});
it("records sold-out through the observation history without creating owned inventory", async () => {
  m.fetch.mockResolvedValue({ isSoldOut: true, price: 0, availableCount: 0 });
  await refreshProcurementProduct(stale as never, "admin");
  expect(m.record).toHaveBeenCalledWith("item", expect.stringMatching(/^WORKER:/), expect.objectContaining({ availability: "SOLD_OUT", observedAvailableCount: 0 }));
  expect(m.claim.mock.calls[0][0].data).toEqual({ pocamarketLastAttemptAt: expect.any(Date) });
  expect(m.create.mock.calls[0][0].data.deviceSerial).toMatch(/^WORKER:/);
});
it("records a failed check as failure, never as a zero-price successful observation", async () => {
  m.fetch.mockRejectedValue(new Error("508"));
  await refreshProcurementProduct(stale as never, "admin");
  expect(m.record.mock.calls[0][2]).toEqual(expect.objectContaining({ errorCode: "PREFLIGHT_FAILED" }));
  expect(m.record.mock.calls[0][2]).not.toHaveProperty("availability");
  expect(m.update.mock.calls[0][0].data.status).toBe("FAILED");
});
it("does not duplicate another worker's fresh claim", async () => {
  m.claim.mockResolvedValue({ count: 0 });
  await refreshProcurementProduct(stale as never, "admin");
  expect(m.fetch).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});
it("does not refetch an already verified product", async () => {
  const now = new Date();
  m.evidence.mockResolvedValue([{ productId: "product", productNumber: "182895", observedAt: now, appliedAt: now, availability: "AVAILABLE", observedPrice: 25000, observedAvailableCount: 1 }]);
  await refreshProcurementProduct({ ...stale, salePrice: 25000, pocamarketAvailableCount: 1, pocamarketSyncedAt: now, pocamarketLastAttemptAt: null } as never, "admin");
  expect(m.find).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
});
it("forces a new supplier check when a fresh timestamp hides an overwritten cost", async () => {
  const fresh = { ...stale, salePrice: 1000, pocamarketSyncedAt: new Date(), pocamarketLastAttemptAt: null };
  m.find.mockResolvedValue(fresh);
  m.fetch.mockResolvedValue({ isSoldOut: false, price: 25000, availableCount: 1 });
  await refreshProcurementProduct(fresh as never, "admin");
  expect(m.fetch).toHaveBeenCalled();
  expect(m.record.mock.calls[0][2]).toMatchObject({ observedPrice: 25000 });
});
