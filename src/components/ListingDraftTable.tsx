"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  RefreshCcw,
  Save,
  Square,
  UploadCloud,
  X,
} from "lucide-react";

type DraftRow = {
  id: string;
  sourceInventoryId: string | null;
  sku: string;
  title: string;
  subtitle: string | null;
  descriptionHtml: string | null;
  price: string | number | null;
  quantity: number | null;
  imageUrlsJson: unknown;
  categoryId: string | null;
  condition: string | null;
  conditionDescription: string | null;
  itemSpecificsJson: unknown;
  marketplaceId: string | null;
  currency: string | null;
  paymentPolicyId: string | null;
  fulfillmentPolicyId: string | null;
  returnPolicyId: string | null;
  merchantLocationKey: string | null;
  bestOfferEnabled: boolean;
  minimumOfferPrice: string | number | null;
  autoAcceptPrice: string | number | null;
  privateListing: boolean;
  immediatePayRequired: boolean;
  listingFormat: string | null;
  status: string;
  ebayItemId: string | null;
  offerId: string | null;
  listingStatus: string | null;
  errorSummary: string | null;
  validationJson: unknown;
  rawErrorJson: unknown;
  fieldSourceJson: unknown;
  lastUploadedAt: string | null;
  updatedAt: string;
  template: { id: string; name: string } | null;
  sourceInventory: {
    id: string;
    sku: string;
    productName: string;
    stockQuantity: number;
    imageUrl: string | null;
    ebayItemId: string | null;
    ebayOfferId: string | null;
    listingStatus: string | null;
  } | null;
};

function jsonArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
}

function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstImage(draft: DraftRow) {
  return jsonArray(draft.imageUrlsJson)[0] ?? draft.sourceInventory?.imageUrl ?? null;
}

function textValue(value: unknown) {
  return String(value ?? "").trim();
}

function requiredMissingFields(draft: DraftRow) {
  const missing: string[] = [];

  if (!textValue(draft.sku)) missing.push("SKU");
  if (!textValue(draft.title)) missing.push("title");
  if (!textValue(draft.price)) missing.push("price");
  if (draft.quantity === null || draft.quantity === undefined) missing.push("quantity");
  if (!jsonArray(draft.imageUrlsJson).length) missing.push("image_urls");
  if (!textValue(draft.categoryId)) missing.push("category_id");
  if (!textValue(draft.condition)) missing.push("condition");
  if (!textValue(draft.paymentPolicyId)) missing.push("payment_policy_id");
  if (!textValue(draft.fulfillmentPolicyId)) missing.push("fulfillment_policy_id");
  if (!textValue(draft.returnPolicyId)) missing.push("return_policy_id");
  if (!textValue(draft.merchantLocationKey)) missing.push("merchant_location_key");

  return missing;
}

function validationIssues(draft: DraftRow) {
  const validation = jsonObject(draft.validationJson);
  const issues = Array.isArray(validation.issues) ? validation.issues : [];

  return issues
    .filter((issue) => issue && typeof issue === "object" && !Array.isArray(issue))
    .map((issue) => {
      const record = issue as Record<string, unknown>;
      return {
        field: textValue(record.field) || "input",
        message: textValue(record.message) || "입력값을 확인해 주세요.",
      };
    });
}

function validationPassed(draft: DraftRow) {
  return jsonObject(draft.validationJson).valid === true;
}

function hasValidationIssue(draft: DraftRow, fieldPrefix: string) {
  return validationIssues(draft).some((issue) => issue.field.startsWith(fieldPrefix));
}

function hasExistingListing(draft: DraftRow) {
  return Boolean(
    draft.offerId ||
      draft.ebayItemId ||
      draft.sourceInventory?.ebayOfferId ||
      draft.sourceInventory?.ebayItemId,
  );
}

function sourceLabel(draft: DraftRow, field: string) {
  const source = textValue(jsonObject(draft.fieldSourceJson)[field]);

  if (source === "template") {
    return "템플릿 적용";
  }

  if (source === "manual") {
    return "직접 수정";
  }

  if (source === "inventory") {
    return "재고값";
  }

  if (source === "excel") {
    return "엑셀값";
  }

  return "";
}

