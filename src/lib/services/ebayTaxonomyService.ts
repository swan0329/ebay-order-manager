import { ebayApiRequest, getActiveEbayInventoryAccount } from "@/lib/services/ebayApiService";

type AspectValueRecord = {
  localizedValue?: string;
};

type AspectRecord = {
  localizedAspectName?: string;
  aspectConstraint?: {
    aspectRequired?: boolean;
    aspectUsage?: string;
    aspectMode?: string;
    aspectDataType?: string;
    itemToAspectCardinality?: string;
    aspectMaxLength?: number;
  };
  aspectValues?: AspectValueRecord[];
};

export type EbayCategoryAspect = {
  name: string;
  requirement: "required" | "recommended" | "optional";
  required: boolean;
  usage: string;
  mode: string;
  dataType: string;
  cardinality: "single" | "multi";
  maxLength: number | null;
  values: string[];
};

function normalizeAspect(aspect: AspectRecord): EbayCategoryAspect | null {
  const name = String(aspect.localizedAspectName ?? "").trim();

  if (!name) {
    return null;
  }

  const constraint = aspect.aspectConstraint ?? {};
  const usage = String(constraint.aspectUsage ?? "").trim().toUpperCase();
  const required = Boolean(constraint.aspectRequired);
  const requirement = required
    ? "required"
    : usage === "RECOMMENDED"
      ? "recommended"
      : "optional";
  const cardinality =
    String(constraint.itemToAspectCardinality ?? "").toUpperCase() === "MULTI"
      ? "multi"
      : "single";

  return {
    name,
    requirement,
    required,
    usage,
    mode: String(constraint.aspectMode ?? "").trim(),
    dataType: String(constraint.aspectDataType ?? "").trim(),
    cardinality,
    maxLength: constraint.aspectMaxLength ?? null,
    values:
      aspect.aspectValues
        ?.map((entry) => String(entry.localizedValue ?? "").trim())
        .filter(Boolean) ?? [],
  };
}

export async function getDefaultCategoryTreeId(
  userId: string,
  marketplaceId = "EBAY_US",
) {
  const account = await getActiveEbayInventoryAccount(userId);
  const result = await ebayApiRequest(account, {
    path: "/commerce/taxonomy/v1/get_default_category_tree_id",
    query: { marketplace_id: marketplaceId },
  });
  const body = result.body as { categoryTreeId?: string } | null;
  const categoryTreeId = String(body?.categoryTreeId ?? "").trim();

  if (!categoryTreeId) {
    throw new Error("Could not resolve eBay category tree ID.");
  }

  return categoryTreeId;
}

export async function getCategoryAspects(input: {
  userId: string;
  categoryId: string;
  marketplaceId?: string | null;
}) {
  const categoryId = input.categoryId.trim();

  if (!categoryId) {
    return { categoryTreeId: null, aspects: [] as EbayCategoryAspect[] };
  }

  const marketplaceId = input.marketplaceId?.trim() || "EBAY_US";
  const account = await getActiveEbayInventoryAccount(input.userId);
  const categoryTreeId = await getDefaultCategoryTreeId(input.userId, marketplaceId);
  const result = await ebayApiRequest(account, {
    path: `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
      categoryTreeId,
    )}/get_item_aspects_for_category`,
    query: { category_id: categoryId },
  });
  const body = result.body as { aspects?: AspectRecord[] } | null;
  const aspects =
    body?.aspects?.map(normalizeAspect).filter((aspect): aspect is EbayCategoryAspect =>
      Boolean(aspect),
    ) ?? [];

  return { categoryTreeId, aspects };
}
