import { ProductForm } from "@/components/ProductForm";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";

export default async function NewProductPage() {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-zinc-950">상품 등록</h1>
          <p className="mt-1 text-sm text-zinc-500">내부 상품 DB에 상품을 추가합니다.</p>
        </div>
        <ProductForm />
      </main>
    </div>
  );
}
