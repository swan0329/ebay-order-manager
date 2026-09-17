import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { productInputSchema, updateProduct } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireApiUser();
    const { id } = await context.params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        movements: { orderBy: { createdAt: "desc" }, take: 50 },
        orderItems: {
          include: { order: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });

    if (!product) {
      return jsonError("상품을 찾을 수 없습니다.", 404);
    }

    return Response.json({ product });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const input = productInputSchema.parse(await request.json());
    const product = await updateProduct(id, input, user.id);
    return Response.json({ product });
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

// Partial update — currently just the eBay USD price (used by the photo-card
// match flow's candidate cards, so a price can be set without the full form).
export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireApiUser();
    const { id } = await context.params;
    const body = (await request.json()) as { ebayPrice?: string | number | null };

    let ebayPrice: number | null = null;
    const raw = body.ebayPrice;
    if (raw !== null && raw !== undefined && raw !== "") {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric < 0) {
        return jsonError("0 이상의 숫자를 입력해 주세요.", 422);
      }
      ebayPrice = numeric;
    }

    const product = await prisma.product.update({
      where: { id },
      data: { ebayPrice },
      select: { id: true, ebayPrice: true },
    });

    return Response.json({
      ok: true,
      ebayPrice: product.ebayPrice != null ? Number(product.ebayPrice) : null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("상품을 찾을 수 없습니다.", 404);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await requireApiUser();
    const { id } = await context.params;
    const product = await prisma.product.delete({
      where: { id },
      select: { id: true, sku: true },
    });

    return Response.json({ deleted: true, product });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("Product not found.", 404);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
