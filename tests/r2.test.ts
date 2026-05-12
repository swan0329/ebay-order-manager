import { afterEach, describe, expect, it } from "vitest";
import { assertR2Configured, buildPublicR2Url, r2KeyFromPublicUrl } from "@/lib/r2";

const envKeys = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_BASE_URL",
] as const;

const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof envKeys)[number], string | undefined>;

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("r2 helpers", () => {
  it("validates required r2 environment values", () => {
    for (const key of envKeys) {
      delete process.env[key];
    }

    expect(() => assertR2Configured()).toThrow("R2_ACCOUNT_ID is required");
  });

  it("builds public url with normalized key", () => {
    expect(
      buildPublicR2Url("cards/front.jpg", "https://public.example/r2/"),
    ).toBe("https://public.example/r2/cards/front.jpg");
    expect(
      buildPublicR2Url("/cards/front.jpg", "https://public.example/r2"),
    ).toBe("https://public.example/r2/cards/front.jpg");
  });

  it("extracts r2 key from configured public url", () => {
    process.env.R2_PUBLIC_BASE_URL = "https://public.example/r2/";

    expect(r2KeyFromPublicUrl("https://public.example/r2/cards/front.jpg")).toBe(
      "cards/front.jpg",
    );
    expect(r2KeyFromPublicUrl("https://other.example/r2/cards/front.jpg")).toBeNull();
  });
});
