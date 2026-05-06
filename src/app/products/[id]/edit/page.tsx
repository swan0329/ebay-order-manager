import { notFound } from "next/navigation";
import { ProductForm } from "@/components/ProductForm";
import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });

  if (!product) {
    notFound();
  }

  const formProduct = {
    id: product.id,
    sku: product.sku,
    internalCode: product.internalCode,
    productName: product.productName,
    optionName: product.optionName,
    category: product.category,
    brand: product.brand,
    costPrice: product.costPrice?.toString() ?? null,
    salePrice: product.salePrice?.toString() ?? null,
    stockQuantity: product.stockQuantity,
    safetyStock: product.safetyStock,
    location: product.location,
    memo: product.memo,
    imageUrl: product.imageUrl,
    status: product.status,
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-zinc-950">상품 수정</h1>
          <p className="mt-1 text-sm text-zinc-500">{product.sku}</p>
        </div>
        <ProductForm product={formProduct} />
      </main>
    </div>
  );
}
