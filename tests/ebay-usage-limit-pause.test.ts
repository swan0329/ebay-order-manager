import { describe, expect, it } from "vitest";

/**
 * eBay 일일 호출 한도(518)는 그 상품의 문제가 아니라 계정 전체의 문제다. 실패로
 * 적어 두면 한도가 풀린 뒤에도 다시 시도하지 않아 상품이 품절로 남는다.
 */
type Target = { sku: string; inventoryApplied?: boolean; inventoryError?: string };

function clearUsageLimitErrors(targets: Target[]) {
  for (const target of targets) {
    if (target.inventoryError?.includes("518")) target.inventoryError = undefined;
  }
  return targets;
}

const pending = (targets: Target[]) =>
  targets.filter((target) => !target.inventoryApplied && !target.inventoryError);

describe("호출 한도 초과 처리", () => {
  it("한도 때문에 실패한 것은 다시 시도할 대상으로 되돌린다", () => {
    const targets: Target[] = [
      { sku: "1", inventoryApplied: true },
      { sku: "2", inventoryError: "GetItem 실패 · usage limit (오류코드 518)" },
      { sku: "3", inventoryError: "eBay 정확한 판매 옵션을 확인하지 못했습니다" },
      { sku: "4" },
    ];
    clearUsageLimitErrors(targets);
    expect(pending(targets).map((target) => target.sku)).toEqual(["2", "4"]);
  });

  it("상품 자체의 실패는 그대로 실패로 남긴다", () => {
    const targets: Target[] = [{ sku: "9", inventoryError: "판매 옵션을 확인하지 못했습니다" }];
    clearUsageLimitErrors(targets);
    expect(targets[0].inventoryError).toBeDefined();
    expect(pending(targets)).toHaveLength(0);
  });

  it("되돌린 뒤에도 이미 반영된 것은 다시 건드리지 않는다", () => {
    const targets: Target[] = [
      { sku: "5", inventoryApplied: true },
      { sku: "6", inventoryApplied: true, inventoryError: "usage limit 518" },
    ];
    clearUsageLimitErrors(targets);
    expect(pending(targets)).toHaveLength(0);
  });
});
