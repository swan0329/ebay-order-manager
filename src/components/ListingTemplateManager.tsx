"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Save, Star, Trash2 } from "lucide-react";

type Template = {
  id: string;
  name: string;
  description: string | null;
  marketplaceId: string | null;
  categoryId: string | null;
  condition: string | null;
  conditionDescription: string | null;
  listingDuration: string | null;
  listingFormat: string | null;
  currency: string | null;
  defaultQuantity: number | null;
  defaultPrice: string | number | null;
  paymentPolicyId: string | null;
  fulfillmentPolicyId: string | null;
  returnPolicyId: string | null;
  merchantLocationKey: string | null;
  bestOfferEnabled: boolean;
  minimumOfferPrice: string | number | null;
  autoAcceptPrice: string | number | null;
  privateListing: boolean;
  immediatePayRequired: boolean;
  descriptionTemplateHtml: string | null;
  itemSpecificsTemplateJson: unknown;
  imageSettingsJson: unknown;
  shippingSettingsJson: unknown;
  skuSettingsJson: unknown;
  titleTemplate: string | null;
  excludedLocationsJson: unknown;
  isDefault: boolean;
};

type PolicyOption = { id: string; name: string };
type Policies = {
  paymentPolicies: PolicyOption[];
  fulfillmentPolicies: PolicyOption[];
  returnPolicies: PolicyOption[];
  inventoryLocations: PolicyOption[];
};

type FormState = {
  name: string;
  description: string;
  marketplaceId: string;
  categoryId: string;
  condition: string;
  conditionDescription: string;
  listingDuration: string;
  listingFormat: string;
  currency: string;
  defaultQuantity: string;
  defaultPrice: string;
  paymentPolicyId: string;
  fulfillmentPolicyId: string;
  returnPolicyId: string;
  merchantLocationKey: string;
  shippingService: string;
  handlingTime: string;
  internationalShippingEnabled: boolean;
  excludedLocations: string;
  bestOfferEnabled: boolean;
  minimumOfferPrice: string;
  autoAcceptPrice: string;
  privateListing: boolean;
  immediatePayRequired: boolean;
  titleTemplate: string;
  descriptionTemplateHtml: string;
  itemSpecificsTemplate: string;
  brand: string;
  type: string;
  countryOfOrigin: string;
  customLabel: string;
  defaultImageUrl: string;
  imageUrlMode: string;
  maxImages: string;
  r2UrlPrefix: string;
  skuPrefix: string;
  autoGenerateSku: boolean;
  inventoryTrackingEnabled: boolean;
  outOfStockControl: boolean;
  isDefault: boolean;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  marketplaceId: "EBAY_US",
  categoryId: "",
  condition: "NEW",
  conditionDescription: "",
  listingDuration: "GTC",
  listingFormat: "FIXED_PRICE",
  currency: "USD",
  defaultQuantity: "1",
  defaultPrice: "",
  paymentPolicyId: "",
  fulfillmentPolicyId: "",
  returnPolicyId: "",
  merchantLocationKey: "",
  shippingService: "",
  handlingTime: "",
  internationalShippingEnabled: false,
  excludedLocations: "",
  bestOfferEnabled: false,
  minimumOfferPrice: "",
  autoAcceptPrice: "",
  privateListing: false,
  immediatePayRequired: false,
  titleTemplate: "{{title}}",
  descriptionTemplateHtml: "<p>{title}</p>",
  itemSpecificsTemplate: "{}",
  brand: "",
  type: "Photocard",
  countryOfOrigin: "KR",
  customLabel: "",
  defaultImageUrl: "",
  imageUrlMode: "fallback",
  maxImages: "12",
  r2UrlPrefix: "",
  skuPrefix: "SKU",
  autoGenerateSku: false,
  inventoryTrackingEnabled: true,
  outOfStockControl: true,
  isDefault: false,
};

function objectJson(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return String(value ?? "");
}

function firstJsonValue(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return Array.isArray(raw) ? stringValue(raw[0]) : stringValue(raw);
}

function boolJsonValue(value: Record<string, unknown>, key: string, fallback = false) {
  const raw = value[key];
  return typeof raw === "boolean" ? raw : fallback;
}

