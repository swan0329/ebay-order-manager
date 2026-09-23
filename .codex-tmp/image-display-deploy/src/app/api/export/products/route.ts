import { jsonError } from "@/lib/http";
import { productsCsv } from "@/lib/products";
import { productSearchWhere } from "@/lib/product-search-where";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const stock = url.searchParams.get("stock");
    const csv = await productsCsv(
      await productSearchWhere({
        q: url.searchParams.get("q"),
        status: url.searchParams.get("status"),
        stock,
        upload: url.searchParams.get("upload"),
      }, user.id),
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
