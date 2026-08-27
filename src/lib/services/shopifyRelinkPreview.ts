import { createHmac, timingSafeEqual } from "node:crypto";
import { requiredEnv } from "@/lib/env";

const TOKEN_TTL_MS = 15 * 60 * 1000;

type ShopifyRelinkPreviewPayload = {
  seedProductId: string;
  targetShopifyProductId: string;
  issuedAt: number;
};

function signature(body: string) {
  return createHmac("sha256", requiredEnv("SESSION_SECRET"))
    .update(body)
    .digest("base64url");
}

export function issueShopifyRelinkPreviewToken(
  seedProductId: string,
  targetShopifyProductId: string,
  issuedAt = Date.now(),
) {
  const body = Buffer.from(
    JSON.stringify({
      seedProductId,
      targetShopifyProductId,
      issuedAt,
    } satisfies ShopifyRelinkPreviewPayload),
  ).toString("base64url");
  return `${body}.${signature(body)}`;
}

export function verifyShopifyRelinkPreviewToken(
  token: string,
  seedProductId: string,
  targetShopifyProductId: string,
  now = Date.now(),
) {
  const [body, supplied] = token.split(".");
  if (!body || !supplied) return false;
  const expected = signature(body);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return false;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as ShopifyRelinkPreviewPayload;
    return (
      parsed.seedProductId === seedProductId &&
      parsed.targetShopifyProductId === targetShopifyProductId &&
      now - parsed.issuedAt >= 0 &&
      now - parsed.issuedAt <= TOKEN_TTL_MS
    );
  } catch {
    return false;
  }
}
