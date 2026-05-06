import { jsonError } from "@/lib/http";
import { productsCsv, productWhere } from "@/lib/products";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const url = new URL(request.url);
    const stock = url.searchParams.get("stock");
    const csv = await productsCsv(
      productWhere({
        q: url.searchParams.get("q"),
        status: url.searchParams.get("status"),
        stock,
      }),
      stock,
    );

    return new Response(`\uFEFF${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    throw error;
  }
}
