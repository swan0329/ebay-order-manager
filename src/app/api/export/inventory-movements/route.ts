import { jsonError } from "@/lib/http";
import { inventoryMovementsCsv } from "@/lib/inventory";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET() {
  try {
    await requireApiUser();
    const csv = await inventoryMovementsCsv();

    return new Response(`\uFEFF${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="inventory-movements-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    throw error;
  }
}
