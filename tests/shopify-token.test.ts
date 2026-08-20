import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getShopifyAccessToken, resetShopifyTokenCache } = await import(
  "@/lib/services/shopifyToken"
);

const base = {
  storeDomain: "example.myshopify.com",
  accessToken: "",
  clientId: "client-1",
  clientSecret: "secret-1",
  apiVersion: "2025-10",
  locationId: null,
};

// 응답 본문은 한 번만 읽을 수 있으므로 호출마다 새로 만든다.
function mockToken(token: string, expiresIn = 86399) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
        status: 200,
      }),
  );
}

afterEach(() => {
  resetShopifyTokenCache();
  vi.unstubAllGlobals();
});

describe("Shopify 토큰 발급", () => {
  it("고정 토큰이 있으면 발급받지 않는다", async () => {
    // 예전 설정을 그대로 쓰는 환경을 깨지 않기 위해서다.
    const fetchMock = mockToken("shpat_new");
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      getShopifyAccessToken({ ...base, accessToken: "shpat_fixed" }),
    ).resolves.toBe("shpat_fixed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("자격 증명으로 토큰을 발급받는다", async () => {
    const fetchMock = mockToken("shpat_minted");
    vi.stubGlobal("fetch", fetchMock);
    await expect(getShopifyAccessToken(base)).resolves.toBe("shpat_minted");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.myshopify.com/admin/oauth/access_token");
    expect(String((init as RequestInit).body)).toContain("grant_type=client_credentials");
  });

  it("만료 전에는 받아 둔 토큰을 다시 쓴다", async () => {
    // 호출할 때마다 발급받으면 Shopify에 불필요한 요청이 쌓인다.
    const fetchMock = mockToken("shpat_minted");
    vi.stubGlobal("fetch", fetchMock);
    const now = () => 1_000_000;
    await getShopifyAccessToken(base, now);
    await getShopifyAccessToken(base, now);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("만료가 다가오면 새로 받는다", async () => {
    // 24시간 뒤 만료되므로 다시 받지 않으면 그때부터 모든 호출이 실패한다.
    const fetchMock = mockToken("shpat_minted", 3600);
    vi.stubGlobal("fetch", fetchMock);
    await getShopifyAccessToken(base, () => 0);
    // 만료 4분 전. 여유 시간 안에 들어왔으므로 새로 받아야 한다.
    await getShopifyAccessToken(base, () => 3600 * 1000 - 4 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("자격 증명이 없으면 무엇을 넣어야 하는지 알린다", async () => {
    await expect(
      getShopifyAccessToken({ ...base, clientId: "", clientSecret: "" }),
    ).rejects.toThrow(/SHOPIFY_CLIENT_ID/);
  });

  it("발급 실패는 사유를 그대로 알린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid_client", { status: 401 })),
    );
    await expect(getShopifyAccessToken(base)).rejects.toThrow(/401/);
  });
});
