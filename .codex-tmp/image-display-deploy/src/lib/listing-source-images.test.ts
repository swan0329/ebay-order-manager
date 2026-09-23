import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  collectListingSourceImageUrls,
  resolveApprovedListingSourceImageUrls,
} from "@/lib/listing-source-images";

describe("collectListingSourceImageUrls", () => {
  it("작업자가 승인한 앞 이미지만 채널 공통 원본으로 사용한다", () => {
    expect(collectListingSourceImageUrls({
      userFrontImageUrl: " https://cdn/front.jpg ",
      userBackImageUrl: "https://cdn/back.jpg",
      sourceImageUrl: "https://cdn/source.jpg",
      imageUrl: "https://cdn/legacy.jpg",
      ebayImageUrls: ["https://cdn/gallery.jpg"],
    })).toEqual(["https://cdn/front.jpg"]);
  });

  it("이미지가공 완료 상품은 과거 촬영본보다 가공 결과를 우선한다", () => {
    expect(collectListingSourceImageUrls({
      imageSource: "lens_workbench",
      userFrontImageUrl: "https://cdn/photographed-original.jpg",
      userBackImageUrl: null,
      sourceImageUrl: "https://cdn/source.jpg",
      imageUrl: "https://cdn/approved-worked-image.jpg",
      ebayImageUrls: [],
    })).toEqual(["https://cdn/approved-worked-image.jpg"]);
  });

  it("채널 파생 이미지를 다시 원본으로 사용하지 않는다", () => {
    expect(collectListingSourceImageUrls({
      sourceImageUrl: "https://cdn/source.jpg",
      userFrontImageUrl: null,
      userBackImageUrl: null,
      imageUrl: "https://r2/products/channel-watermarked/a.jpg",
      ebayImageUrls: ["https://r2/products/ebay-watermarked/b.jpg"],
    })).toEqual([]);
  });

  it("포카마켓 원본과 과거 갤러리는 승인 이력 없이 등록 원본으로 승격하지 않는다", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    await expect(resolveApprovedListingSourceImageUrls({
      id: "unapproved", imageSource: "pocamarket",
      imageUrl: "https://cdn/pocamarket.jpg", sourceImageUrl: "https://cdn/pocamarket.jpg",
      ebayImageUrls: ["https://cdn/old-gallery.jpg"],
    })).resolves.toEqual([]);
  });

  it("출처 표시만 Lens이고 이미지가 공급처 원본과 같으면 차단한다", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ imageUrl: "https://cdn/pocamarket.jpg" }]);
    await expect(resolveApprovedListingSourceImageUrls({
      id: "wrong-source", imageSource: "lens_workbench", imageUrl: "https://cdn/pocamarket.jpg",
      sourceImageUrl: "https://cdn/pocamarket.jpg", ebayImageUrls: [],
    })).resolves.toEqual([]);
  });

  it("출처 필드가 잘못됐거나 비어 있어도 공급처 CDN 원본을 거부한다", async () => {
    const url = "https://ndc.infludeo.com/media/photocard_blur/2024/08/card.jpg";
    prismaMock.$queryRaw.mockResolvedValueOnce([{ imageUrl: url }]);
    await expect(resolveApprovedListingSourceImageUrls({
      id: "supplier-cdn", imageSource: "lens_workbench", imageUrl: url, sourceImageUrl: null,
      userFrontImageUrl: url, ebayImageUrls: [],
    })).resolves.toEqual([]);
  });

  it("대표 이미지가 과거 파생 URL이면 명시적 승인 이력에서 원본을 복구한다", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { imageUrl: "https://r2/products/ebay-watermarked/old.jpg" },
      { imageUrl: "https://r2/products/101214/lens-card.jpg" },
    ]);
    await expect(resolveApprovedListingSourceImageUrls({
      id: "product-1",
      sourceImageUrl: null,
      userFrontImageUrl: null,
      userBackImageUrl: null,
      imageUrl: "https://r2/products/ebay-watermarked/current.jpg",
      ebayImageUrls: ["https://r2/products/channel-watermarked/current.jpg"],
    })).resolves.toEqual(["https://r2/products/101214/lens-card.jpg"]);
  });
});
