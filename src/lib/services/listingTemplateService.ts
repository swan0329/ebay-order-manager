import { Prisma, type ListingTemplate } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import type { ListingUploadDraft } from "@/lib/services/listingUploadInput";

export type ListingTemplateInput = {
  name: string;
  description?: string | null;
  marketplaceId?: string | null;
  categoryId?: string | null;
  condition?: string | null;
  conditionDescription?: string | null;
  listingDuration?: string | null;
  listingFormat?: string | null;
  currency?: string | null;
  defaultQuantity?: number | string | null;
  defaultPrice?: number | string | null;
  paymentPolicyId?: string | null;
  fulfillmentPolicyId?: string | null;
  returnPolicyId?: string | null;
  merchantLocationKey?: string | null;
  bestOfferEnabled?: boolean | null;
  minimumOfferPrice?: number | string | null;
  autoAcceptPrice?: number | string | null;
  privateListing?: boolean | null;
  immediatePayRequired?: boolean | null;
  descriptionTemplateHtml?: string | null;
  itemSpecificsTemplateJson?: unknown;
  imageSettingsJson?: unknown;
  shippingSettingsJson?: unknown;
  skuSettingsJson?: unknown;
  titleTemplate?: string | null;
  excludedLocationsJson?: unknown;
  isDefault?: boolean;
};

function nullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function nullableNumberText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function nullableInteger(value: unknown) {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  if (value === null || value === undefined || value === "") {
    return Prisma.JsonNull;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Prisma.InputJsonValue;
    } catch {
      return Prisma.JsonNull;
    }
  }

  return value as Prisma.InputJsonValue;
}

function objectJson(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringFromJson(value: Record<string, unknown>, key: string) {
  const text = String(value[key] ?? "").trim();
  return text ? text : null;
}

function numberFromJson(value: Record<string, unknown>, key: string) {
  const raw = value[key];

  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolFromJson(value: Record<string, unknown>, key: string) {
  const raw = value[key];

  if (typeof raw === "boolean") {
    return raw;
  }

  const text = String(raw ?? "").trim().toLowerCase();

  if (!text) {
    return null;
  }

  if (["1", "true", "yes", "y", "on", "사용", "예"].includes(text)) {
    return true;
  }

  if (["0", "false", "no", "n", "off", "미사용", "아니오"].includes(text)) {
    return false;
  }

  return null;
}

function templateData(userId: string, input: ListingTemplateInput) {
  return {
    userId,
    name: nullableText(input.name) ?? "새 템플릿",
    description: nullableText(input.description),
    marketplaceId: nullableText(input.marketplaceId),
    categoryId: nullableText(input.categoryId),
    condition: nullableText(input.condition),
    conditionDescription: nullableText(input.conditionDescription),
    listingDuration: nullableText(input.listingDuration),
    listingFormat: nullableText(input.listingFormat),
    currency: nullableText(input.currency),
    defaultQuantity: nullableInteger(input.defaultQuantity),
    defaultPrice: nullableNumberText(input.defaultPrice),
    paymentPolicyId: nullableText(input.paymentPolicyId),
    fulfillmentPolicyId: nullableText(input.fulfillmentPolicyId),
    returnPolicyId: nullableText(input.returnPolicyId),
    merchantLocationKey: nullableText(input.merchantLocationKey),
    bestOfferEnabled: Boolean(input.bestOfferEnabled),
    minimumOfferPrice: nullableNumberText(input.minimumOfferPrice),
    autoAcceptPrice: nullableNumberText(input.autoAcceptPrice),
    privateListing: Boolean(input.privateListing),
    immediatePayRequired: Boolean(input.immediatePayRequired),
    descriptionTemplateHtml: nullableText(input.descriptionTemplateHtml),
    itemSpecificsTemplateJson: jsonOrNull(input.itemSpecificsTemplateJson),
    imageSettingsJson: jsonOrNull(input.imageSettingsJson),
    shippingSettingsJson: jsonOrNull(input.shippingSettingsJson),
    skuSettingsJson: jsonOrNull(input.skuSettingsJson),
    titleTemplate: nullableText(input.titleTemplate),
    excludedLocationsJson: jsonOrNull(input.excludedLocationsJson),
    isDefault: Boolean(input.isDefault),
  };
}

export function listingTemplateToDefaults(template: ListingTemplate): ListingUploadDraft {
  const imageSettings = objectJson(template.imageSettingsJson);
  const shippingSettings = objectJson(template.shippingSettingsJson);
  const excludedLocationsSettings = objectJson(template.excludedLocationsJson);
  const skuSettings = objectJson(template.skuSettingsJson);
  const itemSpecifics = objectJson(template.itemSpecificsTemplateJson);

  return {
    marketplaceId: template.marketplaceId,
    categoryId: template.categoryId,
    condition: template.condition,
    conditionDescription: template.conditionDescription,
    listingDuration: template.listingDuration,
    listingFormat: template.listingFormat ?? "FIXED_PRICE",
    currency: template.currency,
    quantity: template.defaultQuantity,
    price: template.defaultPrice?.toString(),
    paymentProfile: template.paymentPolicyId,
    shippingProfile:
      template.fulfillmentPolicyId ?? stringFromJson(shippingSettings, "shippingProfile"),
    returnProfile: template.returnPolicyId,
    merchantLocationKey: template.merchantLocationKey,
    shippingService: stringFromJson(shippingSettings, "shippingService"),
    handlingTime: numberFromJson(shippingSettings, "handlingTime"),
    internationalShippingEnabled: boolFromJson(
      shippingSettings,
      "internationalShippingEnabled",
    ),
    excludedLocations:
      stringFromJson(excludedLocationsSettings, "excludedLocations") ??
      stringFromJson(shippingSettings, "excludedLocations"),
    bestOfferEnabled: template.bestOfferEnabled,
    minimumOfferPrice: template.minimumOfferPrice?.toString(),
    autoAcceptPrice: template.autoAcceptPrice?.toString(),
    privateListing: template.privateListing,
    immediatePayRequired: template.immediatePayRequired,
    descriptionHtml: template.descriptionTemplateHtml,
    itemSpecifics: itemSpecifics as Record<string, string[]>,
    brand: stringFromJson(itemSpecifics, "Brand"),
    type: stringFromJson(itemSpecifics, "Type"),
    countryOfOrigin: stringFromJson(itemSpecifics, "Country"),
    customLabel: stringFromJson(itemSpecifics, "Custom label"),
    defaultImageUrl: stringFromJson(imageSettings, "defaultImageUrl"),
    imageUrlMode: stringFromJson(imageSettings, "imageUrlMode"),
    maxImages: numberFromJson(imageSettings, "maxImages"),
    r2UrlPrefix: stringFromJson(imageSettings, "r2UrlPrefix"),
    skuPrefix: stringFromJson(skuSettings, "skuPrefix"),
    autoGenerateSku: boolFromJson(skuSettings, "autoGenerateSku"),
  };
}

export async function listListingTemplates(userId: string) {
  return prisma.listingTemplate.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
}

export async function createListingTemplate(userId: string, input: ListingTemplateInput) {
  const data = templateData(userId, input);

  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.listingTemplate.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.listingTemplate.create({ data });
  });
}

