import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  candidates: vi.fn(),
  createJob: vi.fn(),
  drain: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireApiUser: mocks.user,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/channel-registration-candidates", () => ({
  getRegistrationCandidates: mocks.candidates,
}));
vi.mock("@/lib/channel-publish-jobs", () => ({
  createAutomaticProductPublishJob: mocks.createJob,
  drainChannelPublishJob: mocks.drain,
}));
vi.mock("next/server", () => ({ after: (run: () => void) => run() }));

import { GET, POST } from "@/app/api/products/publish/route";

const request = (body: unknown) =>
  new Request("https://example.com/api/products/publish", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "admin-1" });
  mocks.drain.mockResolvedValue(undefined);
  mocks.createJob.mockImplementation(async ({ productIds }: { productIds: string[] }) => ({
    id: "job-1",
    totalCount: productIds.length,
    reusedActiveJob: false,
  }));
});

describe("등록 가능한 전체 등록", () => {
  it("서버가 조건을 다시 확인해 대상 전체를 접수한다", async () => {
    mocks.candidates.mockResolvedValue({
      products: [{ id: "p1", sku: "1" }, { id: "p2", sku: "2" }],
      eligibleCount: 2,
      breakdown: { readyCount: 5, linkedExcludedCount: 1, priceMissingCount: 2 },
    });
    const response = await POST(request({ channel: "EBAY", allEligible: true, limit: 500, confirmed: true }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      selectedProductCount: 2,
      remainingProductCount: 0,
    });
    expect(mocks.candidates).toHaveBeenCalledWith("EBAY", 500);
    expect(mocks.createJob.mock.calls[0][0].productIds).toEqual(["p1", "p2"]);
  });

  it("상한을 넘으면 남은 수를 알려 준다", async () => {
    mocks.candidates.mockResolvedValue({
      products: Array.from({ length: 500 }, (_, index) => ({ id: `p${index}`, sku: String(index) })),
      eligibleCount: 620,
      breakdown: { readyCount: 700, linkedExcludedCount: 10, priceMissingCount: 70 },
    });
    const body = await (await POST(request({ channel: "SHOPIFY", allEligible: true, limit: 500, confirmed: true }))).json();
    expect(body).toMatchObject({ selectedProductCount: 500, remainingProductCount: 120 });
  });

  it("조건을 갖춘 상품이 없으면 등록을 만들지 않는다", async () => {
    mocks.candidates.mockResolvedValue({ products: [], eligibleCount: 0, breakdown: { readyCount: 0, linkedExcludedCount: 0, priceMissingCount: 0 } });
    expect((await POST(request({ channel: "EBAY", allEligible: true, limit: 500, confirmed: true }))).status).toBe(422);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it("확인하지 않은 요청과 선택·전체 동시 지정은 거부한다", async () => {
    expect((await POST(request({ channel: "EBAY", allEligible: true, limit: 500 }))).status).toBe(422);
    expect((await POST(request({ channel: "EBAY", allEligible: true, productIds: ["p1"], confirmed: true }))).status).toBe(422);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it("등록 가능 수는 조회로 미리 확인할 수 있다", async () => {
    mocks.candidates.mockResolvedValue({ products: [], eligibleCount: 477, breakdown: { readyCount: 626, linkedExcludedCount: 52, priceMissingCount: 97 } });
    const response = await GET(new Request("https://example.com/api/products/publish?channel=EBAY&limit=500"));
    expect(await response.json()).toMatchObject({ eligibleCount: 477 });
    expect(mocks.candidates).toHaveBeenCalledWith("EBAY", 500);
  });
});
