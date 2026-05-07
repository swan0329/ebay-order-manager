import { afterEach, describe, expect, it } from "vitest";
import { EbayEnvironment } from "../src/generated/prisma";
import { currentEbayEnvironment } from "../src/lib/ebay-environment";
import { getEbayConfig } from "../src/lib/env";

const originalEnv = {
  EBAY_ENV: process.env.EBAY_ENV,
  EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID,
  EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET,
  EBAY_RU_NAME: process.env.EBAY_RU_NAME,
};

afterEach(() => {
  process.env.EBAY_ENV = originalEnv.EBAY_ENV;
  process.env.EBAY_CLIENT_ID = originalEnv.EBAY_CLIENT_ID;
  process.env.EBAY_CLIENT_SECRET = originalEnv.EBAY_CLIENT_SECRET;
  process.env.EBAY_RU_NAME = originalEnv.EBAY_RU_NAME;
});

describe("eBay environment configuration", () => {
  it("uses production eBay hosts when EBAY_ENV is production", () => {
    process.env.EBAY_ENV = "production";
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_CLIENT_SECRET = "client-secret";
    process.env.EBAY_RU_NAME = "ru-name";

    const config = getEbayConfig();

    expect(config.environment).toBe("production");
    expect(config.hosts.auth).toBe("https://auth.ebay.com");
    expect(config.hosts.api).toBe("https://api.ebay.com");
    expect(config.hosts.identity).toBe("https://apiz.ebay.com");
    expect(currentEbayEnvironment()).toBe(EbayEnvironment.PRODUCTION);
  });
});
