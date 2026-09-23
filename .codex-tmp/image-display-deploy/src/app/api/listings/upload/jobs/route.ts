import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET() {
  try {
    const user = await requireApiUser();
    const jobs = await prisma.productUploadJob.findMany({
      where: { userId: user.id },
      include: {
        template: {
          select: {
            id: true,
            name: true,
          },
        },
        product: {
          select: {
            id: true,
            sku: true,
            productName: true,
            listingStatus: true,
            ebayItemId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return Response.json({ jobs });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
