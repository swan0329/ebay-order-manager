"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Eye, FileCheck2, FileUp, RefreshCw, Settings, UploadCloud } from "lucide-react";

type UploadJob = {
  id: string;
  sku: string;
  source: string;
  action: string | null;
  status: string;
  message: string | null;
  error: string | null;
  errorSummary?: string | null;
  createdAt: Date | string;
  template?: {
    id: string;
    name: string;
  } | null;
  product: {
    id: string;
    sku: string;
    productName: string;
    listingStatus: string | null;
    ebayItemId: string | null;
  } | null;
};

type ListingTemplate = {
  id: string;
  name: string;
  isDefault: boolean;
};

type ProductListingUploaderProps = {
  recentJobs: UploadJob[];
  templates: ListingTemplate[];
};

function formValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function statusClass(status: string) {
  if (status === "success") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (status === "failed") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  if (status === "running") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  return "bg-zinc-100 text-zinc-700 ring-zinc-200";
}

function inputClass() {
  return "h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900";
}

function PreviewPanel({ preview }: { preview: unknown }) {
  if (!preview) {
    return null;
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Eye className="h-4 w-4 text-zinc-700" />
        <h2 className="text-base font-semibold text-zinc-950">최종 payload 미리보기</h2>
      </div>
      <pre className="max-h-[520px] overflow-auto rounded-md bg-zinc-950 p-3 text-xs leading-5 text-zinc-50">
        {JSON.stringify(preview, null, 2)}
      </pre>
    </section>
  );
}

