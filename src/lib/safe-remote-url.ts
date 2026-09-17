import { lookup } from "node:dns/promises";
import net from "node:net";

function privateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return (
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe80:")
  );
}

/**
 * 사람이 붙여넣은 주소를 서버가 대신 내려받기 전에 확인한다. 내부망 주소를 그대로
 * 받아오면 외부에 공개되지 않은 서비스를 서버가 대신 읽어 줄 수 있다.
 */
export async function assertSafeRemoteUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("http/https 주소만 사용할 수 있습니다.");
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address))) {
    throw new Error("내부 네트워크 주소는 사용할 수 없습니다.");
  }
  return url;
}
