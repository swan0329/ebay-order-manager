import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { listingWatermarkKeys } from "@/lib/ebay-watermarked-images";
import { defaultListingImageSettings } from "@/lib/variation-thumbnail-settings";

const base = { ...defaultListingImageSettings, logoUrl: "https://r2/logo.png" };
const keyOf = (patch: Partial<typeof base>) =>
  listingWatermarkKeys("https://r2/card.jpg", "logo-1", { ...base, ...patch }, true);

describe("등록 이미지 캐시 키", () => {
  it("묶음 썸네일 전용 설정만 바뀌면 같은 이미지를 다시 만들지 않는다", () => {
    const before = keyOf({});
    for (const patch of [
      { variationWatermarkOpacity: 0.5 },
      { variationWatermarkLogoSize: 300 },
      { variationWatermarkGap: 99 },
    ]) {
      expect(keyOf(patch).key).toBe(before.key);
    }
  });

  it("등록 이미지에 영향을 주는 설정은 모두 키를 바꾼다", () => {
    const before = keyOf({}).key;
    const patches: Array<Partial<typeof base>> = [
      { watermarkEnabled: false },
      { watermarkOpacity: 0.2 },
      { watermarkLogoSize: 80 },
      { watermarkGap: 40 },
      { imageExposure: 1.2 },
      { imageContrast: 1.2 },
      { imageSaturation: 1.2 },
      { imageRotation: 15 },
      { imageZoom: 20 },
      { imageFlipHorizontal: true },
      { backgroundEnabled: true },
      { backgroundUrl: "https://r2/bg.png" },
      { backgroundKey: "settings/bg.png" },
      { backgroundPadding: 100 },
      { backgroundColor: "#101010" },
      { paddingTop: 10 },
      { paddingRight: 10 },
      { paddingBottom: 10 },
      { paddingLeft: 10 },
      { shadowEnabled: true },
      { shadowOpacity: 0.5 },
      { shadowBlur: 40 },
      { shadowOffsetX: 30 },
      { shadowOffsetY: 30 },
    ];
    for (const patch of patches) {
      expect(keyOf(patch).key, JSON.stringify(patch)).not.toBe(before);
    }
  });

  it("원본 주소·로고·배경 적용 여부가 바뀌면 키도 바뀐다", () => {
    const before = keyOf({}).key;
    expect(listingWatermarkKeys("https://r2/other.jpg", "logo-1", base, true).key).not.toBe(before);
    expect(listingWatermarkKeys("https://r2/card.jpg", "logo-2", base, true).key).not.toBe(before);
    expect(listingWatermarkKeys("https://r2/card.jpg", "logo-1", base, false).key).not.toBe(before);
  });

  it("예전 방식 키도 함께 알려 주어 이미 만든 결과를 재사용한다", () => {
    const keys = keyOf({});
    expect(keys.legacyKey).toMatch(/^products\/channel-watermarked\/[0-9a-f]{64}\.jpg$/);
    expect(keys.legacyKey).not.toBe(keys.key);
    // 예전 키는 설정 전체 해시라 묶음 썸네일 설정만 바뀌어도 달라진다(= 그동안 전량 재생성된 이유).
    expect(keyOf({ variationWatermarkGap: 99 }).legacyKey).not.toBe(keys.legacyKey);
  });
});

const r2 = vi.hoisted(() => ({ get: vi.fn(), upload: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/r2", () => ({
  getObjectFromR2: r2.get,
  uploadBufferToR2: r2.upload,
  buildPublicR2Url: (key: string) => `https://r2.test/${key}`,
}));
vi.mock("@/lib/variation-thumbnail-settings", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getListingImageSettings: r2.settings,
}));

describe("이미 만들어 둔 등록 이미지 재사용", () => {
  it("예전 키로 저장된 결과가 있으면 다시 만들지도, 주소를 바꾸지도 않는다", async () => {
    const { ensureListingWatermarkedImages } = await import(
      "@/lib/ebay-watermarked-images"
    );
    const settings = { ...base };
    r2.settings.mockResolvedValue(settings);
    const keys = listingWatermarkKeys(
      "https://r2/card.jpg",
      settings.logoKey ?? settings.logoUrl ?? "missing",
      settings,
      false,
    );
    r2.get.mockImplementation(async (key: string) =>
      key === keys.legacyKey ? { buffer: new Uint8Array(), contentType: "image/jpeg" } : null,
    );
    const result = await ensureListingWatermarkedImages("user-1", [
      "https://r2/card.jpg",
    ]);
    expect(result).toEqual([`https://r2.test/${keys.legacyKey}`]);
    // 새로 렌더링하거나 올리지 않는다.
    expect(r2.upload).not.toHaveBeenCalled();
  });
});
