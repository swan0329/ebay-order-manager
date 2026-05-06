import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import {
  createProduct,
  matchesProductStockFilter,
  productInputSchema,
  productWhere,
} from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const url = new URL(request.url);
    const stock = url.searchParams.get("stock");
    const products = await prisma.product.findMany({
      where: productWhere({
        q: url.searchParams.get("q"),
        status: url.searchParams.get("status"),
        stock,
      }),
      orderBy: { updatedAt: "desc" },
      take: 500,
    });

    return Response.json({
      products: products.filter((product) => matchesProductStockFilter(product, stock)),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

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
      return jsonError("이미 등록된 SKU입니다.", 409);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
