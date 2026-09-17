import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { createProduct } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { confirmPhotoCardImage } from "@/lib/services/photoCardMatchService";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  sku: z.string().trim().max(120).optional().nullable(),
  productName: z.string().trim().min(1, "상품명은 필수입니다.").max(240),
  group: z.string().trim().max(120).optional().nullable(),
  member: z.string().trim().max(120).optional().nullable(),
  album: z.string().trim().max(240).optional().nullable(),
  ebayPrice: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) => {
      if (value === null || value === undefined || value === "") {
        return null;
      }
      const number = Number(value);
      return Number.isFinite(number) ? number : Number.NaN;
    })
    .refine((value) => value === null || (!Number.isNaN(value) && value >= 0), {
      message: "달러 가격은 0 이상의 숫자여야 합니다.",
    }),
  frontImageUrl: z.string().startsWith("data:image/"),
  backImageUrl: z.string().startsWith("data:image/").nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());

    const sku = input.sku?.trim() ? input.sku.trim() : await generateUniqueSku();

    // Create the inventory card (stock starts at 0; confirmPhotoCardImage bumps
    // it to 1 as a brand-new match).
    const product = await createProduct({
      sku,
      productName: input.productName,
      brand: input.group ?? null,
      optionName: input.member ?? null,
      category: input.album ?? null,
      internalCode: null,
      costPrice: null,
      salePrice: null,
      ebayPrice: input.ebayPrice,
      stockQuantity: 0,
      safetyStock: 0,
      location: null,
      memo: null,
      imageUrl: null,
      status: "unlisted",
    });

    // Reuse the photo-card connect flow: upload images to R2, set stock +1,
    // and compute the hash/ORB fingerprint from the uploaded photo.
    const updated = await confirmPhotoCardImage({
      cardId: product.id,
      userFrontImageUrl: input.frontImageUrl,
      userBackImageUrl: input.backImageUrl ?? null,
      publicBaseUrl: publicBaseUrl(request),
      createdBy: user.id,
    });

    return Response.json(
      {
        product: {
          id: product.id,
          sku: product.sku,
          productName: product.productName,
          stockQuantity: updated.stockQuantity,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    if (error instanceof z.ZodError) {
      return jsonError("입력값을 확인해 주세요.", 422, error.flatten());
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("이미 등록된 SKU입니다.", 409);
    }
    return jsonError(asErrorMessage(error), 500);
  }
}

// Auto SKU: continue the existing numeric SKU sequence (e.g. 170560 -> 170561).
// Takes the largest purely-numeric SKU and increments; falls back to 100000.
async function generateUniqueSku(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ max: bigint | null }>>`
    SELECT MAX(CASE WHEN "sku" ~ '^[0-9]+$' THEN "sku"::bigint ELSE NULL END) AS "max"
    FROM "products"
  `;
  const max = rows[0]?.max;
  let next = (max != null ? Number(max) : 0) + 1;
  if (next < 100000) next = 100000;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = String(next);
    const existing = await prisma.product.findUnique({ where: { sku: candidate } });
    if (!existing) return candidate;
    next += 1;
  }

  // Extremely unlikely fallback.
  return String(Date.now());
}

function publicBaseUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? requestUrl.host;
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    (requestUrl.protocol ? requestUrl.protocol.replace(/:$/, "") : "https");

  return `${protocol}://${host}`;
}
