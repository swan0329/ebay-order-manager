import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ListingTemplateManager } from "@/components/ListingTemplateManager";
import { TopNav } from "@/components/TopNav";
import { listListingTemplates } from "@/lib/services/listingTemplateService";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProductTemplatesPage() {
  const user = await requireUser();
  const templates = await listListingTemplates(user.id);
  const clientTemplates = templates.map((template) => ({
    ...template,
    defaultPrice: template.defaultPrice?.toString() ?? null,
    minimumOfferPrice: template.minimumOfferPrice?.toString() ?? null,
    autoAcceptPrice: template.autoAcceptPrice?.toString() ?? null,
  }));

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <Link
            href="/products/upload"
            className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950"
          >
            <ArrowLeft className="h-4 w-4" />
            eBay 업로드
          </Link>
          <h1 className="text-xl font-semibold text-zinc-950">업로드 템플릿</h1>
        </div>

        <ListingTemplateManager initialTemplates={clientTemplates} />
      </main>
    </div>
  );
}