function formFromTemplate(template: Template): FormState {
  const itemSpecifics = objectJson(template.itemSpecificsTemplateJson);
  const imageSettings = objectJson(template.imageSettingsJson);
  const shippingSettings = objectJson(template.shippingSettingsJson);
  const skuSettings = objectJson(template.skuSettingsJson);
  const excludedLocations = objectJson(template.excludedLocationsJson);

  return {
    ...emptyForm,
    name: template.name,
    description: template.description ?? "",
    marketplaceId: template.marketplaceId ?? "EBAY_US",
    categoryId: template.categoryId ?? "",
    condition: template.condition ?? "NEW",
    conditionDescription: template.conditionDescription ?? "",
    listingDuration: template.listingDuration ?? "GTC",
    listingFormat: template.listingFormat ?? "FIXED_PRICE",
    currency: template.currency ?? "USD",
    defaultQuantity: stringValue(template.defaultQuantity ?? ""),
    defaultPrice: stringValue(template.defaultPrice ?? ""),
    paymentPolicyId: template.paymentPolicyId ?? "",
    fulfillmentPolicyId: template.fulfillmentPolicyId ?? "",
    returnPolicyId: template.returnPolicyId ?? "",
    merchantLocationKey: template.merchantLocationKey ?? "",
    shippingService: stringValue(shippingSettings.shippingService),
    handlingTime: stringValue(shippingSettings.handlingTime),
    internationalShippingEnabled: boolJsonValue(shippingSettings, "internationalShippingEnabled"),
    excludedLocations:
      stringValue(excludedLocations.excludedLocations) ||
      stringValue(shippingSettings.excludedLocations),
    bestOfferEnabled: template.bestOfferEnabled,
    minimumOfferPrice: stringValue(template.minimumOfferPrice ?? ""),
    autoAcceptPrice: stringValue(template.autoAcceptPrice ?? ""),
    privateListing: template.privateListing,
    immediatePayRequired: template.immediatePayRequired,
    titleTemplate: template.titleTemplate ?? "{{title}}",
    descriptionTemplateHtml: template.descriptionTemplateHtml ?? "",
    itemSpecificsTemplate: JSON.stringify(itemSpecifics, null, 2),
    brand: firstJsonValue(itemSpecifics, "Brand"),
    type: firstJsonValue(itemSpecifics, "Type"),
    countryOfOrigin: firstJsonValue(itemSpecifics, "Country"),
    customLabel: firstJsonValue(itemSpecifics, "Custom label"),
    defaultImageUrl: stringValue(imageSettings.defaultImageUrl),
    imageUrlMode: stringValue(imageSettings.imageUrlMode || "fallback"),
    maxImages: stringValue(imageSettings.maxImages || "12"),
    r2UrlPrefix: stringValue(imageSettings.r2UrlPrefix),
    skuPrefix: stringValue(skuSettings.skuPrefix || "SKU"),
    autoGenerateSku: boolJsonValue(skuSettings, "autoGenerateSku"),
    inventoryTrackingEnabled: boolJsonValue(skuSettings, "inventoryTrackingEnabled", true),
    outOfStockControl: boolJsonValue(skuSettings, "outOfStockControl", true),
    isDefault: template.isDefault,
  };
}

