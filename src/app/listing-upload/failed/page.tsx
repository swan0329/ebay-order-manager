import { EbayEnvironmentBadge } from "@/components/EbayEnvironmentBadge";
import { ListingDraftTable } from "@/components/ListingDraftTable";
import { ListingUploadNav } from "@/components/ListingUploadNav";
import { TopNav } from "@/components/TopNav";
import {
  getCachedPolicies,
  getEbayConnectionSummary,
} from "@/lib/services/ebayAccountService";
import { listDrafts } from "@/lib/services/listingDraftService";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function serializeDrafts(drafts: Awaited<ReturnType<typeof listDrafts>>) {
  return drafts.map((draft) => ({
    ...draft,
    price: draft.price?.toString() ?? null,
    minimumOfferPrice: draft.minimumOfferPrice?.toString() ?? null,
    autoAcceptPrice: draft.autoAcceptPrice?.toString() ?? null,
    promotedAdRate: draft.promotedAdRate?.toString() ?? null,
    lastUploadedAt: draft.lastUploadedAt?.toISOString() ?? null,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }));
}

export default async function ListingUploadFailedPage() {
  const user = await requireUser();
  const [drafts, ebayConnection, cachedPolicies] = await Promise.all([
    listDrafts(user.id, "failed"),
    getEbayConnectionSummary(user.id),
    getCachedPolicies(user.id),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-zinc-950">실패한 업로드</h1>
          <p className="mt-1 text-sm text-zinc-600">
            eBay 응답과 검증 오류를 확인한 뒤 수정하거나 재시도합니다.
          </p>
          <div className="mt-2">
            <EbayEnvironmentBadge {...ebayConnection} />
          </div>
        </div>
        <ListingUploadNav active="/listing-upload/failed" />
        <ListingDraftTable
          drafts={serializeDrafts(drafts)}
          failedOnly
          ebayEnvironment={ebayConnection.environment}
          canReadMarketing={ebayConnection.canReadMarketing}
          canWriteMarketing={ebayConnection.canWriteMarketing}
          policyOptions={{
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
          }}
        />
      </main>
    </div>
  );
}
