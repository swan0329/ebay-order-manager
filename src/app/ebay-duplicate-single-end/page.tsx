import { EbayDuplicateSingleEndClient } from "@/components/EbayDuplicateSingleEndClient";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EbayDuplicateSingleEndPage() {
  const user = await requireUser();
  return <div className="min-h-screen bg-zinc-50"><TopNav loginId={user.loginId} /><main className="mx-auto max-w-3xl px-4 py-7"><h1 className="text-2xl font-bold">eBay 실제 중복 단품 종료</h1><p className="mt-2 text-sm text-zinc-600">옵션상품에 이미 포함된 SKU 73849의 예전 단품만 종료합니다. 옵션상품은 유지됩니다.</p><EbayDuplicateSingleEndClient itemId="157971264614" sku="73849" /></main></div>;
}
