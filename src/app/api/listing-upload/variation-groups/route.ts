import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";
import { hasListingPrice, resolveListingPriceUsd } from "@/lib/listing-price";
import { buildVariationListingGroups, variationEbayTitle } from "@/lib/variation-listing-groups";
import { getVariationListingReadyImages, isPublicListingImageUrl } from "@/lib/variation-listing-products";
import { thumbnailIsCurrent, variationThumbnailHash } from "@/lib/variation-thumbnail-state";
import { getListingWatermarkSettings } from "@/lib/variation-thumbnail-settings";
import { listingWatermarkSignature } from "@/lib/listing-watermark";

function jsonIds(value: unknown) {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export async function GET() {
  try {
    const user = await requireApiUser();
    const [readyImages, pricingSettings, latestReport, watermarkSettings] = await Promise.all([
      getVariationListingReadyImages(),
      prisma.pricingSettings.findUnique({ where: { id: "default" } }),
      prisma.ebayReportImport.findFirst({
        where: { userId: user.id, completeSnapshot: true },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      getListingWatermarkSettings(user.id),
    ]);
    const products = await prisma.product.findMany({
      where: { id: { in: readyImages.map((row) => row.id) } },
      orderBy: { sku: "asc" },
      take: 10_000,
    });
    const readyImageById = new Map(readyImages.map((row) => [row.id, row.listingImageUrl]));
    const eligible = products
      .filter((product) => hasListingPrice(product))
      .map((product) => ({ ...product, imageUrl: readyImageById.get(product.id) ?? null, ebayImageUrls: [] }));
    const { groups, unmatched } = buildVariationListingGroups(eligible);
    const states = await prisma.variationListingState.findMany({ where: { userId: user.id } });
    const stateByKey = new Map(states.map((state) => [state.groupKey, state]));
    return Response.json({
      groups: groups.slice(0, 1000).map((group) => {
        const state = stateByKey.get(group.key);
        const thumbnailHash = variationThumbnailHash(group, listingWatermarkSignature(watermarkSettings));
        const thumbnailReady = thumbnailIsCurrent(state, thumbnailHash);
        return ({
        ...group,
        ebayTitle: variationEbayTitle(group.title),
        ebayItemId: state?.ebayItemId ?? null,
        includedCount: jsonIds(stateByKey.get(group.key)?.includedProductIds).length,
        newOptionCount: group.products.filter((product) => {
          const ids = jsonIds(stateByKey.get(group.key)?.includedProductIds);
          return !ids.includes(product.id);
        }).length,
        invalidImageCount: group.products.filter((product) => !isPublicListingImageUrl(product.imageUrl)).length,
        products: group.products.slice(0, 40).map((product) => ({
          id: product.id,
          sku: product.sku,
          variationName: product.variationName,
          imageUrl: product.imageUrl || product.ebayImageUrls[0] || null,
          priceUsd: pricingSettings
            ? resolveListingPriceUsd(product, pricingSettings)?.priceUsd.toFixed(2) ?? null
            : null,
          activeItemId: product.ebayItemId,
          listingStatus: product.listingStatus,
        })),
        truncated: group.products.length > 40,
        activeSingleCount: group.products.filter((product) =>
          Boolean(product.ebayItemId) &&
          ["ACTIVE", "PUBLISHED", "LISTED"].includes(String(product.listingStatus ?? "").toUpperCase()),
        ).length,
        thumbnailStatus: thumbnailReady ? "READY" : state?.thumbnailStatus === "FAILED" ? "FAILED" : "MISSING",
        thumbnailUrl: thumbnailReady ? state?.thumbnailUrl ?? null : null,
        thumbnailError: state?.thumbnailStatus === "FAILED" ? state.thumbnailError : null,
        thumbnailGeneratedAt: thumbnailReady ? state?.thumbnailGeneratedAt ?? null : null,
      })}),
      unmatchedCount: unmatched.length + (products.length - eligible.length),
      missingPriceCount: products.length - eligible.length,
      latestCompleteReportAt: latestReport?.createdAt ?? null,
      pricingReady: Boolean(pricingSettings),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}
