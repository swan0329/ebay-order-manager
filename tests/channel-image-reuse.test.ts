import { afterEach, expect, it, vi } from "vitest";
const existingMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/r2", () => ({
  getObjectFromR2: existingMock,
  buildPublicR2Url: (key: string) => `https://images.example/${key}`,
  uploadBufferToR2: vi.fn(),
}));
vi.mock("@/lib/variation-thumbnail-settings", () => ({ getListingImageSettings: async () => ({
  watermarkEnabled: true, logoUrl: "https://images.example/logo.png", backgroundUrl: "https://images.example/background.jpg",
}) }));
import { ensureListingWatermarkedImages } from "../src/lib/ebay-watermarked-images";
afterEach(() => vi.unstubAllGlobals());
it("완료된 이미지는 재시도할 때 원본·로고·배경을 다운로드하지 않는다", async () => {
  existingMock.mockResolvedValue({ buffer: new Uint8Array(), contentType: "image/jpeg" });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const urls = await ensureListingWatermarkedImages("admin", ["https://images.example/card.jpg"], { backgroundEligible: true });
  expect(urls[0]).toContain("products/channel-watermarked/");
  expect(fetchMock).not.toHaveBeenCalled();
});
