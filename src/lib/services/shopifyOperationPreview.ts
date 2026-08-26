import { createHmac, timingSafeEqual } from "node:crypto";
import { requiredEnv } from "@/lib/env";

const TOKEN_TTL_MS = 15 * 60 * 1000;

export type ShopifyOperationAction = "CREATE" | "CHANGE" | "UNAVAILABLE" | "IMAGE_REPAIR";
export type ShopifyOperationPreviewTarget = { targetId: string; productIds: string[]; sku: string };

type PreviewPayload = {
  action: ShopifyOperationAction;
  issuedAt: number;
  targets: ShopifyOperationPreviewTarget[];
};

function normalizedTargets(targets: ShopifyOperationPreviewTarget[]) {
  return targets
    .map((target) => ({ ...target, productIds: [...new Set(target.productIds)].sort() }))
    .sort((a, b) => a.targetId.localeCompare(b.targetId));
}

function signature(body: string) {
  return createHmac("sha256", requiredEnv("SESSION_SECRET")).update(body).digest("base64url");
}

export function issueShopifyOperationPreviewToken(
  action: ShopifyOperationAction,
  targets: ShopifyOperationPreviewTarget[],
  issuedAt = Date.now(),
) {
  const body = Buffer.from(JSON.stringify({ action, issuedAt, targets: normalizedTargets(targets) } satisfies PreviewPayload)).toString("base64url");
  return `${body}.${signature(body)}`;
}

export function verifyShopifyOperationPreviewToken(
  token: string,
  action: ShopifyOperationAction,
  targetIds: string[],
  now = Date.now(),
): ShopifyOperationPreviewTarget[] | null {
  const [body, supplied] = token.split(".");
  if (!body || !supplied) return null;
  const expected = signature(body);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as PreviewPayload;
    const expectedIds = [...new Set(targetIds)].sort();
    const tokenIds = parsed.targets.map((target) => target.targetId).sort();
    if (parsed.action !== action || JSON.stringify(tokenIds) !== JSON.stringify(expectedIds)) return null;
    if (now - parsed.issuedAt < 0 || now - parsed.issuedAt > TOKEN_TTL_MS) return null;
    return normalizedTargets(parsed.targets);
  } catch {
    return null;
  }
}
