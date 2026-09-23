import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function POST() {
  try {
    await requireApiUser();

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "orders_user_id_fulfillment_status_order_date_idx"
        ON "orders" ("user_id", "fulfillment_status", "order_date");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "orders_user_id_order_date_idx"
        ON "orders" ("user_id", "order_date");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "order_items_order_id_stock_deducted_idx"
        ON "order_items" ("order_id", "stock_deducted");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "shipments_order_id_status_idx"
        ON "shipments" ("order_id", "status");
    `);

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
