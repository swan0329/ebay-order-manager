import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listingFindFirst = vi.fn();
const productFindUnique = vi.fn();
const productFindFirst = vi.fn();
const listingUpdate = vi.fn();
const productUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ebayActiveListing: {
      findFirst: (...args: unknown[]) => listingFindFirst(...args),
      update: (...args: unknown[]) => listingUpdate(...args),
    },
    product: {
      findUnique: (...args: unknown[]) => productFindUnique(...args),
      findFirst: (...args: unknown[]) => productFindFirst(...args),
      update: (...args: unknown[]) => productUpdate(...args),
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        ebayActiveListing: { update: listingUpdate },
        product: { update: productUpdate },
      }),
  },
}));

const { linkEbayActiveListing, EbayListingLinkError } = await import(
  "@/lib/ebay-active-report"
);

const input = { productId: "prod-1", itemId: "123456789012" };

beforeEach(() => {
  vi.clearAllMocks();
  listingFindFirst.mockResolvedValue({
    id: "listing-1",
    itemId: input.itemId,
    productId: null,
  });
  productFindUnique.mockResolvedValue({ id: "prod-1", ebayItemId: null });
  productFindFirst.mockResolvedValue(null);
});

describe("수동 리스팅 연결", () => {
  it("보고서에 있는 리스팅을 상품에 연결하고 판매중으로 표시한다", async () => {
    await expect(linkEbayActiveListing("user-1", input)).resolves.toEqual({
      productId: "prod-1",
      itemId: input.itemId,
    });

    // 연결 검토 파일이 matchStatus != MATCHED로 거르므로 MATCHED여야 목록에서 빠진다.
    // linkedAt은 "방금 연결한 것" 목록의 정렬 기준이므로 함께 기록돼야 한다.
    expect(listingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: "prod-1",
          matchStatus: "MATCHED",
          linkedAt: expect.any(Date),
        }),
      }),
    );
    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ebayItemId: input.itemId, listingStatus: "ACTIVE" },
      }),
    );
  });

  it("보고서에 없는 상품번호는 거부한다", async () => {
    listingFindFirst.mockResolvedValue(null);

    await expect(linkEbayActiveListing("user-1", input)).rejects.toThrow(
      EbayListingLinkError,
    );
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("이미 다른 상품에 연결된 리스팅은 거부한다", async () => {
    listingFindFirst.mockResolvedValue({
      id: "listing-1",
      itemId: input.itemId,
      productId: "prod-other",
    });

    await expect(linkEbayActiveListing("user-1", input)).rejects.toThrow(
      "이미 다른 상품에 연결",
    );
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("다른 상품번호가 이미 붙은 상품은 거부한다", async () => {
    productFindUnique.mockResolvedValue({ id: "prod-1", ebayItemId: "999999999999" });

    await expect(linkEbayActiveListing("user-1", input)).rejects.toThrow(
      "이미 다른 상품번호",
    );
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("같은 상품번호를 이미 쓰는 다른 상품이 있으면 거부한다", async () => {
    productFindFirst.mockResolvedValue({ id: "prod-other", sku: "SKU-OTHER" });

    await expect(linkEbayActiveListing("user-1", input)).rejects.toThrow("SKU-OTHER");
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("같은 연결을 다시 요청해도 안전하다", async () => {
    listingFindFirst.mockResolvedValue({
      id: "listing-1",
      itemId: input.itemId,
      productId: "prod-1",
    });
    productFindUnique.mockResolvedValue({ id: "prod-1", ebayItemId: input.itemId });

    await expect(linkEbayActiveListing("user-1", input)).resolves.toEqual({
      productId: "prod-1",
      itemId: input.itemId,
    });
  });
});
