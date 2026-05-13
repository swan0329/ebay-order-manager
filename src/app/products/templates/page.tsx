import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ListingTemplateManager } from "@/components/ListingTemplateManager";
import { TopNav } from "@/components/TopNav";
import { getCachedPolicies } from "@/lib/services/ebayAccountService";
import { listListingTemplates } from "@/lib/services/listingTemplateService";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProductTemplatesPage() {
  const user = await requireUser();
  const [templates, cachedPolicies] = await Promise.all([
    listListingTemplates(user.id),
    getCachedPolicies(user.id),
  ]);
  const clientTemplates = templates.map((template) => ({
    ...template,
    defaultPrice: template.defaultPrice?.toString() ?? null,
    minimumOfferPrice: template.minimumOfferPrice?.toString() ?? null,
    autoAcceptPrice: template.autoAcceptPrice?.toString() ?? null,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  }));
  const initialPolicies = {
    paymentPolicies: cachedPolicies.policies
      .filter((policy) => policy.policyType === "payment")
      .map((policy) => ({ id: policy.policyId, name: policy.name ?? policy.policyId })),
    fulfillmentPolicies: cachedPolicies.policies
      .filter((policy) => policy.policyType === "fulfillment")
      .map((policy) => ({ id: policy.policyId, name: policy.name ?? policy.policyId })),
    returnPolicies: cachedPolicies.policies
      .filter((policy) => policy.policyType === "return")
      .map((policy) => ({ id: policy.policyId, name: policy.name ?? policy.policyId })),
    inventoryLocations: cachedPolicies.locations.map((location) => ({
      id: location.merchantLocationKey,
      name: location.name ?? location.merchantLocationKey,
    })),
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <Link
            href="/listing-upload"
            className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950"
          >
            <ArrowLeft className="h-4 w-4" />
            eBay 업로드
          </Link>
          <h1 className="text-xl font-semibold text-zinc-950">업로드 템플릿</h1>
        </div>

        <ListingTemplateManager
          initialTemplates={clientTemplates}
          initialPolicies={initialPolicies}
        />
      </main>
    </div>
  );
}
