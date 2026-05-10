import { EbayEnvironmentBadge } from "@/components/EbayEnvironmentBadge";
import { ListingExcelUploader } from "@/components/ListingExcelUploader";
import { ListingUploadNav } from "@/components/ListingUploadNav";
import { TopNav } from "@/components/TopNav";
import { getEbayConnectionSummary } from "@/lib/services/ebayAccountService";
import { listListingTemplates } from "@/lib/services/listingTemplateService";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ListingUploadExcelPage() {
  const user = await requireUser();
  const [templates, ebayConnection] = await Promise.all([
    listListingTemplates(user.id),
    getEbayConnectionSummary(user.id),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-zinc-950">엑셀 대량 업로드</h1>
          <p className="mt-1 text-sm text-zinc-600">
            엑셀/CSV 상품 데이터를 검증 가능한 draft로 저장합니다.
          </p>
          <div className="mt-2">
            <EbayEnvironmentBadge {...ebayConnection} />
          </div>
        </div>
        <ListingUploadNav active="/listing-upload/excel" />
        <ListingExcelUploader
          templates={templates.map((template) => ({
            id: template.id,
            name: template.name,
            isDefault: template.isDefault,
          }))}
        />
      </main>
    </div>
  );
}