function parseItemSpecifics(form: FormState) {
  let parsed: Record<string, unknown> = {};

  try {
    parsed = JSON.parse(form.itemSpecificsTemplate || "{}") as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  if (form.brand) {
    parsed.Brand = [form.brand];
  }

  if (form.type) {
    parsed.Type = [form.type];
  }

  if (form.countryOfOrigin) {
    parsed.Country = [form.countryOfOrigin];
  }

  if (form.customLabel) {
    parsed["Custom label"] = [form.customLabel];
  }

  return parsed;
}

function formPayload(form: FormState) {
  return {
    name: form.name,
    description: form.description,
    marketplaceId: form.marketplaceId,
    categoryId: form.categoryId,
    condition: form.condition,
    conditionDescription: form.conditionDescription,
    listingDuration: form.listingDuration,
    listingFormat: form.listingFormat,
    currency: form.currency,
    defaultQuantity: form.defaultQuantity,
    defaultPrice: form.defaultPrice,
    paymentPolicyId: form.paymentPolicyId,
    fulfillmentPolicyId: form.fulfillmentPolicyId,
    returnPolicyId: form.returnPolicyId,
    merchantLocationKey: form.merchantLocationKey,
    bestOfferEnabled: form.bestOfferEnabled,
    minimumOfferPrice: form.minimumOfferPrice,
    autoAcceptPrice: form.autoAcceptPrice,
    privateListing: form.privateListing,
    immediatePayRequired: form.immediatePayRequired,
    titleTemplate: form.titleTemplate,
    descriptionTemplateHtml: form.descriptionTemplateHtml,
    itemSpecificsTemplateJson: parseItemSpecifics(form),
    imageSettingsJson: {
      defaultImageUrl: form.defaultImageUrl,
      imageUrlMode: form.imageUrlMode,
      maxImages: form.maxImages,
      r2UrlPrefix: form.r2UrlPrefix,
    },
    shippingSettingsJson: {
      shippingService: form.shippingService,
      handlingTime: form.handlingTime,
      internationalShippingEnabled: form.internationalShippingEnabled,
      excludedLocations: form.excludedLocations,
    },
    excludedLocationsJson: {
      excludedLocations: form.excludedLocations,
    },
    skuSettingsJson: {
      skuPrefix: form.skuPrefix,
      autoGenerateSku: form.autoGenerateSku,
      inventoryTrackingEnabled: form.inventoryTrackingEnabled,
      outOfStockControl: form.outOfStockControl,
    },
    isDefault: form.isDefault,
  };
}

function fieldClass() {
  return "h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900";
}

function TextInput({
  name,
  label,
  value,
  onChange,
  type = "text",
  list,
}: {
  name: keyof FormState;
  label: string;
  value: string;
  onChange: (name: keyof FormState, value: string) => void;
  type?: string;
  list?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600">{label}</span>
      <input
        value={value}
        type={type}
        list={list}
        onChange={(event) => onChange(name, event.target.value)}
        className={fieldClass()}
      />
    </label>
  );
}

function Checkbox({
  name,
  label,
  checked,
  onChange,
}: {
  name: keyof FormState;
  label: string;
  checked: boolean;
  onChange: (name: keyof FormState, value: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm text-zinc-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(name, event.target.checked)}
      />
      {label}
    </label>
  );
}

export function ListingTemplateManager({
  initialTemplates,
  initialPolicies = null,
}: {
  initialTemplates: Template[];
  initialPolicies?: Policies | null;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedId, setSelectedId] = useState(initialTemplates[0]?.id ?? "");
  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [selectedId, templates],
  );
  const [form, setForm] = useState<FormState>(
    selected ? formFromTemplate(selected) : emptyForm,
  );
  const [message, setMessage] = useState("");
  const [policies, setPolicies] = useState<Policies | null>(initialPolicies);

  async function refreshTemplates(nextSelectedId?: string) {
    const response = await fetch("/api/listings/templates");
    const data = (await response.json()) as { templates: Template[] };
    setTemplates(data.templates);
    setSelectedId(nextSelectedId ?? data.templates[0]?.id ?? "");
    router.refresh();
  }

  function selectTemplate(id: string) {
    setSelectedId(id);
    const template = templates.find((entry) => entry.id === id);
    setForm(template ? formFromTemplate(template) : emptyForm);
    setMessage("");
  }

  function updateForm(name: keyof FormState, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function saveTemplate() {
    const method = selected ? "PUT" : "POST";
    const url = selected
      ? `/api/listings/templates/${encodeURIComponent(selected.id)}`
      : "/api/listings/templates";
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formPayload(form)),
    });
    const data = (await response.json().catch(() => null)) as
      | { template?: Template; error?: string }
      | null;

    if (!response.ok || !data?.template) {
      setMessage(data?.error ?? "템플릿 저장에 실패했습니다.");
      return;
    }

    setMessage("템플릿을 저장했습니다.");
    await refreshTemplates(data.template.id);
  }

  async function copyTemplate() {
    if (!selected) {
      return;
    }

    const response = await fetch(`/api/listings/templates/${selected.id}/copy`, {
      method: "POST",
    });
    const data = (await response.json().catch(() => null)) as
      | { template?: Template; error?: string }
      | null;

    if (!response.ok || !data?.template) {
      setMessage(data?.error ?? "템플릿 복사에 실패했습니다.");
      return;
    }

    setMessage("템플릿을 복사했습니다.");
    await refreshTemplates(data.template.id);
  }

  async function deleteTemplate() {
    if (!selected) {
      return;
    }

    const response = await fetch(`/api/listings/templates/${selected.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ?? "템플릿 삭제에 실패했습니다.");
      return;
    }

    setMessage("템플릿을 삭제했습니다.");
    await refreshTemplates();
  }

  async function setDefaultTemplate() {
    if (!selected) {
      return;
    }

    const response = await fetch(`/api/listings/templates/${selected.id}/default`, {
      method: "POST",
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ?? "기본 템플릿 지정에 실패했습니다.");
      return;
    }

    setMessage("기본 템플릿을 변경했습니다.");
    await refreshTemplates(selected.id);
  }

  async function fetchPolicies() {
    setMessage("");
    const response = await fetch(
      `/api/listings/policies?marketplaceId=${encodeURIComponent(form.marketplaceId || "EBAY_US")}`,
    );
    const data = (await response.json().catch(() => null)) as Policies & { error?: string };

    if (!response.ok) {
      setMessage(data?.error ?? "eBay 정책을 불러오지 못했습니다.");
      return;
    }

    setPolicies(data);
    setMessage("eBay 정책을 불러왔습니다.");
  }

  const policyLists = [
    ["payment-policy-options", policies?.paymentPolicies ?? []],
    ["fulfillment-policy-options", policies?.fulfillmentPolicies ?? []],
    ["return-policy-options", policies?.returnPolicies ?? []],
    ["location-options", policies?.inventoryLocations ?? []],
  ] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="rounded-lg border border-zinc-200 bg-white p-4">
        <button
          type="button"
          onClick={() => {
            setSelectedId("");
            setForm(emptyForm);
          }}
          className="mb-3 h-10 w-full rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          새 템플릿
        </button>
        <div className="space-y-2">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => selectTemplate(template.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                selectedId === template.id
                  ? "border-zinc-950 bg-zinc-100 text-zinc-950"
                  : "border-zinc-200 text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{template.name}</span>
                {template.isDefault ? <Star className="h-4 w-4 fill-zinc-950" /> : null}
              </span>
              <span className="mt-1 block truncate text-xs text-zinc-500">
                {template.marketplaceId ?? "EBAY_US"} / {template.categoryId ?? "category"}
              </span>
            </button>
          ))}
          {!templates.length ? (
            <p className="rounded-md bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
              저장된 템플릿이 없습니다.
            </p>
          ) : null}
        </div>
      </aside>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">
              {selected ? "템플릿 수정" : "템플릿 생성"}
            </h2>
            {message ? <p className="mt-1 text-sm text-zinc-600">{message}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={fetchPolicies}
              className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              eBay 정책 불러오기
            </button>
            <button
              type="button"
              onClick={saveTemplate}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              <Save className="h-4 w-4" />
              저장
            </button>
            <button
              type="button"
              onClick={copyTemplate}
              disabled={!selected}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400"
            >
              <Copy className="h-4 w-4" />
              복사
            </button>
            <button
              type="button"
              onClick={setDefaultTemplate}
              disabled={!selected}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400"
            >
              <Star className="h-4 w-4" />
              기본 지정
            </button>
            <button
              type="button"
              onClick={deleteTemplate}
              disabled={!selected}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:text-zinc-400"
            >
              <Trash2 className="h-4 w-4" />
              삭제
            </button>
          </div>
        </div>

        {policyLists.map(([id, options]) => (
          <datalist key={id} id={id}>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </datalist>
        ))}

        <div className="grid gap-5">
          <div className="grid gap-3 md:grid-cols-3">
            <TextInput name="name" label="템플릿명" value={form.name} onChange={updateForm} />
            <TextInput name="marketplaceId" label="marketplace_id" value={form.marketplaceId} onChange={updateForm} />
            <TextInput name="categoryId" label="category_id" value={form.categoryId} onChange={updateForm} />
            <TextInput name="condition" label="condition" value={form.condition} onChange={updateForm} />
            <TextInput name="listingDuration" label="listing_duration" value={form.listingDuration} onChange={updateForm} />
            <TextInput name="listingFormat" label="listing_format" value={form.listingFormat} onChange={updateForm} />
            <TextInput name="currency" label="currency" value={form.currency} onChange={updateForm} />
            <TextInput name="defaultQuantity" label="quantity" value={form.defaultQuantity} onChange={updateForm} type="number" />
            <TextInput name="defaultPrice" label="price" value={form.defaultPrice} onChange={updateForm} type="number" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <TextInput name="paymentPolicyId" label="payment_policy_id" value={form.paymentPolicyId} onChange={updateForm} list="payment-policy-options" />
            <TextInput name="fulfillmentPolicyId" label="fulfillment_policy_id" value={form.fulfillmentPolicyId} onChange={updateForm} list="fulfillment-policy-options" />
            <TextInput name="returnPolicyId" label="return_policy_id" value={form.returnPolicyId} onChange={updateForm} list="return-policy-options" />
            <TextInput name="merchantLocationKey" label="merchant_location_key" value={form.merchantLocationKey} onChange={updateForm} list="location-options" />
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <TextInput name="shippingService" label="shipping_service" value={form.shippingService} onChange={updateForm} />
            <TextInput name="handlingTime" label="handling_time" value={form.handlingTime} onChange={updateForm} type="number" />
            <TextInput name="excludedLocations" label="excluded_locations" value={form.excludedLocations} onChange={updateForm} />
            <Checkbox name="internationalShippingEnabled" label="international" checked={form.internationalShippingEnabled} onChange={updateForm} />
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            <Checkbox name="bestOfferEnabled" label="best_offer" checked={form.bestOfferEnabled} onChange={updateForm} />
            <TextInput name="minimumOfferPrice" label="minimum_offer_price" value={form.minimumOfferPrice} onChange={updateForm} type="number" />
            <TextInput name="autoAcceptPrice" label="auto_accept_price" value={form.autoAcceptPrice} onChange={updateForm} type="number" />
            <Checkbox name="privateListing" label="private_listing" checked={form.privateListing} onChange={updateForm} />
            <Checkbox name="immediatePayRequired" label="immediate_pay" checked={form.immediatePayRequired} onChange={updateForm} />
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <TextInput name="brand" label="brand" value={form.brand} onChange={updateForm} />
            <TextInput name="type" label="type" value={form.type} onChange={updateForm} />
            <TextInput name="countryOfOrigin" label="country_of_origin" value={form.countryOfOrigin} onChange={updateForm} />
            <TextInput name="customLabel" label="custom_label" value={form.customLabel} onChange={updateForm} />
          </div>

          <TextInput
            name="titleTemplate"
            label="title_template"
            value={form.titleTemplate}
            onChange={updateForm}
          />

          <div className="grid gap-3 md:grid-cols-4">
            <TextInput name="defaultImageUrl" label="default_image_url" value={form.defaultImageUrl} onChange={updateForm} />
            <TextInput name="imageUrlMode" label="image_url_mode" value={form.imageUrlMode} onChange={updateForm} />
            <TextInput name="maxImages" label="max_images" value={form.maxImages} onChange={updateForm} type="number" />
            <TextInput name="r2UrlPrefix" label="r2_url_prefix" value={form.r2UrlPrefix} onChange={updateForm} />
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <TextInput name="skuPrefix" label="sku_prefix" value={form.skuPrefix} onChange={updateForm} />
            <Checkbox name="autoGenerateSku" label="auto_generate_sku" checked={form.autoGenerateSku} onChange={updateForm} />
            <Checkbox name="inventoryTrackingEnabled" label="inventory_tracking" checked={form.inventoryTrackingEnabled} onChange={updateForm} />
            <Checkbox name="outOfStockControl" label="out_of_stock_control" checked={form.outOfStockControl} onChange={updateForm} />
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600">description_template_html</span>
            <textarea
              value={form.descriptionTemplateHtml}
              rows={5}
              onChange={(event) => updateForm("descriptionTemplateHtml", event.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600">item_specifics_template</span>
            <textarea
              value={form.itemSpecificsTemplate}
              rows={5}
              onChange={(event) => updateForm("itemSpecificsTemplate", event.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs outline-none focus:border-zinc-900"
            />
          </label>
          <Checkbox name="isDefault" label="기본 템플릿" checked={form.isDefault} onChange={updateForm} />
        </div>
      </section>
    </div>
  );
}
