import { beforeAll, describe, expect, it, vi } from "vitest";
import { Script } from "node:vm";

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

  it("Shopify 실제 variant 사진·가격·재고 상태를 사용하며 상품 유형으로 제외하지 않는다", () => {
    expect(snippet).toContain("variant.featured_media.preview_image");
    expect(snippet).toContain("variant.price | money");
    expect(snippet).toContain("unless variant.available");
    expect(snippet).not.toContain("product.product_type == 'Photocard'");
  });

  it("테마에 넣는 브라우저 JavaScript는 문법 오류가 없다", () => {
    const script = snippet.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script!)).not.toThrow();
  });

  it("카드 선택은 현재 화면에서 장바구니 대상만 바꾸며 테마의 페이지 이동을 호출하지 않는다", () => {
    expect(snippet).not.toContain("nativeInput.click()");
    expect(snippet).not.toContain("history.replaceState");
    expect(snippet).toContain("form.querySelectorAll('[name=\"id\"]')");
  });

  it("Shopify 테마의 표준 variant change 흐름으로 가격과 대표 미디어를 갱신한다", () => {
    expect(snippet).toContain("nativeInput.dispatchEvent(new Event('change', { bubbles: true }))");
    expect(snippet).toContain("nativeComponent.insertAdjacentElement('afterend', root)");
    expect(snippet).toContain("nativeComponent.style.display = 'none'");
  });

  it("카드 선택 시 현재 보이는 상품 갤러리의 큰 이미지를 해당 옵션 사진으로 바꾼다", () => {
    expect(snippet).toContain("media-gallery");
    expect(snippet).toContain("slideshow-slide[aria-hidden=\"false\"] .product-media__image");
    expect(snippet).toContain("mainImage.src = imageUrl");
  });

});
