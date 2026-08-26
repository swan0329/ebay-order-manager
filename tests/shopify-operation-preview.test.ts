import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => { process.env.SESSION_SECRET = "shopify-operation-preview-test-secret"; });

describe("Shopify operation preview token", () => {
  it("binds the approved action and complete target snapshot", async () => {
    const { issueShopifyOperationPreviewToken, verifyShopifyOperationPreviewToken } = await import("@/lib/services/shopifyOperationPreview");
    const targets = [{ targetId: "group:one", productIds: ["b", "a"], sku: "VAR-ONE" }];
    const token = issueShopifyOperationPreviewToken("CREATE", targets, 1_000);
    expect(verifyShopifyOperationPreviewToken(token, "CREATE", ["group:one"], 1_500)).toEqual([{ targetId: "group:one", productIds: ["a", "b"], sku: "VAR-ONE" }]);
    expect(verifyShopifyOperationPreviewToken(token, "CHANGE", ["group:one"], 1_500)).toBeNull();
    expect(verifyShopifyOperationPreviewToken(token, "CREATE", ["other"], 1_500)).toBeNull();
  });

  it("expires after fifteen minutes", async () => {
    const { issueShopifyOperationPreviewToken, verifyShopifyOperationPreviewToken } = await import("@/lib/services/shopifyOperationPreview");
    const token = issueShopifyOperationPreviewToken("CREATE", [{ targetId: "one", productIds: ["p1"], sku: "ONE" }], 1_000);
    expect(verifyShopifyOperationPreviewToken(token, "CREATE", ["one"], 1_000 + 16 * 60 * 1_000)).toBeNull();
  });
});
