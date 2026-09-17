vi.mock("@/lib/procurement-maintenance", () => ({ ensureProcurementRefreshQueue: vi.fn(async () => null) }));
import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ after: vi.fn(), scheduled: vi.fn(), process: vi.fn(), find: vi.fn() }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/lib/pocamarket-sync", () => ({ ensureScheduledPocamarketSync: m.scheduled, processPocamarketSyncBatch: m.process }));
vi.mock("@/lib/prisma", () => ({ prisma: { pocamarketSyncBatch: { findFirst: m.find } } }));
import { GET } from "@/app/api/cron/pocamarket-sync/route";
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("resumes an existing batch without creating an unscheduled all-group batch or recursing", async () => {
  vi.stubEnv("CRON_SECRET", "secret");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  m.find.mockResolvedValue({ id: "bts-only" });
  m.process.mockResolvedValue({ processed: 4, shouldContinue: true });
  const response = await GET(new Request("https://example.com/api/cron/pocamarket-sync?resumeOnly=1", { headers: { authorization: "Bearer secret" } }));
  expect(response.status).toBe(200);
  expect(m.scheduled).not.toHaveBeenCalled();
  await m.after.mock.calls[0][0]();
  expect(m.process).toHaveBeenCalledWith("bts-only", 100, { startBudgetMs: 240_000 });
  expect(fetch).not.toHaveBeenCalled();
});
it("does not process a batch for an unauthenticated scheduler request", async () => {
  vi.stubEnv("CRON_SECRET", "secret");
  expect((await GET(new Request("https://example.com/api/cron/pocamarket-sync?resumeOnly=1"))).status).toBe(401);
  expect(m.find).not.toHaveBeenCalled();
});
