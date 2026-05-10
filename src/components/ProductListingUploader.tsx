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

type ValidationIssue = {
  field: string;
  message: string;
};

type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
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

function previewRows(preview: unknown) {
  const entries = Array.isArray(preview) ? preview : [preview];

  return entries
    .map((entry, index) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const finalValues =
        record.finalValues ??
        ((record.preview as Record<string, unknown> | undefined)?.finalValues);
      const values =
        finalValues && typeof finalValues === "object"
          ? (finalValues as Record<string, unknown>)
          : null;

      if (!values) {
        return null;
      }

      return {
        id: String(record.rowNumber ?? index + 1),
        sku: String(values.sku ?? ""),
        title: String(values.title ?? ""),
        price: String(values.price ?? ""),
        quantity: String(values.quantity ?? ""),
        categoryId: String(values.categoryId ?? ""),
        condition: String(values.condition ?? ""),
        policies: [
          values.paymentPolicyId,
          values.fulfillmentPolicyId,
          values.returnPolicyId,
        ]
          .filter(Boolean)
          .join(" / "),
        imageCount: Array.isArray(values.imageUrls) ? values.imageUrls.length : 0,
      };
    })
    .filter(Boolean) as Array<{
      id: string;
      sku: string;
      title: string;
      price: string;
      quantity: string;
      categoryId: string;
      condition: string;
      policies: string;
      imageCount: number;
    }>;
}

function PreviewPanel({ preview }: { preview: unknown }) {
  if (!preview) {
    return null;
  }
  const rows = previewRows(preview);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Eye className="h-4 w-4 text-zinc-700" />
        <h2 className="text-base font-semibold text-zinc-950">최종 payload 미리보기</h2>
      </div>
      {rows.length ? (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">행</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">title</th>
                <th className="px-3 py-2">price</th>
                <th className="px-3 py-2">quantity</th>
                <th className="px-3 py-2">category</th>
                <th className="px-3 py-2">condition</th>
                <th className="px-3 py-2">policy ids</th>
                <th className="px-3 py-2">images</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-zinc-600">{row.id}</td>
                  <td className="px-3 py-2 font-medium text-zinc-950">{row.sku}</td>
                  <td className="px-3 py-2 text-zinc-700">{row.title}</td>
                  <td className="px-3 py-2 text-zinc-700">{row.price}</td>
                  <td className="px-3 py-2 text-zinc-700">{row.quantity}</td>
                  <td className="px-3 py-2 text-zinc-700">{row.categoryId}</td>
                  <td className="px-3 py-2 text-zinc-700">{row.condition}</td>
                  <td className="px-3 py-2 text-zinc-700">{row.policies}</td>
                  <td className="px-3 py-2 text-zinc-700">{row.imageCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <pre className="max-h-[520px] overflow-auto rounded-md bg-zinc-950 p-3 text-xs leading-5 text-zinc-50">
        {JSON.stringify(preview, null, 2)}
      </pre>
    </section>
  );
}

function ValidationPanel({ validation }: { validation: ValidationResult | null }) {
  if (!validation) {
    return null;
  }

  return (
    <section
      className={`rounded-lg border p-4 ${
        validation.valid
          ? "border-emerald-200 bg-emerald-50"
          : "border-rose-200 bg-rose-50"
      }`}
    >
      <h2
        className={`text-base font-semibold ${
          validation.valid ? "text-emerald-800" : "text-rose-800"
        }`}
      >
        검증 결과
      </h2>
      {validation.valid ? (
        <p className="mt-2 text-sm text-emerald-700">업로드에 필요한 값이 준비됐습니다.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-rose-700">
          {validation.issues.map((issue, index) => (
            <li key={`${issue.field}-${index}`}>
              {issue.field}: {issue.message}
            </li>
          ))}
        </ul>
      )}
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
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showFailedOnly, setShowFailedOnly] = useState(false);
  const sampleQuery = useMemo(
    () => (templateId ? `?templateId=${encodeURIComponent(templateId)}` : ""),
    [templateId],
  );
  const visibleJobs = useMemo(
    () => (showFailedOnly ? recentJobs.filter((job) => job.status === "failed") : recentJobs),
    [recentJobs, showFailedOnly],
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
          validation?: ValidationResult;
          details?: ValidationResult;
          upload?: { error?: string; result?: { listingId?: string } };
          error?: string;
        }
      | null;

    setSingleLoading(false);

    if (response.ok && previewOnly) {
      setPreview(data?.preview ?? null);
      setValidation(data?.validation ?? null);
      setSingleMessage(
        data?.validation?.valid === false
          ? "검증에서 수정할 항목이 발견됐습니다."
          : "검증이 완료됐습니다.",
      );
      return;
    }

    setValidation(data?.validation ?? data?.details ?? null);
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
          errors?: string[];
        }
      | null;

    setExcelLoading(false);
    event.currentTarget.value = "";

    if (response.ok && previewOnly) {
      setPreview(data?.rows ?? null);
      const rowValidations = data?.rows
        ?.map((row) => (row as { validation?: ValidationResult }).validation)
        .filter(Boolean) as ValidationResult[] | undefined;
      const issues = rowValidations?.flatMap((result) => result.issues) ?? [];
      setValidation({ valid: issues.length === 0, issues });
      setExcelMessage(`검증 ${data?.rows?.length ?? 0}행${data?.skipped ? ` / 제외 ${data.skipped}` : ""}`);
      return;
    }

    setExcelMessage(
      response.ok
        ? `등록 ${data?.created ?? 0} / 수정 ${data?.updated ?? 0} / 성공 ${
            data?.success ?? 0
          } / 실패 ${data?.failed ?? 0}${data?.skipped ? ` / 제외 ${data.skipped}` : ""}`
        : data?.error ?? data?.errors?.join(" / ") ?? "엑셀 업로드 실패",
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
      <ValidationPanel validation={validation} />

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-zinc-950">업로드 상태</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowFailedOnly((current) => !current)}
              className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              {showFailedOnly ? "전체 보기" : "실패 항목만 보기"}
            </button>
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
              {visibleJobs.map((job) => (
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
              {!visibleJobs.length ? (
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
