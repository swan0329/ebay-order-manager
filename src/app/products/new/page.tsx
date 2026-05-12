import { ProductForm } from "@/components/ProductForm";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";

type NewProductSearchParams = Promise<{
  brand?: string;
  category?: string;
  optionName?: string;
  productName?: string;
  memo?: string;
}>;

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: NewProductSearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const productName =
    params.productName ??
    [params.brand, params.category, params.optionName].filter(Boolean).join(" ");

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-zinc-950">상품 등록</h1>
          <p className="mt-1 text-sm text-zinc-500">내부 상품 DB에 상품을 추가합니다.</p>
        </div>
        <ProductForm
          product={{
            sku: "",
            productName,
            optionName: params.optionName ?? null,
            category: params.category ?? null,
            brand: params.brand ?? null,
            memo: params.memo ?? null,
            stockQuantity: 0,
            safetyStock: 0,
            status: "active",
          }}
        />
      </main>
    </div>
  );
}
