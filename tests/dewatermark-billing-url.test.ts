import { afterEach, describe, expect, it } from "vitest";
import { getDewatermarkBillingUrl } from "@/lib/dewatermark-api";

const original = process.env.DEWATERMARK_BILLING_URL;
afterEach(() => {
  if (original === undefined) delete process.env.DEWATERMARK_BILLING_URL;
  else process.env.DEWATERMARK_BILLING_URL = original;
});

describe("Dewatermark 크레딧 충전 주소", () => {
  it("설정이 없으면 공식 API 관리 화면으로 보낸다", () => {
    delete process.env.DEWATERMARK_BILLING_URL;
    expect(getDewatermarkBillingUrl()).toBe(
      "https://dewatermark.ai/ko/api-management",
    );
  });

  it("설정한 https 주소를 사용한다", () => {
    process.env.DEWATERMARK_BILLING_URL = "https://dewatermark.ai/ko/my-plan";
    expect(getDewatermarkBillingUrl()).toBe("https://dewatermark.ai/ko/my-plan");
  });

  it("https가 아니거나 형식이 틀린 값은 쓰지 않는다", () => {
    for (const value of ["http://dewatermark.ai", "javascript:alert(1)", "?", " "]) {
      process.env.DEWATERMARK_BILLING_URL = value;
      expect(getDewatermarkBillingUrl()).toBe(
        "https://dewatermark.ai/ko/api-management",
      );
    }
  });
});
