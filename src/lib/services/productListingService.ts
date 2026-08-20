import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

export async function upsertProductListing(input: {
  productId: string;
  channel: "EBAY" | "SHOPIFY";
  externalId: string;
  price?: number | string | Prisma.Decimal | null;
  quantity?: number | null;
  status?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.productListing.upsert({
    where: {
      productId_channel: { productId: input.productId, channel: input.channel },
    },
    update: {
      externalId: input.externalId,
      price: input.price,
      quantity: input.quantity,
      status: input.status,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
    create: {
      productId: input.productId,
      channel: input.channel,
      externalId: input.externalId,
      price: input.price,
      quantity: input.quantity,
      status: input.status,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  });
}
