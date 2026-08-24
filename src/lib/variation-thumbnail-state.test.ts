import { describe, expect, it } from "vitest";
import { thumbnailIsCurrent, variationThumbnailHash } from "./variation-thumbnail-state";

const group = {
  key: "group\u001falbum\u001fversion",
  groupName: "Group",
  albumName: "Album",
  versionName: "Version",
  title: "Group Album Version",
  products: [
    { id: "1", sku: "A", brand: "Group", category: "Album", productName: "Version", optionName: "One", imageUrl: "https://img/1.jpg", variationName: "One" },
    { id: "2", sku: "B", brand: "Group", category: "Album", productName: "Version", optionName: "Two", imageUrl: "https://img/2.jpg", variationName: "Two" },
  ],
};

describe("variation thumbnail state", () => {
  it("keeps the same hash for the same ordered composition", () => {
    expect(variationThumbnailHash(group)).toBe(variationThumbnailHash(structuredClone(group)));
  });

  it("invalidates a thumbnail when a product image changes", () => {
    const hash = variationThumbnailHash(group);
    const changed = structuredClone(group);
    changed.products[0].imageUrl = "https://img/replaced.jpg";
    expect(variationThumbnailHash(changed)).not.toBe(hash);
    expect(thumbnailIsCurrent({ thumbnailStatus: "READY", thumbnailUrl: "https://img/thumb.jpg", thumbnailHash: hash }, variationThumbnailHash(changed))).toBe(false);
  });

  it("invalidates a thumbnail when the saved watermark changes", () => {
    const before = variationThumbnailHash(group, "watermark-a");
    const after = variationThumbnailHash(group, "watermark-b");
    expect(after).not.toBe(before);
    expect(thumbnailIsCurrent({ thumbnailStatus: "READY", thumbnailUrl: "https://img/thumb.jpg", thumbnailHash: before }, after)).toBe(false);
  });

  it("requires ready status, URL, and matching hash", () => {
    const hash = variationThumbnailHash(group);
    expect(thumbnailIsCurrent({ thumbnailStatus: "READY", thumbnailUrl: "https://img/thumb.jpg", thumbnailHash: hash }, hash)).toBe(true);
    expect(thumbnailIsCurrent({ thumbnailStatus: "FAILED", thumbnailUrl: "https://img/thumb.jpg", thumbnailHash: hash }, hash)).toBe(false);
  });
});
