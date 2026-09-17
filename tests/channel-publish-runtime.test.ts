import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { channelPublishLeaseMs } from "../src/lib/channel-publish-runtime";

describe("채널 등록 worker 실행 한도", () => {
  it.each([
    "products/publish", "channel-publish-jobs", "cron/channel-publish", "shopify/operations",
    "listing-upload/drafts/upload", "listing-upload/drafts/retry-failed",
  ])("%s의 after 작업도 5분 실행하며 임대가 먼저 만료되지 않는다", (route) => {
    const source = readFileSync(`src/app/api/${route}/route.ts`, "utf8");
    expect(source).toMatch(/export const maxDuration = 300;/);
    expect(channelPublishLeaseMs).toBeGreaterThan(300_000);
  });
  it("브라우저 없이도 승인된 대기 작업을 매분 이어간다", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config.crons).toContainEqual({ path: "/api/cron/channel-publish", schedule: "* * * * *" });
  });
});
