import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { createWatermarkedImageBuffer, resolveListingWatermark } from "@/lib/listing-watermark";
import { createVariationThumbnail } from "@/lib/variation-thumbnail";

const schema = z.object({ watermarkText: z.string().trim().max(80).nullable(), watermarkOpacity: z.number().min(.03).max(.3), watermarkLogoSize: z.number().int().min(35).max(220), watermarkGap: z.number().int().min(10).max(180), applyToIndividualCards: z.boolean() });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(); const input = schema.parse(await request.json());
    const rows = await prisma.product.findMany({ where: { imageUrl: { not: null } }, select: { id: true, brand: true, category: true, productName: true, imageUrl: true }, orderBy: { updatedAt: "desc" }, take: 500 });
    const single = rows.find((row) => row.imageUrl);
    if (!single?.imageUrl) return jsonError("미리보기에 사용할 승인 이미지가 없습니다.", 422);
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) { if (!row.brand?.trim() || !row.category?.trim() || !row.productName?.trim() || !row.imageUrl) continue; const key = `${row.brand}\u001f${row.category}\u001f${row.productName}`; grouped.set(key, [...(grouped.get(key) ?? []), row]); }
    const collection = [...grouped.values()].find((items) => items.length >= 2)?.slice(0, 40);
    const saved = await resolveListingWatermark(user.id); const watermark = { ...saved, ...input, signature: saved.signature };
    const singlePreview = await createWatermarkedImageBuffer(single.imageUrl, watermark);
    const response: Record<string, unknown> = { single: { title: single.productName ?? single.id, dataUrl: `data:image/jpeg;base64,${singlePreview.buffer.toString("base64")}` } };
    if (collection) { const first = collection[0]!; const thumbnail = await createVariationThumbnail({ groupName: first.brand!, albumName: `${first.category} · ${first.productName}`, imageUrls: collection.map((item) => item.imageUrl!), watermarkLogo: watermark.logo, watermarkText: watermark.watermarkText ?? undefined, watermarkOpacity: watermark.watermarkOpacity, watermarkLogoSize: watermark.watermarkLogoSize, watermarkGap: watermark.watermarkGap }); response.collection = { title: `${first.brand} · ${first.category} · ${first.productName}`, count: collection.length, dataUrl: `data:image/jpeg;base64,${thumbnail.toString("base64")}` }; }
    return Response.json(response);
  } catch (error) { if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401); if (error instanceof z.ZodError) return jsonError("미리보기 설정을 확인해 주세요.", 422); return jsonError(asErrorMessage(error), 500); }
}
