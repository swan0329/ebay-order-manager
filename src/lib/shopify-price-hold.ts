type Request = (input: { method?: string; path: string; body?: unknown }) => Promise<unknown>;
type Identity = { sku: string; shopifyProductId: string; shopifyVariantId: string; shopifyInventoryItemId: string };
type Snapshot = {
  id: string; sku: string; product: { id: string }; inventoryPolicy: string;
  metafield: { value: string } | null;
  inventoryItem: { id: string; tracked: boolean; inventoryLevels: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ location: { id: string }; quantities: Array<{ name: string; quantity: number }> }>;
  } };
};

export async function setShopifyPriceHoldFlag(request: Request, variantId: string, held: boolean) {
  const response = await request({ method: 'POST', path: '/graphql.json', body: {
    query: `mutation priceHold($metafields:[MetafieldsSetInput!]!){metafieldsSet(metafields:$metafields){metafields{key value} userErrors{message}}}`,
    variables: { metafields: [{ ownerId: `gid://shopify/ProductVariant/${variantId}`,
      namespace: 'order_manager', key: 'price_review_required', type: 'boolean', value: String(held) }] },
  } }) as { errors?: unknown[]; data?: { metafieldsSet?: { metafields?: Array<{ key: string; value: string }>; userErrors?: unknown[] } } };
  const result = response.data?.metafieldsSet;
  if (response.errors?.length || !result || result.userErrors?.length ||
      !result.metafields?.some(field => field.key === 'price_review_required' && field.value === String(held))) {
    throw new Error('Shopify 가격 확인 보류 표시를 검증하지 못했습니다.');
  }
}

async function readHoldState(request: Request, identity: Identity) {
  let cursor: string | null = null;
  let result: Snapshot | undefined;
  const levels: Snapshot['inventoryItem']['inventoryLevels']['nodes'] = [];
  const seen = new Set<string>();
  do {
    const response = await request({ method: 'POST', path: '/graphql.json', body: {
      query: `query priceHoldState($id:ID!,$cursor:String){productVariant(id:$id){id sku product{id} inventoryPolicy metafield(namespace:"order_manager",key:"price_review_required"){value} inventoryItem{id tracked inventoryLevels(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{location{id} quantities(names:["available"]){name quantity}}}}}}`,
      variables: { id: `gid://shopify/ProductVariant/${identity.shopifyVariantId}`, cursor },
    } }) as { errors?: unknown[]; data?: { productVariant?: Snapshot } };
    const variant = response.data?.productVariant;
    if (response.errors?.length || !variant || variant.sku !== identity.sku ||
        variant.id !== `gid://shopify/ProductVariant/${identity.shopifyVariantId}` ||
        variant.product.id !== `gid://shopify/Product/${identity.shopifyProductId}` ||
        variant.inventoryItem.id !== `gid://shopify/InventoryItem/${identity.shopifyInventoryItemId}`) {
      throw new Error(`${identity.sku}: Shopify 상품·옵션·재고 연결을 확인하지 못했습니다.`);
    }
    result = variant;
    levels.push(...variant.inventoryItem.inventoryLevels.nodes);
    const page = variant.inventoryItem.inventoryLevels.pageInfo;
    cursor = page.hasNextPage ? page.endCursor : null;
    if (page.hasNextPage && (!cursor || seen.has(cursor))) throw new Error('Shopify 재고 위치 조회가 완료되지 않았습니다.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { variant: result!, levels };
}

export async function holdShopifyVariantForMissingPrice(request: Request, identity: Identity) {
  const before = await readHoldState(request, identity);
  if (before.variant.metafield?.value === 'true' && before.variant.inventoryPolicy === 'DENY' &&
      before.variant.inventoryItem.tracked && before.levels.every(level =>
        level.quantities.some(q => q.name === 'available' && q.quantity === 0))) return;
  await setShopifyPriceHoldFlag(request, identity.shopifyVariantId, true);
  if (before.variant.inventoryPolicy !== 'DENY') await request({ method: 'PUT',
    path: `/variants/${identity.shopifyVariantId}.json`,
    body: { variant: { id: Number(identity.shopifyVariantId), inventory_policy: 'deny' } },
  });
  if (!before.variant.inventoryItem.tracked) await request({ method: 'PUT',
    path: `/inventory_items/${identity.shopifyInventoryItemId}.json`,
    body: { inventory_item: { id: Number(identity.shopifyInventoryItemId), tracked: true } },
  });
  for (const level of before.levels) {
    await request({ method: 'POST', path: '/inventory_levels/set.json', body: {
      location_id: Number(level.location.id.split('/').at(-1)),
      inventory_item_id: Number(identity.shopifyInventoryItemId), available: 0,
    } });
  }
  const after = await readHoldState(request, identity);
  if (after.variant.metafield?.value !== 'true' || after.variant.inventoryPolicy !== 'DENY' ||
      !after.variant.inventoryItem.tracked || after.levels.some(level =>
        !level.quantities.some(q => q.name === 'available' && q.quantity === 0))) {
    throw new Error(`${identity.sku}: Shopify 판매 보류가 실제로 적용되지 않았습니다.`);
  }
}
