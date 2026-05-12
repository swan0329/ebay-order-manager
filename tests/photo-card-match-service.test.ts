import { describe, expect, it } from "vitest";
import { normalizePhotoCardCandidateFilters } from "@/lib/services/photoCardMatchService";

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
});
