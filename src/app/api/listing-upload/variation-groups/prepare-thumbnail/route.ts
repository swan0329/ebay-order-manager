import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";
import { getVariationListingReadyImages } from "@/lib/variation-listing-products";
import { buildVariationListingGroups, variationParentSku } from "@/lib/variation-listing-groups";
import { variationThumbnailHash } from "@/lib/variation-thumbnail-state";
import { createVariationThumbnail } from "@/lib/variation-thumbnail";
import { getVariationThumbnailLogo } from "@/lib/variation-thumbnail-settings";
import { uploadBufferToR2 } from "@/lib/r2";
import { hasListingPrice } from "@/lib/listing-price";

const schema = z.object({ groupKey: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { groupKey } = schema.parse(await request.json());
    const readyImages = await getVariationListingReadyImages();
    const stored = await prisma.product.findMany({ where: { id: { in: readyImages.map((row) => row.id) } } });
    const imageById = new Map(readyImages.map((row) => [row.id, row.listingImageUrl]));
    const products = stored.filter(hasListingPrice).map((product) => ({ ...product, imageUrl: imageById.get(product.id) ?? null, ebayImageUrls: [] }));
    const group = buildVariationListingGroups(products).groups.find((item) => item.key === groupKey);
    if (!group) return jsonError("묶음 후보가 변경되었습니다. 화면을 새로고침해 주세요.", 409);
    if (group.products.length > 40) return jsonError("옵션은 최대 40장까지 지원합니다.", 422);
    const hash = variationThumbnailHash(group);
    const existing = await prisma.variationListingState.findUnique({ where: { userId_groupKey: { userId: user.id, groupKey } } });
    if (existing?.thumbnailStatus === "READY" && existing.thumbnailHash === hash && existing.thumbnailUrl) {
      return Response.json({ status: "READY", url: existing.thumbnailUrl, hash, reused: true, generatedAt: existing.thumbnailGeneratedAt });
    }
    const baseState = { userId: user.id, groupKey, parentSku: variationParentSku(groupKey), title: group.title };
    await prisma.variationListingState.upsert({
      where: { userId_groupKey: { userId: user.id, groupKey } },
      create: { ...baseState, thumbnailStatus: "GENERATING", thumbnailHash: hash, thumbnailProductIds: group.products.map((product) => product.id) },
      update: { title: group.title, thumbnailStatus: "GENERATING", thumbnailHash: hash, thumbnailProductIds: group.products.map((product) => product.id), thumbnailError: null },
    });
    try {
      const savedLogo = await getVariationThumbnailLogo(user.id);
      let logo: Buffer | null = null;
      if (savedLogo.logoUrl) {
        const response = await fetch(savedLogo.logoUrl, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("저장된 썸네일 로고를 불러오지 못했습니다.");
        logo = Buffer.from(await response.arrayBuffer());
      }
      const imageUrls = group.products.map((product) => product.imageUrl!).filter(Boolean);
      const buffer = await createVariationThumbnail({ groupName: group.groupName, albumName: `${group.albumName} · ${group.versionName}`, imageUrls, watermarkLogo: logo });
      const uploaded = await uploadBufferToR2({ buffer, key: `products/variation-thumbnails/${hash}.jpg`, contentType: "image/jpeg" });
      const generatedAt = new Date();
      await prisma.variationListingState.update({ where: { userId_groupKey: { userId: user.id, groupKey } }, data: { thumbnailStatus: "READY", thumbnailUrl: uploaded.url, thumbnailKey: uploaded.key, thumbnailHash: hash, thumbnailProductIds: group.products.map((product) => product.id), thumbnailGeneratedAt: generatedAt, thumbnailError: null } });
      return Response.json({ status: "READY", url: uploaded.url, hash, reused: false, generatedAt });
    } catch (error) {
      await prisma.variationListingState.update({ where: { userId_groupKey: { userId: user.id, groupKey } }, data: { thumbnailStatus: "FAILED", thumbnailError: asErrorMessage(error) } });
      throw error;
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("묶음을 확인해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}
