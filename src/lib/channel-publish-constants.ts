/**
 * 채널 작업에서 화면·요청 처리·업무 로직이 함께 쓰는 값.
 *
 * 업무 로직 모듈은 서버 전용이라 화면과 테스트에서 그대로 부를 수 없다. 여기에 두어야
 * 오류 메시지와 화면 표시가 같은 말을 쓴다.
 */

/**
 * 같은 채널·작업에 이미 실행 중인 것이 있어 차례를 기다리는 상태.
 *
 * 채널 쓰기는 한 번에 하나만 돌아야 한다. 그렇다고 새 요청을 거절하면 사람이 완료를
 * 지켜보다 다시 눌러야 한다. 거절하는 대신 줄을 세우고, 앞 작업이 끝나면 이어서
 * 실행한다. 실행 권리는 activeKey 하나를 잡는 것으로 정해지므로 동시에 돌 수 없다.
 */
export const WAITING_STATUS = "WAITING";

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
