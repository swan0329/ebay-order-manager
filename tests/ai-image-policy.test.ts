import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: query } }));
import { aiJobAllowedSql, assertAiJobAllowed, excludeManualAiJobs } from "@/lib/ai-image-policy";
describe("BTS manual image policy", () => {
  beforeEach(() => query.mockReset());
  it("filters queued jobs by authoritative product group", () => {
    expect(aiJobAllowedSql.sql).toContain('"product_id" IN');
    expect(aiJobAllowedSql.sql).toContain("'BTS'");
    expect(aiJobAllowedSql.sql).toContain("'방탄소년단'");
  });
  it("blocks a disallowed job before processing or approval", async () => {
    query.mockResolvedValueOnce([]);
    await expect(assertAiJobAllowed("bts-job")).rejects.toThrow("수동 이미지");
    query.mockResolvedValueOnce([{ id: "skz-job" }]);
    await expect(assertAiJobAllowed("skz-job")).resolves.toBeUndefined();
  });
  it("quarantines unfinished jobs without deleting approved images or interrupting batch accounting", async () => {
    query.mockResolvedValueOnce([{sku:"10272",previousStatus:"queued"}]).mockResolvedValueOnce([]);
    expect(await excludeManualAiJobs()).toMatchObject({excluded:1,processing:[]});
    const sql = query.mock.calls[0][0].join(" ");
    expect(sql).toContain("'approved','manual_only','processing'");
    expect(sql).not.toContain('DELETE');
    expect(sql).not.toContain('"preview_url"=');
  });
});

