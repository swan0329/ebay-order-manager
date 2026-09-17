import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/r2", () => ({
  listObjectsFromR2: vi.fn(),
  r2KeyFromPublicUrl: (url: string) => url,
}));
import { r2UsageGroupOf } from "@/lib/r2-usage";

describe("R2 사용량 분류", () => {
  it("용도별로 사람이 읽을 수 있게 묶는다", () => {
    expect(r2UsageGroupOf("ai-image-reviews/505133/1789-dewatermark.jpg")).toBe(
      "ai-image-reviews",
    );
    expect(r2UsageGroupOf("image-work-reviews/10272/abc-1789.jpg")).toBe(
      "image-work-reviews",
    );
    expect(r2UsageGroupOf("products/channel-watermarked/abc.jpg")).toBe(
      "products/channel-watermarked",
    );
    expect(r2UsageGroupOf("products/channel-watermark-previews/abc.jpg")).toBe(
      "products/channel-watermark-previews",
    );
    expect(r2UsageGroupOf("products/variation-thumbnails/abc.jpg")).toBe(
      "products/variation-thumbnails",
    );
    // 상품 대표 이미지는 상품번호와 파일명이 같다.
    expect(r2UsageGroupOf("products/505133/505133.jpg")).toBe(
      "products/상품 대표 이미지",
    );
    expect(r2UsageGroupOf("products/505133/505133-1789-abc.jpg")).toBe(
      "products/상품별 과거 작업본",
    );
    expect(r2UsageGroupOf("settings/user-1/variation-watermark-1.png")).toBe(
      "settings",
    );
  });
});
