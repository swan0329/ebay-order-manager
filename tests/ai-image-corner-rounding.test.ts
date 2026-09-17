import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw },
}));
vi.mock("@/lib/r2", () => ({ uploadBufferToR2: mocks.upload }));
vi.mock("@/lib/dewatermark-api", () => ({
  getDewatermarkCreditBalance: vi.fn(),
  removeWatermarkWithDewatermark: vi.fn(),
}));

import { repairAiPreviewCorners } from "@/lib/ai-image-work";

const MASK = Buffer.from(
  `<svg width="540" height="860"><rect width="540" height="860" rx="25" fill="white"/></svg>`,
);

async function grayCard() {
  return sharp({
    create: { width: 540, height: 860, channels: 3, background: "#808080" },
  })
    .jpeg()
    .toBuffer();
}

// 한 파이프라인에서 라운드와 흰 배경을 함께 처리하던 예전 방식. 모서리가 검게 남는다.
async function legacyRoundedCard(source: Buffer) {
  return sharp(source)
    .rotate()
    .resize(540, 860, { fit: "fill" })
    .composite([{ input: MASK, blend: "dest-in" }])
    .flatten({ background: "white" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

async function corners(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sum = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels;
    return data[offset] + data[offset + 1] + data[offset + 2];
  };
  return [
    sum(0, 0),
    sum(info.width - 1, 0),
    sum(0, info.height - 1),
    sum(info.width - 1, info.height - 1),
  ];
}

// JPEG은 검정과 흰색이 맞닿은 경계에서 몇 단계 번지므로 정확한 값 대신 범위로 본다.
function expectWhiteCorners(values: number[]) {
  expect(values.every((value) => value >= 730)).toBe(true);
}

async function centerPixel(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (430 * info.width + 270) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function mockDownload(buffer: Buffer) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ),
    })),
  );
}

beforeEach(() => {
  mocks.queryRaw.mockReset();
  mocks.executeRaw.mockReset();
  mocks.upload.mockReset();
  mocks.executeRaw.mockResolvedValue(1);
  mocks.upload.mockResolvedValue({ url: "https://r2.test/fixed.jpg" });
});

describe("AI 검수 이미지 모서리", () => {
  it("예전 파이프라인은 모서리를 검게 남긴다", async () => {
    const legacy = await legacyRoundedCard(await grayCard());
    expect(await corners(legacy).then((v) => v.every((x) => x < 60))).toBe(true);
  });

  it("검은 모서리를 흰색으로 보정하고 카드 그림은 그대로 둔다", async () => {
    const legacy = await legacyRoundedCard(await grayCard());
    mocks.queryRaw.mockResolvedValueOnce([
      { id: "job-1", sku: "505131", previewUrl: "https://r2.test/black.jpg" },
    ]);
    mockDownload(legacy);
    const result = await repairAiPreviewCorners({ limit: 8, offset: 0 });
    expect(result).toMatchObject({ scanned: 1, repaired: 1, failed: 0 });
    const uploaded = mocks.upload.mock.calls[0][0].buffer as Buffer;
    expectWhiteCorners(await corners(uploaded));
    // 라운드 마스크만 다시 씌우므로 카드 안쪽 색은 유지된다.
    const [r, g, b] = await centerPixel(uploaded);
    expect([r, g, b].every((value) => Math.abs(value - 128) <= 3)).toBe(true);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("이미 흰 모서리인 이미지는 다시 올리지 않는다", async () => {
    const white = await sharp(await grayCard())
      .resize(540, 860, { fit: "fill" })
      .ensureAlpha()
      .composite([{ input: MASK, blend: "dest-in" }])
      .png()
      .toBuffer()
      .then((rounded) =>
        sharp(rounded).flatten({ background: "white" }).jpeg().toBuffer(),
      );
    expectWhiteCorners(await corners(white));
    mocks.queryRaw.mockResolvedValueOnce([
      { id: "job-2", sku: "106628", previewUrl: "https://r2.test/white.jpg" },
    ]);
    mockDownload(white);
    const result = await repairAiPreviewCorners({ limit: 8, offset: 0 });
    expect(result).toMatchObject({ scanned: 1, repaired: 0, skipped: 1 });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });
});

describe("이미 올린 통과 결과 다시 업로드", () => {
  it("오류 대신 확정된 이미지를 그대로 돌려준다", async () => {
    const { approveAiJob } = await import("@/lib/ai-image-work");
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "job-1" }]) // 정책 검사
      .mockResolvedValueOnce([]) // pass_ready 아님
      .mockResolvedValueOnce([
        { imageUrl: "https://r2.test/products/505133/505133.jpg" },
      ]); // 이미 approved
    await expect(approveAiJob("job-1", "admin-1")).resolves.toBe(
      "https://r2.test/products/505133/505133.jpg",
    );
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("승인 기록도 없으면 그대로 실패시킨다", async () => {
    const { approveAiJob } = await import("@/lib/ai-image-work");
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(approveAiJob("job-1", "admin-1")).rejects.toThrow(
      "검수할 AI 결과가 없습니다",
    );
  });
});
