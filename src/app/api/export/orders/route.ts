import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  let user;
  try {
    user = await requireApiUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    throw error;
  }
  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { items: true, shipments: true },
    orderBy: { orderDate: "desc" },
  });
  const header = [
    "ebay_order_id",
    "buyer_name",
    "item_titles",
    "skus",
    "quantity",
    "order_date",
    "fulfillment_status",
    "buyer_country",
    "total_amount",
    "currency",
    "tracking_numbers",
  ];
  const rows = orders.map((order) => [
    order.ebayOrderId,
    order.buyerName,
    order.items.map((item) => item.title).join(" | "),
    order.items.map((item) => item.sku ?? "").join(" | "),
    order.items.reduce((sum, item) => sum + item.quantity, 0),
    order.orderDate.toISOString(),
    order.fulfillmentStatus,
    order.buyerCountry,
    order.totalAmount.toString(),
    order.currency,
    order.shipments.map((shipment) => shipment.trackingNumber).join(" | "),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ebay-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
