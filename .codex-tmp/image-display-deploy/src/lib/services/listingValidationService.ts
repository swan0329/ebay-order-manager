import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  accountHasScope,
  sellInventoryScope,
} from "@/lib/services/ebayApiService";
import type { ListingUploadInput } from "@/lib/services/inventoryService";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { getCategoryAspects } from "@/lib/services/ebayTaxonomyService";

export type ListingValidationIssue = {
  field: string;
  message: string;
};

export type ListingValidationResult = {
  valid: boolean;
  issues: ListingValidationIssue[];
};

function issue(field: string, message: string): ListingValidationIssue {
  return { field, message };
}

function addZodIssues(issues: ListingValidationIssue[], error: z.ZodError) {
  const labels: Record<string, string> = {
    sku: "SKU",
    title: "상품명",
    price: "판매가격",
    quantity: "판매수량",
    imageUrls: "상품 이미지",
    categoryId: "eBay 카테고리",
    condition: "상품 상태",
    paymentProfile: "결제정책",
    shippingProfile: "배송정책",
    returnProfile: "반품정책",
    merchantLocationKey: "eBay 재고 위치",
  };
  for (const zodIssue of error.issues) {
    const field = zodIssue.path.join(".") || "input";
    const root = String(zodIssue.path[0] ?? "input");
    issues.push(issue(field, `${labels[root] ?? field} 입력값을 확인해 주세요.`));
  }
}

async function isReachableImageUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  const signal = AbortSignal.timeout(5000);

  try {
    const head = await fetch(url, { method: "HEAD", signal });

    if (head.ok) {
      return true;
    }

    if (![403, 405].includes(head.status)) {
      return false;
    }
  } catch {
    // Some object storage/CDNs reject HEAD. Try a tiny GET before failing.
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { range: "bytes=0-0" },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

async function validateImageUrls(input: ListingUploadInput) {
  const checks = await Promise.all(
    input.imageUrls.map(async (url, index) => ({
      index,
      url,
      reachable: await isReachableImageUrl(url),
    })),
  );

  return checks
    .filter((check) => !check.reachable)
    .map((check) =>
      issue(
        `image_urls[${check.index}]`,
        `이미지 URL에 접근할 수 없습니다: ${check.url}`,
      ),
    );
}

async function validateInventoryScope(userId: string) {
  const account = await prisma.ebayAccount.findFirst({
    where: { userId, environment: currentEbayEnvironment() },
    orderBy: { updatedAt: "desc" },
  });

  if (!account) {
    return [
      issue(
        "oauth",
        "eBay 계정이 연결되어 있지 않습니다. 먼저 eBay 연결을 완료해 주세요.",
      ),
    ];
  }

  if (!accountHasScope(account, sellInventoryScope)) {
    return [
      issue(
        "oauth",
        "eBay OAuth token에 sell.inventory 권한이 없습니다. eBay 연결을 다시 승인해 주세요.",
      ),
    ];
  }

  return [];
}

async function validateRequiredAspects(userId: string, input: ListingUploadInput) {
  if (!input.categoryId) {
    return [];
  }

  const { aspects } = await getCategoryAspects({
    userId,
    categoryId: input.categoryId,
    marketplaceId: input.marketplaceId,
  });
  const issues: ListingValidationIssue[] = [];
  const itemSpecifics = input.itemSpecifics ?? {};

  for (const aspect of aspects.filter((entry) => entry.required)) {
    const values = itemSpecifics[aspect.name] ?? [];

    if (!values.length || values.every((value) => !String(value).trim())) {
      issues.push(
        issue(
          `item_specifics.${aspect.name}`,
          `Required eBay item specific is missing: ${aspect.name}`,
        ),
      );
    }
  }

  return issues;
}

export async function validateListingUploadInput(
  input: ListingUploadInput,
  options?: {
    userId?: string;
    checkImageUrls?: boolean;
    checkOAuthScope?: boolean;
    checkCategoryAspects?: boolean;
  },
): Promise<ListingValidationResult> {
  const issues: ListingValidationIssue[] = [];
  const parsed = z
    .object({
      sku: z.string().trim().min(1),
      title: z.string().trim().min(1),
      price: z.coerce.number().positive(),
      quantity: z.coerce.number().int().min(0),
      imageUrls: z.array(z.string().trim().min(1)).min(1),
      categoryId: z.string().trim().min(1),
      condition: z.string().trim().min(1),
      paymentProfile: z.string().trim().min(1),
      shippingProfile: z.string().trim().min(1),
      returnProfile: z.string().trim().min(1),
      merchantLocationKey: z.string().trim().min(1),
    })
    .safeParse(input);

  if (!parsed.success) {
    addZodIssues(issues, parsed.error);
  }

  if (options?.checkImageUrls) {
    issues.push(...(await validateImageUrls(input)));
  }

  if (options?.checkOAuthScope && options.userId) {
    issues.push(...(await validateInventoryScope(options.userId)));
  }

  if (options?.checkCategoryAspects && options.userId && parsed.success) {
    issues.push(...(await validateRequiredAspects(options.userId, input)));
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
