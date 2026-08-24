import { createHash } from "node:crypto";
import type { VariationListingGroup } from "@/lib/variation-listing-groups";

export function variationThumbnailHash(group: VariationListingGroup, watermarkSignature = "") {
  const snapshot = {
    key: group.key,
    title: group.title,
    products: group.products.map((product) => ({
      id: product.id,
      imageUrl: product.imageUrl || product.ebayImageUrls?.[0] || null,
      variationName: product.variationName,
    })),
    watermarkSignature,
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function thumbnailIsCurrent(
  state: { thumbnailStatus: string; thumbnailUrl: string | null; thumbnailHash: string | null } | null | undefined,
  hash: string,
) {
  return state?.thumbnailStatus === "READY" && Boolean(state.thumbnailUrl) && state.thumbnailHash === hash;
}
