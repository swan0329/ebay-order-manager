export type EbayPictureCheck = {
  /** 우리가 보낸 이미지 주소 */
  expected: string[];
  /** GetItem이 돌려준 사진 주소(eBay가 자기 서버로 복사한 주소) */
  pictureUrls: string[];
  /** GetItem이 돌려준 원본 주소. eBay가 주지 않는 리스팅이 많다. */
  externalUrls: string[];
  /** Inventory API로 이미 정확히 대조했는지 */
  inventoryVerified?: boolean;
};

export type EbayPictureVerification = {
  verified: boolean;
  /** 무엇으로 확인했는지. 로그에 남겨 사람이 판단할 수 있게 한다. */
  method: "inventory" | "source_url" | "picture_count" | "none";
};

/**
 * eBay는 URL로 받은 사진을 자기 서버(i.ebayimg.com)로 복사하고, 리스팅에 따라
 * 원본 주소(ExternalPictureURL)를 아예 돌려주지 않는다. 원본 주소 일치만 고집하면
 * 실제로는 반영된 변경이 매번 실패로 남는다. 확인 수단을 다음 순서로 낮춘다.
 *
 * 1. Inventory API로 주소를 그대로 대조했으면 그것이 가장 정확하다.
 * 2. GetItem이 원본 주소를 돌려주면 그 주소가 모두 들어 있는지 본다.
 * 3. 원본 주소를 하나도 돌려주지 않으면 사진 개수 일치까지만 확인한다.
 *    이 경우 "구매자 화면 이미지까지 확인했다"고 말하지 않는다.
 */
export function verifyEbayPictures(check: EbayPictureCheck): EbayPictureVerification {
  if (check.inventoryVerified) return { verified: true, method: "inventory" };
  if (!check.expected.length) return { verified: true, method: "source_url" };
  const matchedBySource = check.expected.every(
    (url) => check.pictureUrls.includes(url) || check.externalUrls.includes(url),
  );
  if (matchedBySource) return { verified: true, method: "source_url" };
  if (
    check.externalUrls.length === 0 &&
    check.pictureUrls.length === check.expected.length
  ) {
    return { verified: true, method: "picture_count" };
  }
  return { verified: false, method: "none" };
}
