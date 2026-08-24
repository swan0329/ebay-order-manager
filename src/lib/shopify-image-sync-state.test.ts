import { describe, expect, it } from "vitest";
import { shopifyImageSyncIsCurrent } from "./shopify-image-sync-state";

describe("shopifyImageSyncIsCurrent", () => {
  it("preserves a legacy listing without managed image metadata", () => {
    expect(shopifyImageSyncIsCurrent(null, "https://img/new.jpg")).toBe(true);
  });

  it("does not schedule an existing listing only because its watermark signature changed", () => {
    expect(shopifyImageSyncIsCurrent({ imageSync: { status: "READY", sourceImageUrl: "https://img/card.jpg", watermarkSignature: "old" } }, "https://img/card.jpg")).toBe(true);
  });

  it("repairs a failed image sync or an actually changed approved source", () => {
    expect(shopifyImageSyncIsCurrent({ imageSync: { status: "FAILED", sourceImageUrl: "https://img/card.jpg" } }, "https://img/card.jpg")).toBe(false);
    expect(shopifyImageSyncIsCurrent({ imageSync: { status: "READY", sourceImageUrl: "https://img/old.jpg" } }, "https://img/new.jpg")).toBe(false);
  });
});
