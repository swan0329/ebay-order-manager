import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const tx = vi.hoisted(() => ({
 channelPublishJob: { findFirst: vi.fn(), update: vi.fn() },
 channelPublishItem: { findMany: vi.fn(), updateMany: vi.fn() },
 syncLog: { create: vi.fn() },
}));
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
import { retryEbayImageFailures } from "@/lib/channel-publish-jobs";
beforeEach(() => {
 vi.clearAllMocks(); transaction.mockImplementation(async callback => callback(tx));
 tx.channelPublishJob.findFirst.mockReset().mockResolvedValueOnce({ id: "job", userId: "admin" }).mockResolvedValue(null);
 tx.channelPublishItem.findMany.mockResolvedValue([{ id: "item", sku: "104510", error: "21919474", attempts: 1 }]);
 tx.channelPublishItem.updateMany.mockResolvedValue({ count: 1 });
});
it("requeues only failed items in the validated user's image job and preserves an audit", async () => {
 expect(await retryEbayImageFailures("admin", "job", ["104510"])).toEqual({ jobId: "job", retried: 1 });
 expect(tx.channelPublishJob.findFirst).toHaveBeenCalledWith({ where: { id: "job", userId: "admin", channel: "EBAY", mode: "IMAGES" } });
 expect(tx.channelPublishItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "job", status: "FAILED", sku: { in: ["104510"] } } }));
 expect(tx.syncLog.create).toHaveBeenCalledTimes(1);
 expect(transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 45000, timeout: 20000 });
});
it("a repeated retry with no failed items performs no counter or status mutation", async () => {
 tx.channelPublishItem.findMany.mockResolvedValue([]);
 expect(await retryEbayImageFailures("admin", "job")).toEqual({ jobId: "job", retried: 0 });
 expect(tx.channelPublishItem.updateMany).not.toHaveBeenCalled();
 expect(tx.channelPublishJob.update).not.toHaveBeenCalled();
});
it("does not retry another user's job or a different kind of operation", async () => {
 tx.channelPublishJob.findFirst.mockReset().mockResolvedValue(null);
 await expect(retryEbayImageFailures("other", "job")).rejects.toThrow();
 expect(tx.channelPublishItem.updateMany).not.toHaveBeenCalled();
});
