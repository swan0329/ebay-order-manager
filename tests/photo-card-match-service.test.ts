import { describe, expect, it } from "vitest";
import {
  normalizePhotoCardCandidateFilters,
  photoCardGroupSlug,
  photoCardListingImageUrls,
  photoCardProductCode,
  photoCardR2ObjectKeys,
  sourceImageUrlForPhotoCardUpdate,
} from "@/lib/services/photoCardMatchService";

describe("photo card candidate filters", () => {
  it("trims empty filter values", () => {
    expect(
      normalizePhotoCardCandidateFilters({
        group: "  aespa ",
        member: " ",
        keyword: " winter ",
      }),
    ).toMatchObject({
      group: "aespa",
      member: null,
      keyword: "winter",
    });
  });

  it("caps candidate page size at 50", () => {
    expect(normalizePhotoCardCandidateFilters({ limit: 1000 }).limit).toBe(50);
    expect(normalizePhotoCardCandidateFilters({ limit: -1 }).limit).toBe(50);
  });

  it("normalizes offset", () => {
    expect(normalizePhotoCardCandidateFilters({ offset: 20 }).offset).toBe(20);
    expect(normalizePhotoCardCandidateFilters({ offset: -20 }).offset).toBe(0);
  });

  it("hides registered photo cards by default", () => {
    expect(normalizePhotoCardCandidateFilters({}).includeRegistered).toBe(false);
    expect(
      normalizePhotoCardCandidateFilters({ includeRegistered: true })
        .includeRegistered,
    ).toBe(true);
  });

  it("builds listing image URLs with front/back priority", () => {
    expect(
      photoCardListingImageUrls({
        userFrontImageUrl: "https://r2.example/front.jpg",
        userBackImageUrl: "https://r2.example/back.jpg",
        sourceImageUrl: "https://poca.example/source.jpg",
      }),
    ).toMatchObject({
      frontListingImageUrl: "https://r2.example/front.jpg",
      backListingImageUrl: "https://r2.example/back.jpg",
      imageUrls: [
        "https://r2.example/front.jpg",
        "https://r2.example/back.jpg",
      ],
    });
  });

  it("falls back to source image when front image is missing", () => {
    expect(
      photoCardListingImageUrls({
        userFrontImageUrl: null,
        userBackImageUrl: "https://r2.example/back.jpg",
        sourceImageUrl: "https://poca.example/source.jpg",
        imageUrl: "https://fallback.example/image.jpg",
      }).imageUrls,
    ).toEqual(["https://poca.example/source.jpg"]);
  });

  it("preserves existing source image or derives it from non-r2 current image", () => {
    expect(
      sourceImageUrlForPhotoCardUpdate(
        "https://source.example/card.jpg",
        "https://ignored.example/current.jpg",
      ),
    ).toBe("https://source.example/card.jpg");
    expect(sourceImageUrlForPhotoCardUpdate(null, "https://source.example/card.jpg")).toBe(
      "https://source.example/card.jpg",
    );
    expect(
      sourceImageUrlForPhotoCardUpdate(
        null,
        "https://example.com/api/products/image-match/assets/card-1/front",
      ),
    ).toBeNull();
  });

  it("creates group slug and deterministic r2 object keys", () => {
    expect(photoCardGroupSlug("Stray Kids")).toBe("stray-kids");
    expect(
      photoCardProductCode({
        productCode: null,
        internalCode: "SKZ 00123",
        sku: "SKU-001",
        id: "id-1",
      }),
    ).toBe("SKZ-00123");
    expect(
      photoCardR2ObjectKeys({
        groupName: "Stray Kids",
        productCode: "SKZ00123",
      }),
    ).toEqual({
      frontKey: "stray-kids/SKZ00123_front.jpg",
      backKey: "stray-kids/SKZ00123_back.jpg",
    });
  });
});
