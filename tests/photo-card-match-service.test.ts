import { describe, expect, it } from "vitest";
import {
  normalizePhotoCardCandidateFilters,
  photoCardListingImageUrls,
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

  it("builds listing image URLs from user-uploaded front and back assets first", () => {
    expect(
      photoCardListingImageUrls({
        cardId: "card-1",
        userFrontImageUrl: "data:image/png;base64,front",
        userBackImageUrl: "data:image/png;base64,back",
        publicBaseUrl: "https://example.com/",
      }),
    ).toMatchObject({
      frontListingImageUrl:
        "https://example.com/api/products/image-match/assets/card-1/front",
      backListingImageUrl:
        "https://example.com/api/products/image-match/assets/card-1/back",
      imageUrls: [
        "https://example.com/api/products/image-match/assets/card-1/front",
        "https://example.com/api/products/image-match/assets/card-1/back",
      ],
    });
  });

  it("preserves the original source image and does not promote generated asset URLs", () => {
    expect(sourceImageUrlForPhotoCardUpdate("https://source.example/card.jpg")).toBe(
      "https://source.example/card.jpg",
    );
    expect(
      sourceImageUrlForPhotoCardUpdate(
        "https://example.com/api/products/image-match/assets/card-1/front",
      ),
    ).toBeNull();
  });
});
