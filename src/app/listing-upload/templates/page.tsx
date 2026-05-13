import { EbayEnvironmentBadge } from "@/components/EbayEnvironmentBadge";
import { ListingPolicySync } from "@/components/ListingPolicySync";
import { ListingTemplateManager } from "@/components/ListingTemplateManager";
import { ListingUploadNav } from "@/components/ListingUploadNav";
import { TopNav } from "@/components/TopNav";
import { listListingTemplates } from "@/lib/services/listingTemplateService";
import {
  getCachedPolicies,
  getEbayConnectionSummary,
} from "@/lib/services/ebayAccountService";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ListingUploadTemplatesPage() {
  const user = await requireUser();
  const [templates, ebayConnection, cachedPolicies] = await Promise.all([
    listListingTemplates(user.id),
    getEbayConnectionSummary(user.id),
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
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">업로드 템플릿</h1>
            <p className="mt-1 text-sm text-zinc-600">
              정책, 위치, 카테고리, 제목 규칙을 상품 업로드에 재사용합니다.
            </p>
            <div className="mt-2">
              <EbayEnvironmentBadge {...ebayConnection} />
            </div>
          </div>
          <ListingPolicySync />
        </div>
        <ListingUploadNav active="/listing-upload/templates" />
        <ListingTemplateManager
          initialTemplates={clientTemplates}
          initialPolicies={initialPolicies}
        />
      </main>
    </div>
  );
}