function SourceBadge({ draft, field }: { draft: DraftRow; field: string }) {
  const label = sourceLabel(draft, field);

  if (!label) {
    return null;
  }

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
        label === "직접 수정"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : label === "템플릿 적용"
            ? "bg-blue-50 text-blue-700 ring-blue-200"
            : "bg-zinc-50 text-zinc-600 ring-zinc-200"
      }`}
    >
      {label}
    </span>
  );
}

function statusClass(status: string) {
  if (status === "uploaded") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (status === "failed") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  if (status === "validated") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  if (status === "uploading") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  return "bg-zinc-50 text-zinc-700 ring-zinc-200";
}

function EditableCell({
  value,
  onChange,
  className = "",
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  type?: string;
}) {
  return (
    <input
      value={value}
      type={type}
      onChange={(event) => onChange(event.target.value)}
      className={`h-9 rounded-md border border-zinc-300 px-2 text-sm outline-none focus:border-zinc-900 ${className}`}
    />
  );
}

function EditableArea({
  value,
  onChange,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm outline-none focus:border-zinc-900"
    />
  );
}

function ToggleInput({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-2 text-xs text-zinc-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function ListingDraftTable({
  drafts,
  failedOnly = false,
  showRetryAll = false,
  ebayEnvironment = null,
}: {
  drafts: DraftRow[];
  failedOnly?: boolean;
  showRetryAll?: boolean;
  ebayEnvironment?: string | null;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [edits, setEdits] = useState<
    Record<string, Record<string, string | boolean>>
  >({});
  const [bulk, setBulk] = useState({
    price: "",
    quantity: "",
    categoryId: "",
    condition: "",
    paymentPolicyId: "",
    fulfillmentPolicyId: "",
    returnPolicyId: "",
    merchantLocationKey: "",
    templateId: "",
    titlePrefix: "",
    titleSuffix: "",
    imageUrlPrefix: "",
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmUploadOpen, setConfirmUploadOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedDrafts = useMemo(
    () => drafts.filter((draft) => selectedSet.has(draft.id)),
    [drafts, selectedSet],
  );
  const selectedUploadPlan = useMemo(() => {
    const missingOrInvalid = selectedDrafts.filter(
      (draft) => requiredMissingFields(draft).length || draft.status === "failed",
    ).length;
    const revise = selectedDrafts.filter(hasExistingListing).length;

    return {
      total: selectedDrafts.length,
      create: selectedDrafts.length - revise,
      revise,
      expectedFailure: missingOrInvalid,
      validated: selectedDrafts.filter(validationPassed).length,
      imageChecked: selectedDrafts.filter(
        (draft) => draft.validationJson && !hasValidationIssue(draft, "image_urls"),
      ).length,
      policyReady: selectedDrafts.filter(
        (draft) =>
          textValue(draft.paymentPolicyId) &&
          textValue(draft.fulfillmentPolicyId) &&
          textValue(draft.returnPolicyId),
      ).length,
      locationReady: selectedDrafts.filter((draft) =>
        textValue(draft.merchantLocationKey),
      ).length,
      oauthChecked: selectedDrafts.filter(
        (draft) => draft.validationJson && !hasValidationIssue(draft, "oauth"),
      ).length,
      noSkuIssue: selectedDrafts.filter(
        (draft) => draft.validationJson && !hasValidationIssue(draft, "sku"),
      ).length,
    };
  }, [selectedDrafts]);
  const summary = useMemo(
    () => ({
      uploaded: drafts.filter((draft) => draft.status === "uploaded").length,
      failed: drafts.filter((draft) => draft.status === "failed").length,
      uploading: drafts.filter((draft) => draft.status === "uploading").length,
      pending: drafts.filter((draft) =>
        ["draft", "validated"].includes(draft.status),
      ).length,
    }),
    [drafts],
  );

  function value(id: string, key: string) {
    const draft = drafts.find((entry) => entry.id === id);
    const edited = edits[id]?.[key];

    if (edited !== undefined) {
      return String(edited);
    }

    if (draft && key === "imageUrls") {
      return jsonArray(draft.imageUrlsJson).join("\n");
    }

    if (draft && key === "itemSpecifics") {
      return JSON.stringify(jsonObject(draft.itemSpecificsJson), null, 2);
    }

    if (draft && key in draft) {
      return String((draft as unknown as Record<string, unknown>)[key] ?? "");
    }

    return "";
  }

  function checkedValue(id: string, key: string) {
    const draft = drafts.find((entry) => entry.id === id);
    const edited = edits[id]?.[key];

    if (typeof edited === "boolean") {
      return edited;
    }

    if (draft && key in draft) {
      return Boolean((draft as unknown as Record<string, unknown>)[key]);
    }

    return false;
  }

  function setEdit(id: string, key: string, next: string | boolean) {
    setEdits((current) => ({
      ...current,
      [id]: { ...current[id], [key]: next },
    }));
  }

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  function toggleAll() {
    setSelectedIds((current) =>
      current.length === drafts.length ? [] : drafts.map((draft) => draft.id),
    );
  }

  async function saveDraft(id: string) {
    const patch = edits[id];

    if (!patch) {
      return;
    }

    setBusy(`save-${id}`);
    setMessage("");
    const response = await fetch(`/api/listing-upload/drafts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusy("");

    if (!response.ok) {
      setMessage(data?.error ?? "Draft 저장 실패");
      return;
    }

    setEdits((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setMessage("Draft를 저장했습니다.");
    router.refresh();
  }

  async function postAction(
    endpoint: string,
    body: Record<string, unknown>,
    successText: string,
  ) {
    if (!selectedIds.length && endpoint !== "/api/listing-upload/drafts/retry-failed") {
      setMessage("Draft를 하나 이상 선택해 주세요.");
      return;
    }

    setBusy(endpoint);
    setMessage("");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string; uploaded?: number; failed?: number; retried?: number }
      | null;
    setBusy("");

    if (!response.ok) {
      setMessage(data?.error ?? "처리 실패");
      return;
    }

    setMessage(
      data?.uploaded !== undefined || data?.failed !== undefined
        ? `${successText}: 성공 ${data.uploaded ?? 0}건, 실패 ${data.failed ?? 0}건`
        : successText,
    );
    router.refresh();
  }

  async function applyBulkUpdate() {
    const payload = Object.fromEntries(
      Object.entries(bulk).filter(([, value]) => value.trim()),
    );

    await postAction(
      "/api/listing-upload/drafts/bulk-update",
      { ids: selectedIds, ...payload },
      "일괄 수정 완료",
    );
  }

  function openUploadConfirm() {
    if (!selectedIds.length) {
      setMessage("Draft를 하나 이상 선택해 주세요.");
      return;
    }

    setConfirmUploadOpen(true);
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-zinc-200 p-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs font-medium text-zinc-500">대기</p>
            <p className="mt-1 text-xl font-semibold text-zinc-950">
              {summary.pending}
            </p>
          </div>
          <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
            <p className="text-xs font-medium text-blue-700">업로드중</p>
            <p className="mt-1 text-xl font-semibold text-blue-900">
              {summary.uploading}
            </p>
          </div>
          <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
            <p className="text-xs font-medium text-emerald-700">성공</p>
            <p className="mt-1 text-xl font-semibold text-emerald-900">
              {summary.uploaded}
            </p>
          </div>
          <div className="rounded-md border border-rose-100 bg-rose-50 p-3">
            <p className="text-xs font-medium text-rose-700">실패</p>
            <p className="mt-1 text-xl font-semibold text-rose-900">
              {summary.failed}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleAll}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            {selectedIds.length === drafts.length && drafts.length ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            전체 선택
          </button>
          <button
            type="button"
            onClick={() =>
              postAction(
                "/api/listing-upload/drafts/validate",
                { ids: selectedIds },
                "검증 완료",
              )
            }
            disabled={Boolean(busy)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400"
          >
            <CheckCircle2 className="h-4 w-4" />
            검증
          </button>
          <button
            type="button"
            onClick={openUploadConfirm}
            disabled={Boolean(busy)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-400"
          >
            <UploadCloud className="h-4 w-4" />
            eBay 업로드
          </button>
          {failedOnly || showRetryAll ? (
            <button
              type="button"
              onClick={() =>
                postAction(
                  "/api/listing-upload/drafts/retry-failed",
                  {},
                  "실패 재시도 완료",
                )
              }
              disabled={Boolean(busy)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400"
            >
              <RefreshCcw className="h-4 w-4" />
              전체 실패 재시도
            </button>
          ) : null}
          <a
            href={`/api/listing-upload/jobs/export${failedOnly ? "?status=failed" : ""}`}
            className="inline-flex h-9 items-center rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            CSV
          </a>
          <span className="text-sm text-zinc-600">
            선택 {selectedIds.length} / 표시 {drafts.length}
          </span>
          {message ? <span className="text-sm text-zinc-950">{message}</span> : null}
        </div>

        <div className="grid gap-2 md:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <EditableCell
            value={bulk.price}
            onChange={(next) => setBulk((current) => ({ ...current, price: next }))}
            className="w-full"
            type="number"
          />
          <EditableCell
            value={bulk.quantity}
            onChange={(next) => setBulk((current) => ({ ...current, quantity: next }))}
            className="w-full"
            type="number"
          />
          <EditableCell
            value={bulk.categoryId}
            onChange={(next) => setBulk((current) => ({ ...current, categoryId: next }))}
            className="w-full"
          />
          <EditableCell
            value={bulk.condition}
            onChange={(next) => setBulk((current) => ({ ...current, condition: next }))}
            className="w-full"
          />
          <button
            type="button"
            onClick={applyBulkUpdate}
            className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            일괄 적용
          </button>
        </div>
        <div className="grid gap-2 text-xs text-zinc-500 md:grid-cols-4">
          <span>price</span>
          <span>quantity</span>
          <span>category_id</span>
          <span>condition</span>
        </div>

        <div className="grid gap-2 md:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
          <EditableCell
            value={bulk.paymentPolicyId}
            onChange={(next) =>
              setBulk((current) => ({ ...current, paymentPolicyId: next }))
            }
            className="w-full"
          />
          <EditableCell
            value={bulk.fulfillmentPolicyId}
            onChange={(next) =>
              setBulk((current) => ({ ...current, fulfillmentPolicyId: next }))
            }
            className="w-full"
          />
          <EditableCell
            value={bulk.returnPolicyId}
            onChange={(next) =>
              setBulk((current) => ({ ...current, returnPolicyId: next }))
            }
            className="w-full"
          />
          <EditableCell
            value={bulk.merchantLocationKey}
            onChange={(next) =>
              setBulk((current) => ({ ...current, merchantLocationKey: next }))
            }
            className="w-full"
          />
          <EditableCell
            value={bulk.templateId}
            onChange={(next) => setBulk((current) => ({ ...current, templateId: next }))}
            className="w-full"
          />
          <button
            type="button"
            onClick={applyBulkUpdate}
            className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            일괄 적용
          </button>
        </div>
        <div className="grid gap-2 text-xs text-zinc-500 md:grid-cols-5">
          <span>payment_policy_id</span>
          <span>fulfillment_policy_id</span>
          <span>return_policy_id</span>
          <span>merchant_location_key</span>
          <span>template_id</span>
        </div>

        <div className="grid gap-2 md:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          <EditableCell
            value={bulk.titlePrefix}
            onChange={(next) =>
              setBulk((current) => ({ ...current, titlePrefix: next }))
            }
            className="w-full"
          />
          <EditableCell
            value={bulk.titleSuffix}
            onChange={(next) =>
              setBulk((current) => ({ ...current, titleSuffix: next }))
            }
            className="w-full"
          />
          <EditableCell
            value={bulk.imageUrlPrefix}
            onChange={(next) =>
              setBulk((current) => ({ ...current, imageUrlPrefix: next }))
            }
            className="w-full"
          />
          <button
            type="button"
            onClick={applyBulkUpdate}
            className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            문구/이미지 적용
          </button>
        </div>
        <div className="grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
          <span>title_prefix</span>
          <span>title_suffix</span>
          <span>image_url_prefix</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1180px] divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
            <tr>
              <th className="w-12 px-3 py-2">선택</th>
              <th className="px-3 py-2">상품</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">가격</th>
              <th className="px-3 py-2">수량</th>
              <th className="px-3 py-2">카테고리</th>
              <th className="px-3 py-2">정책/위치</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2">저장</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {drafts.map((draft) => {
              const image = firstImage(draft);
              const changed = Boolean(edits[draft.id]);
              const missingFields = requiredMissingFields(draft);
              const issues = validationIssues(draft);

              return (
                <tr
                  key={draft.id}
                  className={`align-top hover:bg-zinc-50 ${
                    missingFields.length || issues.length
                      ? "bg-rose-50/30"
                      : ""
                  }`}
                >
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => toggle(draft.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                      aria-label="Draft 선택"
                    >
                      {selectedSet.has(draft.id) ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="min-w-[300px] px-3 py-3">
                    <div className="flex gap-3">
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image}
                          alt=""
                          className="h-14 w-14 rounded-md object-cover"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-md bg-zinc-100" />
                      )}
                      <div className="min-w-0 flex-1 space-y-2">
                        <EditableCell
                          value={value(draft.id, "title")}
                          onChange={(next) => setEdit(draft.id, "title", next)}
                          className="w-full"
                        />
                        <div className="flex flex-wrap gap-1">
                          <SourceBadge draft={draft} field="title" />
                          {draft.template ? (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 ring-1 ring-zinc-200">
                              템플릿 {draft.template.name}
                            </span>
                          ) : null}
                        </div>
                        {missingFields.length ? (
                          <div className="flex flex-wrap gap-1">
                            {missingFields.map((field) => (
                              <span
                                key={field}
                                className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200"
                              >
                                누락 {field}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="text-xs text-zinc-500">
                          {draft.sourceInventory ? (
                            <Link
                              href={`/products/${draft.sourceInventory.id}`}
                              className="hover:underline"
                            >
                              재고 {draft.sourceInventory.sku} / 잔여{" "}
                              {draft.sourceInventory.stockQuantity}
                            </Link>
                          ) : (
                            "재고 미연결"
                          )}
                        </div>
                        <details className="rounded-md bg-zinc-50 p-2">
                          <summary className="cursor-pointer text-xs font-semibold text-zinc-700">
                            상세 편집
                          </summary>
                          <div className="mt-3 grid gap-3">
                            <div className="grid gap-2 md:grid-cols-3">
                              <label className="block">
                                <span className="mb-1 block text-xs text-zinc-500">
                                  subtitle
                                </span>
                                <EditableCell
                                  value={value(draft.id, "subtitle")}
                                  onChange={(next) => setEdit(draft.id, "subtitle", next)}
                                  className="w-full"
                                />
                                <SourceBadge draft={draft} field="subtitle" />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-zinc-500">
                                  marketplace_id
                                </span>
                                <EditableCell
                                  value={value(draft.id, "marketplaceId")}
                                  onChange={(next) =>
                                    setEdit(draft.id, "marketplaceId", next)
                                  }
                                  className="w-full"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-zinc-500">
                                  listing_format
                                </span>
                                <EditableCell
                                  value={value(draft.id, "listingFormat")}
                                  onChange={(next) =>
                                    setEdit(draft.id, "listingFormat", next)
                                  }
                                  className="w-full"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-zinc-500">
                                  currency
                                </span>
                                <EditableCell
                                  value={value(draft.id, "currency")}
                                  onChange={(next) => setEdit(draft.id, "currency", next)}
                                  className="w-full"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-zinc-500">
                                  payment_policy_id
                                </span>
                                <EditableCell
                                  value={value(draft.id, "paymentPolicyId")}
                                  onChange={(next) =>
                                    setEdit(draft.id, "paymentPolicyId", next)
                                  }
                                  className="w-full"
                                />
                                <SourceBadge draft={draft} field="paymentPolicyId" />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-zinc-500">
                                  return_policy_id
                                </span>
                                <EditableCell
                                  value={value(draft.id, "returnPolicyId")}
                                  onChange={(next) =>
                                    setEdit(draft.id, "returnPolicyId", next)
                                  }
                                  className="w-full"
                                />
                                <SourceBadge draft={draft} field="returnPolicyId" />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-zinc-500">
                                  minimum_offer_price
                                </span>
                                <EditableCell
                                  value={value(draft.id, "minimumOfferPrice")}
                                  onChange={(next) =>
                                    setEdit(draft.id, "minimumOfferPrice", next)
                                  }
                                  className="w-full"
                                  type="number"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-zinc-500">
                                  auto_accept_price
                                </span>
                                <EditableCell
                                  value={value(draft.id, "autoAcceptPrice")}
                                  onChange={(next) =>
                                    setEdit(draft.id, "autoAcceptPrice", next)
                                  }
                                  className="w-full"
                                  type="number"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-xs text-zinc-500">
                                  condition_description
                                </span>
                                <EditableCell
                                  value={value(draft.id, "conditionDescription")}
                                  onChange={(next) =>
                                    setEdit(draft.id, "conditionDescription", next)
                                  }
                                  className="w-full"
                                />
                              </label>
                            </div>
                            <div className="grid gap-2 md:grid-cols-3">
                              <ToggleInput
                                label="best_offer"
                                checked={checkedValue(draft.id, "bestOfferEnabled")}
                                onChange={(next) =>
                                  setEdit(draft.id, "bestOfferEnabled", next)
                                }
                              />
                              <ToggleInput
                                label="private_listing"
                                checked={checkedValue(draft.id, "privateListing")}
                                onChange={(next) =>
                                  setEdit(draft.id, "privateListing", next)
                                }
                              />
                              <ToggleInput
                                label="immediate_pay"
                                checked={checkedValue(draft.id, "immediatePayRequired")}
                                onChange={(next) =>
                                  setEdit(draft.id, "immediatePayRequired", next)
                                }
                              />
                            </div>
                            <label className="block">
                              <span className="mb-1 block text-xs text-zinc-500">
                                image_urls
                              </span>
                              <EditableArea
                                value={value(draft.id, "imageUrls")}
                                onChange={(next) => setEdit(draft.id, "imageUrls", next)}
                              />
                              <SourceBadge draft={draft} field="imageUrls" />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-xs text-zinc-500">
                                description_html
                              </span>
                              <EditableArea
                                value={value(draft.id, "descriptionHtml")}
                                onChange={(next) =>
                                  setEdit(draft.id, "descriptionHtml", next)
                                }
                                rows={4}
                              />
                              <SourceBadge draft={draft} field="descriptionHtml" />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-xs text-zinc-500">
                                item_specifics_json
                              </span>
                              <EditableArea
                                value={value(draft.id, "itemSpecifics")}
                                onChange={(next) =>
                                  setEdit(draft.id, "itemSpecifics", next)
                                }
                                rows={4}
                              />
                              <SourceBadge draft={draft} field="itemSpecifics" />
                            </label>
                            {issues.length ? (
                              <div className="rounded-md border border-rose-200 bg-rose-50 p-2">
                                <p className="text-xs font-semibold text-rose-800">
                                  검증 실패 항목
                                </p>
                                <ul className="mt-1 space-y-1 text-xs text-rose-700">
                                  {issues.map((issue) => (
                                    <li key={`${issue.field}-${issue.message}`}>
                                      {issue.field}: {issue.message}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <EditableCell
                      value={value(draft.id, "sku")}
                      onChange={(next) => setEdit(draft.id, "sku", next)}
                      className="w-36 font-mono text-xs"
                    />
                    <div className="mt-1">
                      <SourceBadge draft={draft} field="sku" />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <EditableCell
                      value={value(draft.id, "price")}
                      onChange={(next) => setEdit(draft.id, "price", next)}
                      className="w-24"
                      type="number"
                    />
                    <div className="mt-1">
                      <SourceBadge draft={draft} field="price" />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <EditableCell
                      value={value(draft.id, "quantity")}
                      onChange={(next) => setEdit(draft.id, "quantity", next)}
                      className="w-20"
                      type="number"
                    />
                    <div className="mt-1">
                      <SourceBadge draft={draft} field="quantity" />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="grid gap-2">
                      <EditableCell
                        value={value(draft.id, "categoryId")}
                        onChange={(next) => setEdit(draft.id, "categoryId", next)}
                        className="w-32"
                      />
                      <SourceBadge draft={draft} field="categoryId" />
                      <EditableCell
                        value={value(draft.id, "condition")}
                        onChange={(next) => setEdit(draft.id, "condition", next)}
                        className="w-32"
                      />
                      <SourceBadge draft={draft} field="condition" />
                    </div>
                  </td>
                  <td className="min-w-[220px] px-3 py-3">
                    <div className="grid gap-2">
                      <EditableCell
                        value={value(draft.id, "fulfillmentPolicyId")}
                        onChange={(next) =>
                          setEdit(draft.id, "fulfillmentPolicyId", next)
                        }
                        className="w-full"
                      />
                      <SourceBadge draft={draft} field="fulfillmentPolicyId" />
                      <EditableCell
                        value={value(draft.id, "merchantLocationKey")}
                        onChange={(next) =>
                          setEdit(draft.id, "merchantLocationKey", next)
                        }
                        className="w-full"
                      />
                      <SourceBadge draft={draft} field="merchantLocationKey" />
                    </div>
                  </td>
                  <td className="min-w-[210px] px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusClass(
                        draft.status,
                      )}`}
                    >
                      {draft.status}
                    </span>
                    <div className="mt-2 text-xs text-zinc-600">
                      {draft.ebayItemId ? <p>item {draft.ebayItemId}</p> : null}
                      {draft.offerId ? <p>offer {draft.offerId}</p> : null}
                      {draft.errorSummary ? (
                        <p className="max-w-[240px] whitespace-pre-wrap text-rose-700">
                          {draft.errorSummary}
                        </p>
                      ) : null}
                      {draft.validationJson ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer font-semibold text-zinc-700">
                            검증/미리보기
                          </summary>
                          <pre className="mt-1 max-h-64 max-w-[260px] overflow-auto rounded-md bg-zinc-100 p-2 text-[11px] text-zinc-700">
                            {JSON.stringify(draft.validationJson, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                      {draft.rawErrorJson ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer font-semibold text-rose-700">
                            eBay 오류
                          </summary>
                          <pre className="mt-1 max-h-64 max-w-[260px] overflow-auto rounded-md bg-rose-50 p-2 text-[11px] text-rose-800">
                            {JSON.stringify(draft.rawErrorJson, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => saveDraft(draft.id)}
                      disabled={!changed || busy === `save-${draft.id}`}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400"
                    >
                      <Save className="h-4 w-4" />
                      저장
                    </button>
                  </td>
                </tr>
              );
            })}
            {!drafts.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-zinc-500">
                  표시할 draft가 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {confirmUploadOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-zinc-200 p-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-950">
                  eBay 실제 업로드 확인
                </h2>
                <p className="mt-1 text-sm text-rose-700">
                  실제 eBay에 상품이 등록/수정됩니다.
                </p>
                <p className="mt-1 text-xs font-semibold text-zinc-600">
                  현재 환경: {ebayEnvironment === "PRODUCTION" ? "Production" : ebayEnvironment ?? "미확인"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmUploadOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-4">
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="rounded-md border border-zinc-200 p-3">
                  <p className="text-xs text-zinc-500">대상</p>
                  <p className="mt-1 text-xl font-semibold">
                    {selectedUploadPlan.total}
                  </p>
                </div>
                <div className="rounded-md border border-zinc-200 p-3">
                  <p className="text-xs text-zinc-500">신규등록</p>
                  <p className="mt-1 text-xl font-semibold">
                    {selectedUploadPlan.create}
                  </p>
                </div>
                <div className="rounded-md border border-zinc-200 p-3">
                  <p className="text-xs text-zinc-500">수정등록</p>
                  <p className="mt-1 text-xl font-semibold">
                    {selectedUploadPlan.revise}
                  </p>
                </div>
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
                  <p className="text-xs text-rose-700">실패 예상</p>
                  <p className="mt-1 text-xl font-semibold text-rose-800">
                    {selectedUploadPlan.expectedFailure}
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-zinc-200 p-3">
                <p className="mb-2 text-sm font-semibold text-zinc-900">
                  업로드 전 최종 체크리스트
                </p>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <span>검증 통과 {selectedUploadPlan.validated}/{selectedUploadPlan.total}</span>
                  <span>
                    이미지 URL 접근 확인 {selectedUploadPlan.imageChecked}/
                    {selectedUploadPlan.total}
                  </span>
                  <span>정책 ID 존재 {selectedUploadPlan.policyReady}/{selectedUploadPlan.total}</span>
                  <span>
                    merchantLocationKey 존재 {selectedUploadPlan.locationReady}/
                    {selectedUploadPlan.total}
                  </span>
                  <span>OAuth scope 확인 {selectedUploadPlan.oauthChecked}/{selectedUploadPlan.total}</span>
                  <span>SKU 중복 이슈 없음 {selectedUploadPlan.noSkuIssue}/{selectedUploadPlan.total}</span>
                  <span>기존 offer 저장값 {selectedUploadPlan.revise}/{selectedUploadPlan.total}</span>
                </div>
              </div>

              {selectedUploadPlan.expectedFailure ? (
                <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  필수값 누락 또는 실패 상태인 draft가 포함되어 있습니다. 그래도 업로드를 실행하면
                  eBay API 오류로 실패할 수 있습니다.
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-200 p-4">
              <button
                type="button"
                onClick={() => setConfirmUploadOpen(false)}
                className="h-10 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmUploadOpen(false);
                  void postAction(
                    "/api/listing-upload/drafts/upload",
                    { ids: selectedIds },
                    "업로드 완료",
                  );
                }}
                className="h-10 rounded-md bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-800"
              >
                실제 eBay 업로드 실행
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
