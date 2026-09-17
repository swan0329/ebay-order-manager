import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  copy: vi.fn(),
  upload: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
    product: { update: mocks.update },
  },
}));
vi.mock("@/lib/r2", () => ({
  copyObjectInR2: mocks.copy,
  uploadBufferToR2: mocks.upload,
  r2KeyFromPublicUrl: (url: string) =>
    url.startsWith("https://r2.test/") ? url.slice("https://r2.test/".length) : null,
}));
vi.mock("@/lib/dewatermark-api", () => ({
  getDewatermarkCreditBalance: vi.fn(),
  removeWatermarkWithDewatermark: vi.fn(),
}));

import { approveAiJob } from "@/lib/ai-image-work";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.transaction.mockResolvedValue([]);
  mocks.copy.mockResolvedValue({
    key: "products/505133/505133.jpg",
    url: "https://r2.test/products/505133/505133.jpg",
  });
});

const passReady = () => {
  mocks.queryRaw.mockResolvedValueOnce([{ id: "job-1" }]).mockResolvedValueOnce([
    {
      productId: "p-1",
      previewUrl: "https://r2.test/ai-image-reviews/505133/1-dewatermark.jpg?v=9",
      sku: "505133",
      urls: [],
    },
  ]);
};

describe("통과 이미지 확정", () => {
  it("같은 버킷 안에서 복사하고 내려받지 않는다", async () => {
    passReady();
    await expect(approveAiJob("job-1", "admin-1")).resolves.toBe(
      "https://r2.test/products/505133/505133.jpg",
    );
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith({
      fromKey: "ai-image-reviews/505133/1-dewatermark.jpg",
      toKey: "products/505133/505133.jpg",
      contentType: "image/jpeg",
      cacheControl: "no-cache",
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    // 상품·이력 갱신은 한 트랜잭션으로 유지한다.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("R2 밖 주소면 예전처럼 내려받아 올린다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "job-1" }]).mockResolvedValueOnce([
      {
        productId: "p-1",
        previewUrl: "https://other.example/preview.jpg",
        sku: "505133",
        urls: [],
      },
    ]);
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    mocks.upload.mockResolvedValue({
      key: "products/505133/505133.jpg",
      url: "https://r2.test/products/505133/505133.jpg",
    });
    await approveAiJob("job-1", "admin-1");
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });
});
