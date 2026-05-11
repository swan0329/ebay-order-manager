import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  imageSignatureFromBuffer,
  imageSignatureFromDataUrl,
} from "@/lib/services/productImageMatchService";

describe("product image matching helpers", () => {
  it("builds stable signatures from image bytes", () => {
    const buffer = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(imageSignatureFromBuffer(buffer)).toEqual(imageSignatureFromBuffer(buffer));
  });

  it("scores identical signatures higher than different signatures", () => {
    const first = imageSignatureFromBuffer(Buffer.from([1, 2, 3, 4, 5]));
    const second = imageSignatureFromBuffer(Buffer.from([1, 2, 3, 4, 5]));
    const different = imageSignatureFromBuffer(Buffer.from([200, 201, 202, 203, 204]));

    expect(cosineSimilarity(first, second)).toBeGreaterThan(
      cosineSimilarity(first, different),
    );
  });

  it("reads data URL images", () => {
    const dataUrl = `data:image/png;base64,${Buffer.from([9, 8, 7]).toString("base64")}`;

    expect(imageSignatureFromDataUrl(dataUrl)).toHaveLength(64);
  });
});
