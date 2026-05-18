import { EbayEnvironmentBadge } from "@/components/EbayEnvironmentBadge";
import { ListingDraftTable } from "@/components/ListingDraftTable";
import { ListingUploadNav } from "@/components/ListingUploadNav";
import { TopNav } from "@/components/TopNav";
import { prisma } from "@/lib/prisma";
import {
  getCachedPolicies,
  getEbayConnectionSummary,
} from "@/lib/services/ebayAccountService";
import { listDrafts } from "@/lib/services/listingDraftService";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ status?: string }>;

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

export default async function ListingUploadJobsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const [drafts, ebayConnection, counts, cachedPolicies] = await Promise.all([
    listDrafts(user.id, params.status ?? "all"),
    getEbayConnectionSummary(user.id),
    prisma.listingDraft.groupBy({
      by: ["status"],
      where: { userId: user.id },
      _count: { _all: true },
    }),
    getCachedPolicies(user.id),
  ]);
  const countMap = Object.fromEntries(
    counts.map((entry) => [entry.status, entry._count._all]),
  );

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-zinc-950">업로드 작업내역</h1>
          <p className="mt-1 text-sm text-zinc-600">
            저장된 draft를 검증하고, 수동 업로드 전 최종 데이터 품질을 점검합니다.
          </p>
          <div className="mt-2">
            <EbayEnvironmentBadge {...ebayConnection} />
          </div>
        </div>
        <ListingUploadNav active="/listing-upload/jobs" />
        <section className="mb-4 grid gap-3 sm:grid-cols-4">
          {[
            ["대기", (countMap.draft ?? 0) + (countMap.validated ?? 0)],
            ["업로드중", countMap.uploading ?? 0],
            ["성공", countMap.uploaded ?? 0],
            ["실패", countMap.failed ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-zinc-200 bg-white p-4">
              <p className="text-sm font-medium text-zinc-500">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
            </div>
          ))}
        </section>
        <div className="mb-3 flex flex-wrap gap-2">
          {["all", "draft", "validated", "uploaded", "failed"].map((status) => (
            <a
              key={status}
              href={`/listing-upload/jobs${status === "all" ? "" : `?status=${status}`}`}
              className={`h-9 rounded-md px-3 py-2 text-sm font-semibold ${
                (params.status ?? "all") === status
                  ? "bg-zinc-950 text-white"
                  : "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
              }`}
            >
              {status}
            </a>
          ))}
        </div>
        <ListingDraftTable
          drafts={serializeDrafts(drafts)}
          showRetryAll
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
