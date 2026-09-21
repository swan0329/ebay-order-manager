// 사람에게 보여 줄 채널 작업 이름. 화면과 오류 메시지가 같은 말을 써야 한다.
const publishModeLabel: Record<string, string> = {
  REGISTER: "신규등록",
  UPSERT: "등록·갱신",
  PRICE_INVENTORY: "가격·재고",
  IMAGES: "이미지",
  ARCHIVE: "판매중단",
};

export function publishJobLabel(channel: string, mode: string) {
  return `${channel === "EBAY" ? "eBay" : "Shopify"} ${publishModeLabel[mode] ?? mode}`;
}
