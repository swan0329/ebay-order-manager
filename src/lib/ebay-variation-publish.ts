import { refreshProcurementGroup } from "@/lib/procurement-refresh";
import "server-only";
import { readExistingVariationNames, ensureLegacyListingSku } from "@/lib/ebay-existing-variation-names";
import { variationMembersDescription } from "@/lib/unit-card-label";

import type { Product } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
import { prisma } from "@/lib/prisma";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import { listingQuantity } from "@/lib/listing-quantity";
import { variationParentSku, type VariationListingGroup } from "@/lib/variation-listing-groups";
import { ensureVariationThumbnail } from "@/lib/variation-thumbnail-prepare";
import { getActiveEbayInventoryAccount, ebayApiRequest } from "@/lib/services/ebayApiService";
import { prepareProductChannelImages } from "@/lib/listing-source-images";
import type { ListingUploadInput } from "@/lib/services/inventoryService";
import { coerceListingUploadInput, renderListingTemplate } from "@/lib/services/listingUploadInput";
import { resolveAutomaticListingDefaults } from "@/lib/services/listingDraftService";
import { listingTemplateToDefaults } from "@/lib/services/listingTemplateService";
import { PublishContinuationError } from "@/lib/channel-publish-runtime";
import { buildEbayVariationListingTitle, clampAspectValue } from "@/lib/ebay-listing-fields";
import {
  inventoryItemPayload,
  offerPayload,
  productToListingInput,
  deleteUnavailableOffer,
  hasEbayErrorId,
} from "@/lib/services/listingService";

function required(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`eBay가 ${label}를 반환하지 않았습니다.`);
  return text;
}

const activeListingStatuses = new Set(["ACTIVE", "PUBLISHED", "LISTED"]);

async function findOfferBySku(
  account: Awaited<ReturnType<typeof getActiveEbayInventoryAccount>>,
  sku: string,
  marketplaceId: string,
) {
  try {
    const response = await ebayApiRequest(account, {
      path: "/sell/inventory/v1/offer",
      query: { sku, marketplace_id: marketplaceId, format: "FIXED_PRICE" },
    });
    return (response.body as { offers?: Array<{
      offerId?: string;
      listing?: { listingId?: string; listingStatus?: string };
    }> } | null)?.offers?.[0] ?? null;
  } catch (error) {
    if (hasEbayErrorId(error, 25713)) return null;
    if (error instanceof EbayApiError && error.status === 404) return null;
    throw error;
  }
}

function jsonIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

