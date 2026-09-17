import { describe, expect, it } from "vitest";
import { verifyEbayPictures } from "@/lib/ebay-image-verification";

const ours = ["https://r2/a.jpg", "https://r2/b.jpg"];
const rehosted = [
  "https://i.ebayimg.com/images/g/AAA/s-l1600.jpg",
  "https://i.ebayimg.com/images/g/BBB/s-l1600.jpg",
];

describe("eBay 이미지 반영 확인", () => {
  it("Inventory API로 대조했으면 그것으로 확인한다", () => {
    expect(
      verifyEbayPictures({
        expected: ours,
        pictureUrls: rehosted,
        externalUrls: [],
        inventoryVerified: true,
      }),
    ).toEqual({ verified: true, method: "inventory" });
  });

  it("원본 주소를 돌려주면 그 주소로 확인한다", () => {
    expect(
      verifyEbayPictures({ expected: ours, pictureUrls: rehosted, externalUrls: ours }),
    ).toEqual({ verified: true, method: "source_url" });
  });

  it("원본 주소를 주지 않는 리스팅은 사진 개수로 확인한다", () => {
    expect(
      verifyEbayPictures({ expected: ours, pictureUrls: rehosted, externalUrls: [] }),
    ).toEqual({ verified: true, method: "picture_count" });
  });

  it("사진 개수가 다르면 확인하지 않는다", () => {
    expect(
      verifyEbayPictures({
        expected: ours,
        pictureUrls: [rehosted[0]],
        externalUrls: [],
      }),
    ).toEqual({ verified: false, method: "none" });
  });

  it("원본 주소를 주는데 우리 주소가 없으면 확인하지 않는다", () => {
    expect(
      verifyEbayPictures({
        expected: ours,
        pictureUrls: rehosted,
        externalUrls: ["https://r2/other.jpg", "https://r2/another.jpg"],
      }),
    ).toEqual({ verified: false, method: "none" });
  });

  it("사진이 하나도 없으면 확인하지 않는다", () => {
    expect(
      verifyEbayPictures({ expected: ours, pictureUrls: [], externalUrls: [] }),
    ).toEqual({ verified: false, method: "none" });
  });
});
