import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  accountHasScope,
  sellInventoryScope,
} from "@/lib/services/ebayApiService";
import type { ListingUploadInput } from "@/lib/services/inventoryService";
import { currentEbayEnvironment } from "@/lib/ebay-environment";

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
  for (const zodIssue of error.issues) {
    const field = zodIssue.path.join(".") || "input";
    issues.push(issue(field, `${field} 입력값을 확인해 주세요.`));
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
  const issues: ListingValidationIssue[] = [];

  for (const [index, url] of input.imageUrls.entries()) {
    if (!(await isReachableImageUrl(url))) {
      issues.push(
        issue(
          `image_urls[${index}]`,
          `이미지 URL에 접근할 수 없습니다: ${url}`,
        ),
      );
    }
  }

  return issues;
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

export async function validateListingUploadInput(
  input: ListingUploadInput,
  options?: {
    userId?: string;
    checkImageUrls?: boolean;
    checkOAuthScope?: boolean;
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

  return {
    valid: issues.length === 0,
    issues,
  };
}