export async function publishEbayVariationGroup(
  userId: string,
  group: VariationListingGroup<Product>,
  options: { prepareDeadline?: number; onProgress?: (stage: string) => Promise<void> } = {},
) {
  group = { ...group, products: await refreshProcurementGroup(group.products, userId) };
  const policyTitle = buildEbayVariationListingTitle(group);
  const progress = async (stage: string) => options.onProgress?.(stage);
  const checkpoint = () => {
    if (options.prepareDeadline && Date.now() >= options.prepareDeadline) throw new PublishContinuationError();
  };
  await progress("묶음 썸네일·계정 설정 준비");
  const [settings, account, thumbnail, state, template] = await Promise.all([
    prisma.pricingSettings.findUnique({ where: { id: "default" } }),
    getActiveEbayInventoryAccount(userId),
    ensureVariationThumbnail(userId, group),
    prisma.variationListingState.findUnique({
      where: { userId_groupKey: { userId, groupKey: group.key } },
    }),
    prisma.listingTemplate.findFirst({
      where: { userId, isDefault: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  if (!settings) throw new Error("가격 설정을 먼저 저장해 주세요.");
  const listingTitle = template?.titleTemplate?.trim()
    ? renderListingTemplate(template.titleTemplate, { title: policyTitle, brand: group.groupName, sku: variationParentSku(group.key) })
    : policyTitle;
  checkpoint();
  await progress("판매정책·발송지 확인");
  const { automaticDefaults: defaults, activeLocationKeys } = await resolveAutomaticListingDefaults(
    userId, template ? listingTemplateToDefaults(template) : null,
  );

  const prepared: Array<{ product: Product; input: ListingUploadInput }> = [];
  for (const product of group.products) {
    checkpoint();
    await progress(`카드 이미지 준비 ${prepared.length + 1}/${group.products.length} · ${product.sku}`);
    const resolved = resolveListingPriceUsd(product, settings);
    if (!resolved) throw new Error(`${product.sku}: 등록 가격이 없습니다.`);
    const variationName = product.variationName.replace(/[;|=]/g, " ");
    const configuredProduct = {
      ...product,
      // Resolve price first: newly imported cards can have only a KRW supply
      // price. Do not validate or publish that raw value as the USD price.
      ebayPrice: resolved.priceUsd,
      ebayCategoryId: product.ebayCategoryId?.trim() || defaults.categoryId || null,
      ebayCondition: product.ebayCondition?.trim() || defaults.condition || null,
      ebayShippingProfile: product.ebayShippingProfile?.trim() || defaults.shippingProfile || null,
      ebayReturnProfile: product.ebayReturnProfile?.trim() || defaults.returnProfile || null,
      ebayPaymentProfile: product.ebayPaymentProfile?.trim() || defaults.paymentProfile || null,
      ebayMerchantLocationKey: product.ebayMerchantLocationKey && activeLocationKeys.has(product.ebayMerchantLocationKey)
        ? product.ebayMerchantLocationKey : defaults.merchantLocationKey || null,
      ebayMarketplaceId: product.ebayMarketplaceId?.trim() || defaults.marketplaceId || null,
      ebayCurrency: product.ebayCurrency?.trim() || defaults.currency || null,
    };
    const base = productToListingInput(configuredProduct);
    const price = resolved.priceUsd.toFixed(2);
    const quantity = listingQuantity(product);
    const descriptionHtml = template?.descriptionTemplateHtml?.trim()
      ? renderListingTemplate(template.descriptionTemplateHtml, {
          ...base,
          title: listingTitle,
          price,
          quantity,
        })
      : base.descriptionHtml;
    const channelProduct = await prepareProductChannelImages(userId, product);
    const input = coerceListingUploadInput({
      ...base,
      title: listingTitle,
      descriptionHtml,
      price,
      quantity,
      imageUrls: channelProduct.ebayImageUrls,
      itemSpecifics: {
        ...(base.itemSpecifics ?? {}),
        Card: [variationName],
      },
    }, defaults);
    prepared.push({ product, input });
  }

  const groupKey = variationParentSku(group.key);
  const marketplaceId = prepared[0]?.input.marketplaceId || "EBAY_US";
  if (prepared.some(({ input }) => (input.marketplaceId || "EBAY_US") !== marketplaceId)) {
    throw new Error("묶음 카드의 eBay 판매 국가가 서로 다릅니다. 등록 설정을 확인해 주세요.");
  }
  const groupDescriptionHtml = prepared[0].input.descriptionHtml + variationMembersDescription(group.products);
  for (const field of ["categoryId", "shippingProfile", "returnProfile", "paymentProfile", "merchantLocationKey", "currency"] as const) {
    if (new Set(prepared.map(({ input }) => input[field])).size > 1) {
      throw new Error(`묶음 카드의 ${field} 설정이 서로 다릅니다. 등록 설정을 확인해 주세요.`);
    }
  }
  checkpoint();
  await progress("기존 이베이 SKU·옵션 확인");
  type ExistingOffer = {
    offerId?: string;
    listing?: { listingId?: string; listingStatus?: string };
  };
  const existingBySku = new Map<string, ExistingOffer | null>();
  for (const product of group.products) {
    existingBySku.set(product.sku, await findOfferBySku(
      account,
      product.sku,
      product.ebayMarketplaceId ?? "EBAY_US",
    ));
  }
  // A previous invocation can die after eBay publishes but before our DB save.
  // Recognize the same remote group before treating its offers as old singles.
  let existingGroupListingId = state?.ebayItemId ?? null;
  if (!existingGroupListingId) {
    const ids = group.products.map((product) => existingBySku.get(product.sku)?.listing?.listingId);
    if (ids.every(Boolean) && new Set(ids).size === 1) {
      try {
        const remote = await ebayApiRequest(account, { path: `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}` });
        const skus = (remote.body as { variantSKUs?: string[] } | null)?.variantSKUs ?? [];
        if (group.products.every((product) => skus.includes(product.sku))) existingGroupListingId = ids[0]!;
      } catch (error) {
        if (!(error instanceof EbayApiError && error.status === 404)) throw error;
      }
    }
  }

  const variationNames = new Map(group.products.map(p => [p.sku, p.variationName.replace(/[;|=]/g, " ")]));
  if (existingGroupListingId) {
    const savedNames = await readExistingVariationNames(account, existingGroupListingId);
    for (const [sku, name] of savedNames) {
      if (!variationNames.has(sku)) throw new Error(`기존 eBay 옵션 ${sku}가 이번 묶음에 없어 자동 변경을 중단했습니다.`);
      variationNames.set(sku, name);
    }
    if (new Set(variationNames.values()).size !== variationNames.size) throw new Error("기존 옵션과 신규 옵션 이름이 중복됩니다. 옵션명을 확인해 주세요.");
    for (const { product, input } of prepared) input.itemSpecifics = { ...input.itemSpecifics, Card: [variationNames.get(product.sku)!] };
  }

  // Seller Hub/Trading API로 만들어진 기존 단품은 먼저 Inventory API 객체로
  // 이관해야 offer를 철회하고 같은 SKU를 옵션 묶음에 재사용할 수 있다.
  const legacySingles = group.products.filter((product) =>
    Boolean(product.ebayItemId) &&
    product.ebayItemId !== state?.ebayItemId &&
    activeListingStatuses.has(String(product.listingStatus ?? "").toUpperCase()) &&
    !existingBySku.get(product.sku)?.offerId,
  );
  for (let offset = 0; offset < legacySingles.length; offset += 5) {
    for (const product of legacySingles.slice(offset, offset + 5)) await ensureLegacyListingSku(account, product.ebayItemId!, product.sku);
    await ebayApiRequest(account, {
      method: "POST",
      path: "/sell/inventory/v1/bulk_migrate_listing",
      body: {
        requests: legacySingles.slice(offset, offset + 5).map((product) => ({
          listingId: product.ebayItemId,
        })),
      },
    });
  }
  for (const product of legacySingles) {
    const offer = await findOfferBySku(
      account,
      product.sku,
      product.ebayMarketplaceId ?? "EBAY_US",
    );
    if (!offer?.offerId) {
      throw new Error(`${product.sku}: 기존 eBay 단품을 옵션상품으로 전환할 수 없습니다.`);
    }
    existingBySku.set(product.sku, offer);
  }

  const groupBody = (products: typeof group.products) => ({
    title: listingTitle,
    description: prepared[0].input.descriptionHtml + variationMembersDescription(products),
    imageUrls: [thumbnail.url],
    aspects: {
      Brand: [clampAspectValue(group.groupName)],
      Type: ["Photocard"],
      Set: [clampAspectValue(group.albumName)],
      Genre: ["K-Pop"],
    },
    variantSKUs: products.map((product) => product.sku),
    variesBy: {
      specifications: [
        {
          name: "Card",
          values: products.map((product) => variationNames.get(product.sku)!),
        },
      ],
      aspectsImageVariesBy: ["Card"],
    },
  });
  if (existingGroupListingId) {
    // Failed older attempts can leave the Inventory group definition different
    // from the live listing. Restore its exact existing labels before card PUTs,
    // which themselves can validate against that group and reject with 25013.
    for (const { product, input } of prepared) {
      const path = `/sell/inventory/v1/inventory_item/${encodeURIComponent(product.sku)}`;
      try { await ebayApiRequest(account, { path }); }
      catch (error) {
        if (!(error instanceof EbayApiError && (error.status === 404 || hasEbayErrorId(error, 25702)))) throw error;
        await ebayApiRequest(account, { method: "PUT", path, body: inventoryItemPayload(input), contentLanguage: "en-US" });
      }
    }
    await progress("기존 이베이 묶음 옵션 정의 확인");
    const path = `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`;
    try { await ebayApiRequest(account, { method: "PUT", path, body: groupBody(group.products), contentLanguage: "en-US" }); }
    catch (error) {
      if (!hasEbayErrorId(error, 25013)) throw error;
      // eBay can persist the Inventory definition but fail its live-listing
      // propagation because other children still carry the old, incorrect names.
      // Continue repair only after read-back proves the intended definition;
      // the mandatory final group publish still has to succeed.
      const current = (await ebayApiRequest(account, { path })).body as {variantSKUs?:string[];variesBy?:{specifications?:Array<{name:string;values:string[]}>}};
      const specs=current.variesBy?.specifications;
      const values=specs?.[0]?.values??[];
      if(current.variantSKUs?.length!==group.products.length || !group.products.every(p=>current.variantSKUs?.includes(p.sku)) || specs?.length!==1 || specs[0].name!=="Card" || values.length!==variationNames.size || ![...variationNames.values()].every(name=>values.includes(name))) throw error;
    }
  }
  for (const { product, input } of prepared) {
    await progress(`이베이 카드 전송 · ${product.sku}`);
    try { await ebayApiRequest(account, {
      method: "PUT",
      path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(product.sku)}`,
      body: inventoryItemPayload(input),
      contentLanguage: "en-US",
    }); } catch (error) {
      if (!existingGroupListingId || !hasEbayErrorId(error,25013)) throw error;
      const readback = (await ebayApiRequest(account,{path:`/sell/inventory/v1/inventory_item/${encodeURIComponent(product.sku)}`})).body as {product?:{aspects?:Record<string,string[]>}};
      if (JSON.stringify(readback.product?.aspects?.Card)!==JSON.stringify(input.itemSpecifics?.Card)) throw error;
    }
  }
  const withdrawn: Array<{ offerId: string; productId: string }> = [];
  for (const { product } of prepared) {
    const existing = existingBySku.get(product.sku);
    const existingListingId = existing?.listing?.listingId ?? product.ebayItemId;
    if (
      existing?.offerId &&
      existingListingId &&
      existingListingId !== existingGroupListingId &&
      activeListingStatuses.has(String(existing.listing?.listingStatus ?? product.listingStatus ?? "ACTIVE").toUpperCase())
    ) {
      await ebayApiRequest(account, {
        method: "POST",
        path: `/sell/inventory/v1/offer/${encodeURIComponent(existing.offerId)}/withdraw`,
      });
      withdrawn.push({ offerId: existing.offerId, productId: product.id });
    }
  }

  const offers: string[] = [];
  let listingId = existingGroupListingId;
  let published;
  let publishAttempted = false;
  try {
    await ebayApiRequest(account, {
      method: "PUT",
      path: `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`,
      body: groupBody(group.products),
      contentLanguage: "en-US",
    });
    for (const { product, input } of prepared) {
      await progress(`이베이 옵션 구성 · ${product.sku}`);
      const existing = existingBySku.get(product.sku)?.offerId;
      if (existing) {
        try {
          await ebayApiRequest(account, {
            method: "PUT",
            path: `/sell/inventory/v1/offer/${encodeURIComponent(existing)}`,
            body: offerPayload({ ...input, descriptionHtml: groupDescriptionHtml }),
            contentLanguage: "en-US",
          });
          offers.push(existing);
        } catch (error) {
          if (!hasEbayErrorId(error, 25713)) throw error;
          await deleteUnavailableOffer(account, existing);
          const created = await ebayApiRequest(account, {
            method: "POST",
            path: "/sell/inventory/v1/offer",
            body: offerPayload({ ...input, descriptionHtml: groupDescriptionHtml }),
            contentLanguage: "en-US",
          });
          offers.push(required((created.body as { offerId?: string } | null)?.offerId || (await findOfferBySku(account, product.sku, marketplaceId))?.offerId, `${product.sku} offerId`));
        }
      } else {
        const created = await ebayApiRequest(account, {
          method: "POST",
          path: "/sell/inventory/v1/offer",
          body: offerPayload({ ...input, descriptionHtml: groupDescriptionHtml }),
          contentLanguage: "en-US",
        });
        offers.push(required((created.body as { offerId?: string } | null)?.offerId || (await findOfferBySku(account, product.sku, marketplaceId))?.offerId, `${product.sku} offerId`));
      }
    }
    await progress("이베이 묶음 게시");
    publishAttempted = true;
    published = await ebayApiRequest(account, {
      method: "POST",
      path: "/sell/inventory/v1/offer/publish_by_inventory_item_group",
      body: { inventoryItemGroupKey: groupKey, marketplaceId },
    });
  } catch (error) {
    if (publishAttempted && error instanceof EbayApiError && error.status >= 500) {
      // A lost publish response does not prove rejection. Never delete a group
      // or relist its singles until the remote outcome is known.
      const confirmed = [];
      for (const product of group.products) {
        confirmed.push(await findOfferBySku(account, product.sku, product.ebayMarketplaceId ?? "EBAY_US"));
      }
      const ids = confirmed.map((offer) => offer?.listing?.listingId);
      if (ids.every(Boolean) && new Set(ids).size === 1 && confirmed.every((offer) =>
        activeListingStatuses.has(String(offer?.listing?.listingStatus).toUpperCase()),
      )) {
        published = { body: { listingId: ids[0] } };
      } else {
        throw error;
      }
    } else {
    // 옵션 게시가 실패하면 방금 종료한 단품을 가능한 범위에서 되살린다.
    // 복구 실패는 원래 오류를 가리지 않으며 다음 재시도에서 SKU/offer를 다시 조회한다.
    try {
      const previousIds = new Set(jsonIds(state?.includedProductIds));
      const previousProducts = group.products.filter((product) => previousIds.has(product.id));
      if (previousProducts.length >= 2) {
        await ebayApiRequest(account, {
          method: "PUT",
          path: `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`,
          body: groupBody(previousProducts),
          contentLanguage: "en-US",
        });
      } else if (!state?.ebayItemId) {
        await ebayApiRequest(account, {
          method: "DELETE",
          path: `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`,
        });
      }
      for (const item of withdrawn) {
        await ebayApiRequest(account, {
          method: "POST",
          path: `/sell/inventory/v1/offer/${encodeURIComponent(item.offerId)}/publish`,
        });
      }
    } catch {
      // Best-effort rollback. The original publish error is the actionable one.
    }
    throw error;
    }
  }
  listingId =
    String((published.body as { listingId?: unknown } | null)?.listingId ?? "").trim() ||
    listingId;
  if (!listingId) throw new Error("eBay 옵션상품 번호를 확인하지 못했습니다.");

  const productIds = group.products.map((product) => product.id);
  await progress("등록 결과 저장");
  await prisma.$transaction([
    prisma.variationListingState.upsert({
      where: { userId_groupKey: { userId, groupKey: group.key } },
      create: {
        userId,
        groupKey: group.key,
        parentSku: groupKey,
        title: group.title,
        ebayItemId: listingId,
        includedProductIds: productIds,
        pendingProductIds: [],
        thumbnailStatus: "READY",
        thumbnailUrl: thumbnail.url,
        thumbnailHash: thumbnail.hash,
        thumbnailProductIds: productIds,
        lastConfirmedAt: new Date(),
      },
      update: {
        title: group.title,
        ebayItemId: listingId,
        includedProductIds: productIds,
        pendingProductIds: [],
        lastConfirmedAt: new Date(),
      },
    }),
    ...prepared.map(({ product, input }) => prisma.product.updateMany({
      where: { id: product.id },
      data: {
        ebayItemId: listingId,
        listingStatus: "ACTIVE",
        lastUploadedAt: new Date(),
        ebayLastSyncedPrice: input.price,
        ebayLastSyncedQuantity: input.quantity,
        uploadError: null,
        uploadErrorSummary: null,
      },
    })),
  ]);
  return { listingId, offerIds: offers, thumbnailReused: thumbnail.reused };
}
