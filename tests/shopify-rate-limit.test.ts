import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getShopifyConfig: () => ({ storeDomain: "s.myshopify.com", apiVersion: "2024-10" }),
}));
vi.mock("@/lib/safe-log", () => ({ safeLog: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const config = { storeDomain: "s.myshopify.com", apiVersion: "2024-10", accessToken: "t" } as never;

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

// 429는 잘못된 요청이 아니라 "잠시 뒤에"라는 뜻이다. 실패로 처리하면 그 상품은
// 반영되지 않은 채 남고 다음 주기에 또 막힌다.
it("429를 받으면 Retry-After만큼 기다렸다 다시 보낸다", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response("rate", { status: 429, headers: { "retry-after": "2" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const { shopifyApiRequest } = await import("@/lib/services/shopifyService");
  const promise = shopifyApiRequest(config, { path: "/variants/1.json" });
  await vi.advanceTimersByTimeAsync(20_000);

  await expect(promise).resolves.toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("계속 429면 호출 한도임을 알리고 멈춘다", async () => {
  // 본문은 한 번만 읽을 수 있다. 호출마다 새 응답을 만든다.
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("rate", { status: 429 })));
  const { shopifyApiRequest } = await import("@/lib/services/shopifyService");
  const promise = shopifyApiRequest(config, { path: "/variants/1.json" }).catch((error: Error) => error);
  await vi.advanceTimersByTimeAsync(120_000);
  const error = await promise;
  expect(String((error as Error).message)).toContain("호출 한도");
});
