import "server-only";
import { prisma } from "@/lib/prisma";
import { ebayApiRequest, getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";
import { buildEbayVariationListingTitle } from "@/lib/ebay-listing-fields";
import { buildVariationListingGroups } from "@/lib/variation-listing-groups";
import { renderListingTemplate } from "@/lib/services/listingUploadInput";

/** Restore the existing offer's HTML on its group without republishing or changing offers. */
export async function repairEbayVariationContent(userId: string, productId: string, applyTemplatePolicies = false) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product?.ebayItemId) throw new Error("등록된 eBay 상품을 찾을 수 없습니다.");
  const state = await prisma.variationListingState.findFirst({ where: { userId, ebayItemId: product.ebayItemId } });
  if (!state?.parentSku || !Array.isArray(state.includedProductIds) || !state.includedProductIds.includes(productId)) {
    throw new Error("확인된 옵션 묶음 연결이 없습니다.");
  }
  const account = await getActiveEbayInventoryAccount(userId);
  const products = await prisma.product.findMany({ where: { id: { in: state.includedProductIds.filter((id): id is string => typeof id === "string") } } });
  const group = buildVariationListingGroups(products).groups.find((entry) => entry.key === state.groupKey);
  if (!group) throw new Error("저장된 옵션 구성으로 상품명을 확인하지 못했습니다.");
  const template = await prisma.listingTemplate.findFirst({ where: { userId, isDefault: true } });
  const policyTitle = buildEbayVariationListingTitle(group);
  const title = template?.titleTemplate?.trim()
    ? renderListingTemplate(template.titleTemplate, { title: policyTitle, brand: group.groupName, sku: state.parentSku })
    : policyTitle;
  const path = `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(state.parentSku)}`;
  const remote = (await ebayApiRequest(account, { path })).body as Record<string, unknown>;
  if (!Array.isArray(remote?.variantSKUs) || !remote.variantSKUs.includes(product.sku)) throw new Error("이베이 옵션 구성이 내부 연결과 다릅니다.");
  const offers = (await ebayApiRequest(account, {
    path: "/sell/inventory/v1/offer",
    query: { sku: product.sku, marketplace_id: product.ebayMarketplaceId || "EBAY_US", format: "FIXED_PRICE" },
  })).body as { offers?: Array<{ offerId?: string; listing?: { listingId?: string } }> };
  const offer = offers.offers?.find((entry) => entry.listing?.listingId === product.ebayItemId);
  if (!offer?.offerId) throw new Error("현재 게시된 옵션을 확인하지 못했습니다.");
  const detail = (await ebayApiRequest(account, { path: `/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}` })).body as { listingDescription?: string };
  const html = detail.listingDescription && /<(?:div|p|h[1-6]|table|br)\b/i.test(detail.listingDescription)
    ? detail.listingDescription
    : renderListingTemplate(template?.descriptionTemplateHtml, { title, sku: state.parentSku, brand: group.groupName });
  if (!html || !/<(?:div|p|h[1-6]|table|br)\b/i.test(html)) throw new Error("복원할 기존 HTML 설명이 없습니다.");
  const oldTitle = String(remote.title ?? "");
  const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const description = [...new Set([oldTitle, state.title, group.title])]
    .filter((value): value is string => Boolean(value && value !== title))
    .reduce((value, priorTitle) => value.replaceAll(escapeHtml(priorTitle), escapeHtml(title)), html);
  if (applyTemplatePolicies) {
    if (!template?.fulfillmentPolicyId || !template.returnPolicyId) throw new Error("기본 템플릿의 배송·반품 정책을 먼저 지정해 주세요.");
    for (const sku of remote.variantSKUs) {
      const response = (await ebayApiRequest(account, { path: "/sell/inventory/v1/offer", query: { sku: String(sku), marketplace_id: product.ebayMarketplaceId || "EBAY_US", format: "FIXED_PRICE" } })).body as typeof offers;
      const current = response.offers?.find((entry) => entry.listing?.listingId === product.ebayItemId);
      if (!current?.offerId) throw new Error(`${sku}: 현재 등록된 옵션을 확인하지 못했습니다.`);
      const offerPath = `/sell/inventory/v1/offer/${encodeURIComponent(current.offerId)}`;
      const saved = (await ebayApiRequest(account, { path: offerPath })).body as Record<string, unknown>;
      const writable = Object.fromEntries(Object.entries(saved).filter(([key]) => ["sku", "marketplaceId", "format", "availableQuantity", "categoryId", "merchantLocationKey", "listingPolicies", "pricingSummary", "listingDuration", "hideBuyerDetails", "includeCatalogProductDetails", "quantityLimitPerBuyer", "tax", "storeCategoryNames", "extendedProducerResponsibility", "regulatory"].includes(key)));
      await ebayApiRequest(account, { method: "PUT", path: offerPath, body: { ...writable, listingDescription: description, listingPolicies: { ...(saved.listingPolicies as Record<string, unknown>), fulfillmentPolicyId: template.fulfillmentPolicyId, returnPolicyId: template.returnPolicyId } }, contentLanguage: "en-US" });
      const confirmed = (await ebayApiRequest(account, { path: offerPath })).body as { listingPolicies?: { fulfillmentPolicyId?: string; returnPolicyId?: string } };
      if (confirmed.listingPolicies?.fulfillmentPolicyId !== template.fulfillmentPolicyId || confirmed.listingPolicies?.returnPolicyId !== template.returnPolicyId) throw new Error(`${sku}: 배송·반품 정책 저장 결과를 확인하지 못했습니다.`);
    }
  }
  await ebayApiRequest(account, { method: "PUT", path, body: { ...remote, title, description }, contentLanguage: "en-US" });
  const verified = (await ebayApiRequest(account, { path })).body as { title?: string; description?: string };
  if (verified.title !== title || verified.description !== description) throw new Error("설명 수정 요청 후 이베이 저장 결과를 확인하지 못했습니다.");
  return { listingId: product.ebayItemId, title, verified: true, policiesUpdated: applyTemplatePolicies };
}
