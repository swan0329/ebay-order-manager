import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { jsonError, asErrorMessage } from "@/lib/http";
import { uploadBufferToR2 } from "@/lib/r2";
import { createVariationThumbnail } from "@/lib/variation-thumbnail";
import { getVariationThumbnailLogo } from "@/lib/variation-thumbnail-settings";

const schema = z.object({
  groupName: z.string().trim().min(1).max(80),
  albumName: z.string().trim().min(1).max(120),
  productIds: z.array(z.string().min(1)).min(2).max(40),
  watermarkText: z.string().trim().max(80).optional(),
  watermarkLogoDataUrl: z.string().max(3_000_000).optional(),
  watermarkOpacity: z.number().min(0.03).max(0.3).default(0.06),
  watermarkLogoSize: z.number().min(35).max(220).default(50),
  watermarkGap: z.number().min(10).max(180).default(25),
  previewOnly: z.boolean().default(false),
});

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || "";
    const mode = new URL(request.url).searchParams.get("mode");
    const products = await prisma.product.findMany({
      where: { imageUrl: { not: null }, ...(query ? { OR: [
        { sku: { contains: query, mode: "insensitive" } }, { productName: { contains: query, mode: "insensitive" } },
        { optionName: { contains: query, mode: "insensitive" } }, { category: { contains: query, mode: "insensitive" } },
        { brand: { contains: query, mode: "insensitive" } },
      ] } : {}) },
      select: { id: true, sku: true, productName: true, optionName: true, category: true, brand: true, imageUrl: true },
      orderBy: { updatedAt: "desc" }, take: mode === "groups" ? 10_000 : 200,
    });
    if (mode === "groups") {
      const grouped = new Map<string, typeof products>();
      for (const product of products) {
        const groupName = product.brand?.trim();
        const albumName = product.category?.trim();
        const versionName = product.productName?.trim();
        if (!groupName || !albumName || !versionName) continue;
        const key = JSON.stringify([groupName, albumName, versionName]);
        const rows = grouped.get(key) ?? [];
        rows.push(product); grouped.set(key, rows);
      }
      const groups = [...grouped.entries()].map(([key, rows]) => {
        rows.sort((a, b) => (a.optionName ?? "").localeCompare(b.optionName ?? "", "ko") || a.sku.localeCompare(b.sku, "en", { numeric: true }));
        const [groupName, albumName, versionName] = JSON.parse(key) as string[];
        return { key, groupName, albumName, versionName, count: rows.length,
          productIds: rows.slice(0, 40).map((row) => row.id),
          previewUrls: rows.slice(0, 8).map((row) => row.imageUrl).filter(Boolean),
          truncated: rows.length > 40 };
      }).filter((group) => group.count >= 2).sort((a, b) => b.count - a.count || a.groupName.localeCompare(b.groupName)).slice(0, 1000);
      return Response.json({ groups });
    }
    return Response.json({ products });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const products = await prisma.product.findMany({
      where: { id: { in: input.productIds } },
      select: { id: true, imageUrl: true, ebayImageUrls: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const imageUrls = input.productIds.map((id) => {
      const product = byId.get(id);
      return product?.imageUrl || product?.ebayImageUrls[0] || null;
    }).filter((value): value is string => Boolean(value));
    if (imageUrls.length !== input.productIds.length) return jsonError("이미지가 없는 상품이 포함되어 있습니다.", 400);

    const savedLogo = await getVariationThumbnailLogo(user.id);
    const logo = input.watermarkLogoDataUrl ? dataUrlBuffer(input.watermarkLogoDataUrl) : savedLogo.logoUrl ? await downloadSavedLogo(savedLogo.logoUrl) : null;
    const buffer = await createVariationThumbnail({
      groupName: input.groupName,
      albumName: input.albumName,
      imageUrls,
      watermarkText: input.watermarkText,
      watermarkLogo: logo,
      watermarkOpacity: input.watermarkOpacity,
      watermarkLogoSize: input.watermarkLogoSize,
      watermarkGap: input.watermarkGap,
    });
    if (input.previewOnly) {
      return Response.json({ dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`, width: 1000, height: 1000 });
    }
    const slug = `${slugify(input.groupName)}-${slugify(input.albumName)}`.slice(0, 100) || "variation";
    const uploaded = await uploadBufferToR2({
      buffer,
      key: `products/variation-thumbnails/${slug}-${Date.now()}.jpg`,
      contentType: "image/jpeg",
    });
    return Response.json({ ...uploaded, width: 1000, height: 1000, productCount: imageUrls.length });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError(error.issues[0]?.message ?? "입력값을 확인해 주세요.", 400);
    return jsonError(asErrorMessage(error), 500);
  }
}

function dataUrlBuffer(value: string) {
  const match = value.match(/^data:image\/(?:png|webp|jpeg);base64,(.+)$/);
  if (!match) throw new Error("로고는 PNG, WebP 또는 JPEG 파일만 사용할 수 있습니다.");
  return Buffer.from(match[1], "base64");
}

function slugify(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9가-힣]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

async function downloadSavedLogo(url:string){const response=await fetch(url,{signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new Error("저장된 로고를 불러오지 못했습니다.");const bytes=await response.arrayBuffer();if(bytes.byteLength>2_000_000)throw new Error("저장된 로고가 너무 큽니다.");return Buffer.from(bytes)}
