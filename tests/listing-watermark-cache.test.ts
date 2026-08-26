import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existing: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/r2", () => ({
  getExistingR2PublicUrl: mocks.existing,
  uploadBufferToR2: mocks.upload,
}));
vi.mock("@/lib/variation-thumbnail-settings", () => ({ getListingWatermarkSettings: vi.fn() }));

import { createWatermarkedListingImage, type ResolvedWatermark } from "@/lib/listing-watermark";

const base: ResolvedWatermark = {
  logo: null,
  logoKey: null,
  logoUrl: null,
  watermarkText: null,
  watermarkOpacity: 0.2,
  watermarkLogoSize: 0.2,
  watermarkGap: 0.02,
  applyToIndividualCards: false,
  signature: "settings-signature",
};

describe("판매 이미지 캐시", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.existing.mockReset();
    mocks.upload.mockReset();
  });

  it("개별 워터마크를 사용하지 않으면 원본을 내려받지 않는다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(createWatermarkedListingImage("https://cdn.example/card.jpg", base)).resolves.toEqual({
      url: "https://cdn.example/card.jpg", signature: "settings-signature", applied: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.existing).not.toHaveBeenCalled();
  });

  it("같은 원본과 설정으로 만든 R2 이미지가 있으면 렌더링과 업로드를 생략한다", async () => {
    mocks.existing.mockResolvedValue("https://r2.example/products/listing-watermarks/cached.jpg");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(createWatermarkedListingImage("https://cdn.example/card.jpg", {
      ...base, applyToIndividualCards: true, watermarkText: "STORE",
    })).resolves.toEqual({
      url: "https://r2.example/products/listing-watermarks/cached.jpg", signature: "settings-signature", applied: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
