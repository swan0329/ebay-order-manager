import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import {
  createProduct,
  matchesProductStockFilter,
  productInputSchema,
} from "@/lib/products";
import { productSearchWhere } from "@/lib/product-search-where";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const stock = url.searchParams.get("stock");
    const exactSkus = url.searchParams.has("skus")
      ? z.array(z.string().trim().min(1).max(200)).min(1).max(500).parse(url.searchParams.get("skus")!.split(","))
      : null;
    const filters = await productSearchWhere({
      q: url.searchParams.get("q"), status: url.searchParams.get("status"), stock,
      group: url.searchParams.get("group"), member: url.searchParams.get("member"),
      album: url.searchParams.get("album"), version: url.searchParams.get("version"),
    }, user.id);
    const products = await prisma.product.findMany({
      where: exactSkus ? { AND: [filters, { sku: { in: [...new Set(exactSkus)] } }] } : filters,
      orderBy: { updatedAt: "desc" },
      take: 500,
      ...(url.searchParams.get("includePriceHistory") === "true" ? {
        include: {
          listingPriceApprovals: {
            orderBy: { approvedAt: "desc" as const }, take: 10,
            select: { priceUsd: true, source: true, approvedAt: true },
          },
        },
      } : {}),
    });

    return Response.json({
      products: products.filter((product) => matchesProductStockFilter(product, stock)),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }
    if (error instanceof z.ZodError) return jsonError("정확한 상품번호를 1~500개 지정해 주세요.", 422);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const input = productInputSchema.parse(await request.json());
    const product = await createProduct(input);
    return Response.json({ product }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("상품 입력값을 확인해 주세요.", 422, error.flatten());
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("이미 등록된 SKU 또는 포카마켓 상품번호입니다.", 409);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
