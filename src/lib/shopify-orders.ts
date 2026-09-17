import type { OrderSyncFilters } from "@/lib/ebay";
import { getShopifyConfig } from "@/lib/env";
import {
  ShopifyApiError,
  shopifyApiRequest,
} from "@/lib/services/shopifyService";

type MoneyBag = {
  shopMoney?: { amount?: string; currencyCode?: string } | null;
};

export type ShopifyOrderNode = {
  id?: string;
  legacyResourceId?: string;
  name?: string;
  createdAt?: string;
  processedAt?: string | null;
  updatedAt?: string;
  cancelledAt?: string | null;
  closedAt?: string | null;
  note?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  totalPriceSet?: MoneyBag | null;
  customer?: { displayName?: string | null } | null;
  shippingAddress?: {
    name?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    provinceCode?: string | null;
    zip?: string | null;
    countryCodeV2?: string | null;
  } | null;
  lineItems?: {
    nodes?: ShopifyLineItemNode[];
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  } | null;
  fulfillments?: Array<{
      id?: string;
      status?: string;
      createdAt?: string;
      trackingInfo?: Array<{
        company?: string | null;
        number?: string | null;
      }>;
    }> | null;
};

export type ShopifyLineItemNode = {
  id?: string;
  name?: string;
  title?: string;
  sku?: string | null;
  quantity?: number;
  currentQuantity?: number;
  image?: { url?: string | null } | null;
  originalTotalSet?: MoneyBag | null;
  discountAllocations?: Array<{ allocatedAmountSet?: MoneyBag | null }>;
};

type OrdersResponse = {
  data?: {
    orders?: {
      nodes?: ShopifyOrderNode[];
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    };
  };
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
};

function graphqlError(response: { errors?: Array<{ message?: string; extensions?: { code?: string } }> }) {
  if (!response.errors?.length) return;
  const denied = response.errors.some(error => error.extensions?.code === "ACCESS_DENIED" || /access denied|read_orders/i.test(error.message ?? ""));
  const throttled = response.errors.some(error => error.extensions?.code === "THROTTLED");
  throw new ShopifyApiError(
    denied ? "Shopify 주문 접근이 거부됐습니다. read_orders 및 주문 고객정보 접근 승인을 확인해 주세요."
      : throttled ? "Shopify 주문 조회 요청량이 제한되었습니다. 잠시 후 다시 불러와 주세요."
      : "Shopify 주문 조회 형식 또는 API 응답에 오류가 있습니다. 주문 연동 점검이 필요합니다.",
    502,
    null,
  );
}

function searchQuery(filters: OrderSyncFilters) {
  const terms: string[] = [];
  if (filters.creationDateFrom) {
    terms.push(`created_at:>=${filters.creationDateFrom}`);
  }
  if (filters.creationDateTo) {
    terms.push(`created_at:<=${filters.creationDateTo}`);
  }
  if (filters.modifiedDateFrom) {
    terms.push(`updated_at:>=${filters.modifiedDateFrom}`);
  }
  if (filters.modifiedDateTo) {
    terms.push(`updated_at:<=${filters.modifiedDateTo}`);
  }
  return terms.join(" AND ");
}

const orderFields = `
  id
  legacyResourceId
  name
  createdAt
  processedAt
  updatedAt
  cancelledAt
  closedAt
  note
  displayFinancialStatus
  displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  customer { displayName }
  shippingAddress {
    name address1 address2 city provinceCode zip countryCodeV2
  }
  lineItems(first: 100) {
    nodes { id name title sku quantity currentQuantity image { url }
      originalTotalSet { shopMoney { amount currencyCode } }
      discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
    }
    pageInfo { hasNextPage endCursor }
  }
  fulfillments(first: 50) {
    id status createdAt trackingInfo { company number }
  }
`;

async function remainingLineItems(order: ShopifyOrderNode) {
  const config = getShopifyConfig();
  const items = [...(order.lineItems?.nodes ?? [])];
  let cursor = order.lineItems?.pageInfo?.endCursor ?? null;
  let hasNextPage = Boolean(order.lineItems?.pageInfo?.hasNextPage);

  while (hasNextPage && cursor && order.id) {
    const response = (await shopifyApiRequest(config, {
      method: "POST",
      path: "/graphql.json",
      body: {
        query: `query orderLineItems($id: ID!, $after: String!) {
          order(id: $id) {
            lineItems(first: 100, after: $after) {
              nodes { id name title sku quantity currentQuantity image { url }
                originalTotalSet { shopMoney { amount currencyCode } }
                discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
        variables: { id: order.id, after: cursor },
      },
    })) as {
      data?: { order?: { lineItems?: ShopifyOrderNode["lineItems"] } | null };
      errors?: Array<{ message?: string; extensions?: { code?: string } }>;
    };
    graphqlError(response);
    const connection = response.data?.order?.lineItems;
    items.push(...(connection?.nodes ?? []));
    cursor = connection?.pageInfo?.endCursor ?? null;
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
  }

  return {
    ...order,
    lineItems: {
      nodes: items,
      pageInfo: { hasNextPage: false, endCursor: cursor },
    },
  } satisfies ShopifyOrderNode;
}

export async function* getOrdersFromShopify(filters: OrderSyncFilters) {
  const config = getShopifyConfig();
  let cursor: string | null = null;

  do {
    const response = (await shopifyApiRequest(config, {
      method: "POST",
      path: "/graphql.json",
      body: {
        query: `query ordersForManager($after: String, $query: String) {
          orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT) {
            nodes { ${orderFields} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        variables: { after: cursor, query: searchQuery(filters) || null },
      },
    })) as OrdersResponse;
    graphqlError(response);

    const connection = response.data?.orders;
    const orders = await Promise.all(
      (connection?.nodes ?? []).map(remainingLineItems),
    );
    yield orders;

    cursor = connection?.pageInfo?.hasNextPage
      ? connection.pageInfo.endCursor ?? null
      : null;
  } while (cursor);
}
