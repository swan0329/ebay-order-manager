import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  upload: vi.fn(),
  safeUrl: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw },
}));
vi.mock("@/lib/r2", () => ({ uploadBufferToR2: mocks.upload }));
vi.mock("@/lib/safe-remote-url", () => ({ assertSafeRemoteUrl: mocks.safeUrl }));
vi.mock("@/lib/dewatermark-api", () => ({
  getDewatermarkCreditBalance: vi.fn(),
  removeWatermarkWithDewatermark: vi.fn(),
}));

import { saveLensCandidateForAiJob } from "@/lib/ai-image-work";

const candidate = "https://images.example/card.jpg";

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.safeUrl.mockImplementation(async (raw: string) => new URL(raw));
  mocks.executeRaw.mockResolvedValue(1);
  mocks.upload.mockResolvedValue({ url: "https://r2.test/ai-image-reviews/505133/1-lens.jpg" });
  const photo = await sharp({
    create: { width: 300, height: 466, channels: 3, background: "#606060" },
  }).jpeg().toBuffer();
  mocks.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => photo.buffer.slice(photo.byteOffset, photo.byteOffset + photo.byteLength),
  });
});

describe("구글렌즈 후보 저장", () => {
  it("고른 이미지를 같은 규격으로 맞춰 검수 대기에 올린다", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([{ sku: "505133", status: "review", previewUrl: "https://r2.test/old.jpg", backupUrl: null }]);
    const result = await saveLensCandidateForAiJob("job-1", { imageUrl: candidate });
    expect(result).toMatchObject({ sku: "505133" });
    const uploaded = mocks.upload.mock.calls[0][0];
    expect(uploaded.key).toMatch(/^ai-image-reviews\/505133\/\d+-lens\.jpg$/);
    const meta = await sharp(uploaded.buffer as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([540, 860]);
    const sql = mocks.executeRaw.mock.calls[0][0].join(" ");
    expect(sql).toContain(`SET "status"='review'`);
    expect(sql).toContain(`"status"<>'approved'`);
  });

  it("내부망 주소는 내려받지 않는다", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([{ sku: "505133", status: "review", previewUrl: "https://r2.test/old.jpg", backupUrl: null }]);
    mocks.safeUrl.mockRejectedValue(new Error("내부 네트워크 주소는 사용할 수 없습니다."));
    await expect(saveLensCandidateForAiJob("job-1", { imageUrl: "http://10.0.0.5/a.jpg" })).rejects.toThrow(
      "내부 네트워크",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("이미 확정한 작업은 바꾸지 않는다", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([{ sku: "505133", status: "approved", previewUrl: null, backupUrl: null }]);
    await expect(saveLensCandidateForAiJob("job-1", { imageUrl: candidate })).rejects.toThrow("이미 상품 이미지로 확정");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("BTS 등 AI 대상이 아닌 작업은 거부한다", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    await expect(saveLensCandidateForAiJob("job-bts", { imageUrl: candidate })).rejects.toThrow("수동 이미지");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
