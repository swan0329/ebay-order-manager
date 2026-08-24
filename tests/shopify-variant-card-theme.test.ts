import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let injectVariantCardRender: typeof import("@/lib/services/shopifyVariantCardTheme").injectVariantCardRender;
let snippet: string;

beforeAll(async () => {
  const themeService = await import("@/lib/services/shopifyVariantCardTheme");
  injectVariantCardRender = themeService.injectVariantCardRender;
  snippet = themeService.SHOPIFY_VARIANT_CARD_SNIPPET;
});

describe("Shopify 옵션 카드 테마", () => {
  it("body 끝 직전에 한 번만 설치한다", () => {
    const first = injectVariantCardRender("<html><body>{{ content_for_layout }}</body></html>");
    const second = injectVariantCardRender(first);
    expect(first).toBe(second);
    expect(first.indexOf("PHOTOCARD_VARIANT_CARDS_START")).toBeLessThan(first.indexOf("</body>"));
  });

  it("안전한 삽입 지점이 없으면 변경하지 않는다", () => {
    expect(() => injectVariantCardRender("<html></html>")).toThrow("</body>");
  });

  it("Shopify 실제 variant 사진·가격·재고 상태를 사용한다", () => {
    expect(snippet).toContain("variant.featured_media.preview_image");
    expect(snippet).toContain("variant.price | money");
    expect(snippet).toContain("unless variant.available");
    expect(snippet).toContain("product.product_type == 'Photocard'");
  });
});