export function ProductListingUploader({
  recentJobs,
  templates,
}: ProductListingUploaderProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const defaultTemplateId = templates.find((template) => template.isDefault)?.id ?? "";
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [singleMessage, setSingleMessage] = useState("");
  const [excelMessage, setExcelMessage] = useState("");
  const [retryMessage, setRetryMessage] = useState("");
  const [singleLoading, setSingleLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const [preview, setPreview] = useState<unknown>(null);
  const sampleQuery = useMemo(
    () => (templateId ? `?templateId=${encodeURIComponent(templateId)}` : ""),
    [templateId],
  );

  async function submitSingle(previewOnly: boolean) {
    const formElement = formRef.current;

    if (!formElement) {
      return;
    }

    const form = new FormData(formElement);

    setSingleLoading(true);
    setSingleMessage("");
    const response = await fetch("/api/listings/upload/single", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        templateId: templateId || null,
        previewOnly,
        sku: formValue(form, "sku"),
        title: formValue(form, "title"),
        descriptionHtml: formValue(form, "descriptionHtml"),
        price: formValue(form, "price"),
        quantity: formValue(form, "quantity"),
        imageUrls: formValue(form, "imageUrls"),
        categoryId: formValue(form, "categoryId"),
        condition: formValue(form, "condition"),
        conditionDescription: formValue(form, "conditionDescription"),
        listingDuration: formValue(form, "listingDuration"),
        listingFormat: formValue(form, "listingFormat"),
        shippingProfile: formValue(form, "shippingProfile"),
        returnProfile: formValue(form, "returnProfile"),
        paymentProfile: formValue(form, "paymentProfile") || null,
        merchantLocationKey: formValue(form, "merchantLocationKey") || null,
        marketplaceId: formValue(form, "marketplaceId"),
        currency: formValue(form, "currency"),
        brand: formValue(form, "brand"),
        type: formValue(form, "type"),
        countryOfOrigin: formValue(form, "countryOfOrigin"),
        customLabel: formValue(form, "customLabel"),
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | {
          preview?: unknown;
          upload?: { error?: string; result?: { listingId?: string } };
          error?: string;
        }
      | null;

    setSingleLoading(false);

    if (response.ok && previewOnly) {
      setPreview(data?.preview ?? null);
      setSingleMessage("검증이 완료됐습니다.");
      return;
    }

    setSingleMessage(
      response.ok
        ? data?.upload && "error" in data.upload
          ? `실패: ${data.upload.error}`
          : `완료: ${data?.upload?.result?.listingId ?? "업로드됨"}`
        : data?.error ?? "상품 업로드 실패",
    );
    setPreview(data?.preview ?? null);
    router.refresh();
  }

  async function uploadExcel(
    event: React.ChangeEvent<HTMLInputElement>,
    previewOnly: boolean,
  ) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    setExcelLoading(true);
    setExcelMessage("");
    const form = new FormData();
    form.set("file", file);
    form.set("templateId", templateId);
    form.set("previewOnly", previewOnly ? "true" : "false");
    const response = await fetch("/api/listings/upload/excel", {
      method: "POST",
      body: form,
    });
    const data = (await response.json().catch(() => null)) as
      | {
          rows?: Array<{ preview?: unknown }>;
          created?: number;
          updated?: number;
          success?: number;
          failed?: number;
          skipped?: number;
          error?: string;
        }
      | null;

    setExcelLoading(false);
    event.currentTarget.value = "";

    if (response.ok && previewOnly) {
      setPreview(data?.rows ?? null);
      setExcelMessage(`검증 ${data?.rows?.length ?? 0}행${data?.skipped ? ` / 제외 ${data.skipped}` : ""}`);
      return;
    }

    setExcelMessage(
      response.ok
        ? `등록 ${data?.created ?? 0} / 수정 ${data?.updated ?? 0} / 성공 ${
            data?.success ?? 0
          } / 실패 ${data?.failed ?? 0}${data?.skipped ? ` / 제외 ${data.skipped}` : ""}`
        : data?.error ?? "엑셀 업로드 실패",
    );
    router.refresh();
  }

  async function retryFailed() {
    setRetryLoading(true);
    setRetryMessage("");
    const response = await fetch("/api/listings/upload/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allFailed: true }),
    });
    const data = (await response.json().catch(() => null)) as
      | { retried?: number; success?: number; failed?: number; error?: string }
      | null;

    setRetryLoading(false);
    setRetryMessage(
      response.ok
        ? `재시도 ${data?.retried ?? 0} / 성공 ${data?.success ?? 0} / 실패 ${
            data?.failed ?? 0
          }`
        : data?.error ?? "재시도 실패",
    );
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <label className="block min-w-[280px]">
            <span className="mb-1 block text-xs font-medium text-zinc-600">업로드 템플릿</span>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className={inputClass()}
            >
              <option value="">템플릿 없음</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.isDefault ? "[기본] " : ""}
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/products/templates"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              <Settings className="h-4 w-4" />
              템플릿 관리
            </Link>
            <a
              href={`/api/listings/upload/sample${sampleQuery}`}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
            <a
              href={`/api/listings/upload/sample${sampleQuery}${
                sampleQuery ? "&" : "?"
              }format=xlsx`}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              <Download className="h-4 w-4" />
              XLSX
            </a>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-zinc-950">엑셀 업로드</h2>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">
              <FileCheck2 className="h-4 w-4" />
              {excelLoading ? "처리 중" : "검증만"}
              <input
                type="file"
                accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(event) => uploadExcel(event, true)}
                className="sr-only"
              />
            </label>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800">
              <FileUp className="h-4 w-4" />
              {excelLoading ? "업로드 중" : "파일 선택"}
              <input
                type="file"
                accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(event) => uploadExcel(event, false)}
                className="sr-only"
              />
            </label>
          </div>
        </div>
        {excelMessage ? <p className="text-sm text-zinc-600">{excelMessage}</p> : null}
      </section>

      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          submitSingle(false);
        }}
        className="rounded-lg border border-zinc-200 bg-white p-4"
      >
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-zinc-950">단일 상품 등록</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => submitSingle(true)}
              disabled={singleLoading}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
            >
              <Eye className="h-4 w-4" />
              검증만
            </button>
            <button
              type="submit"
              disabled={singleLoading}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
            >
              <UploadCloud className="h-4 w-4" />
              {singleLoading ? "업로드 중" : "업로드"}
            </button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <input name="sku" placeholder="SKU" className={inputClass()} />
          <input name="title" placeholder="title" maxLength={80} className={inputClass()} />
          <input name="price" type="number" min="0" step="0.01" placeholder="price" className={inputClass()} />
          <input name="quantity" type="number" min="0" placeholder="quantity" className={inputClass()} />
          <input name="categoryId" placeholder="category_id" className={inputClass()} />
          <select name="condition" defaultValue="" className={inputClass()}>
            <option value="">template/default</option>
            <option value="NEW">NEW</option>
            <option value="LIKE_NEW">LIKE_NEW</option>
            <option value="USED_EXCELLENT">USED_EXCELLENT</option>
            <option value="USED_VERY_GOOD">USED_VERY_GOOD</option>
            <option value="USED_GOOD">USED_GOOD</option>
          </select>
          <input name="listingDuration" placeholder="listing_duration" className={inputClass()} />
          <input name="listingFormat" placeholder="listing_format" className={inputClass()} />
          <input name="shippingProfile" placeholder="fulfillment_policy_id" className={inputClass()} />
          <input name="returnProfile" placeholder="return_policy_id" className={inputClass()} />
          <input name="paymentProfile" placeholder="payment_policy_id" className={inputClass()} />
          <input name="merchantLocationKey" placeholder="merchant_location_key" className={inputClass()} />
          <input name="marketplaceId" placeholder="marketplace_id" className={inputClass()} />
          <input name="currency" placeholder="currency" className={inputClass()} />
          <input name="brand" placeholder="brand" className={inputClass()} />
          <input name="type" placeholder="type" className={inputClass()} />
          <input name="countryOfOrigin" placeholder="country_of_origin" className={inputClass()} />
          <input name="customLabel" placeholder="custom_label" className={inputClass()} />
          <textarea name="imageUrls" rows={3} placeholder="image_urls" className="md:col-span-2 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900" />
          <textarea name="descriptionHtml" rows={5} placeholder="description_html" className="md:col-span-2 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900" />
        </div>
        {singleMessage ? <p className="mt-3 text-sm text-zinc-600">{singleMessage}</p> : null}
      </form>

      <PreviewPanel preview={preview} />

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-zinc-950">업로드 상태</h2>
          <button
            type="button"
            onClick={retryFailed}
            disabled={retryLoading}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
          >
            <RefreshCw className="h-4 w-4" />
            실패 재시도
          </button>
        </div>
        {retryMessage ? <p className="mb-3 text-sm text-zinc-600">{retryMessage}</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">템플릿</th>
                <th className="px-3 py-2">작업</th>
                <th className="px-3 py-2">eBay Item ID</th>
                <th className="px-3 py-2">메시지</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {recentJobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-3 py-2 font-medium text-zinc-950">{job.sku}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusClass(job.status)}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-700">{job.template?.name ?? "-"}</td>
                  <td className="px-3 py-2 text-zinc-700">
                    {[job.source, job.action].filter(Boolean).join(" / ") || "-"}
                  </td>
                  <td className="px-3 py-2 text-zinc-700">
                    {job.product?.ebayItemId ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-zinc-700">
                    <span className="line-clamp-2" title={job.errorSummary ?? job.error ?? job.message ?? ""}>
                      {job.errorSummary ?? job.message ?? job.error ?? "-"}
                    </span>
                  </td>
                </tr>
              ))}
              {!recentJobs.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                    업로드 이력이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