export async function updateListingTemplate(
  userId: string,
  id: string,
  input: ListingTemplateInput,
) {
  const data = templateData(userId, input);

  return prisma.$transaction(async (tx) => {
    const current = await tx.listingTemplate.findFirst({ where: { id, userId } });

    if (!current) {
      throw new Error("템플릿을 찾을 수 없습니다.");
    }

    if (data.isDefault) {
      await tx.listingTemplate.updateMany({
        where: { userId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return tx.listingTemplate.update({ where: { id }, data });
  });
}

export async function copyListingTemplate(userId: string, id: string) {
  const current = await prisma.listingTemplate.findFirst({ where: { id, userId } });

  if (!current) {
    throw new Error("템플릿을 찾을 수 없습니다.");
  }

  return prisma.listingTemplate.create({
    data: {
      ...templateData(userId, {
        name: `${current.name} 복사본`,
        description: current.description,
        marketplaceId: current.marketplaceId,
        categoryId: current.categoryId,
        condition: current.condition,
        conditionDescription: current.conditionDescription,
        listingDuration: current.listingDuration,
        listingFormat: current.listingFormat,
        currency: current.currency,
        defaultQuantity: current.defaultQuantity,
        defaultPrice: current.defaultPrice?.toString(),
        paymentPolicyId: current.paymentPolicyId,
        fulfillmentPolicyId: current.fulfillmentPolicyId,
        returnPolicyId: current.returnPolicyId,
        merchantLocationKey: current.merchantLocationKey,
        bestOfferEnabled: current.bestOfferEnabled,
        minimumOfferPrice: current.minimumOfferPrice?.toString(),
        autoAcceptPrice: current.autoAcceptPrice?.toString(),
        privateListing: current.privateListing,
        immediatePayRequired: current.immediatePayRequired,
        descriptionTemplateHtml: current.descriptionTemplateHtml,
        itemSpecificsTemplateJson: current.itemSpecificsTemplateJson,
        imageSettingsJson: current.imageSettingsJson,
        shippingSettingsJson: current.shippingSettingsJson,
        skuSettingsJson: current.skuSettingsJson,
        titleTemplate: current.titleTemplate,
        excludedLocationsJson: current.excludedLocationsJson,
        isDefault: false,
      }),
      isDefault: false,
    },
  });
}

export async function deleteListingTemplate(userId: string, id: string) {
  const current = await prisma.listingTemplate.findFirst({ where: { id, userId } });

  if (!current) {
    throw new Error("템플릿을 찾을 수 없습니다.");
  }

  return prisma.listingTemplate.delete({ where: { id } });
}

export async function setDefaultListingTemplate(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.listingTemplate.findFirst({ where: { id, userId } });

    if (!current) {
      throw new Error("템플릿을 찾을 수 없습니다.");
    }

    await tx.listingTemplate.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });

    return tx.listingTemplate.update({
      where: { id },
      data: { isDefault: true },
    });
  });
}

export async function resolveListingTemplateDefaults(
  userId: string,
  templateId?: string | null,
) {
  const template = templateId
    ? await prisma.listingTemplate.findFirst({ where: { id: templateId, userId } })
    : await prisma.listingTemplate.findFirst({ where: { userId, isDefault: true } });

  if (templateId && !template) {
    throw new Error("선택한 업로드 템플릿을 찾을 수 없습니다.");
  }

  return {
    template,
    defaults: template ? listingTemplateToDefaults(template) : null,
  };
}
