import { describe, expect, it } from "vitest";
import {
  DEFAULT_POCAMARKET_BATCH_SIZE,
  MAX_POCAMARKET_BATCH_SIZE,
  POCAMARKET_RESULT_SAVE_MAX_ATTEMPTS,
  normalizePocamarketBatchSize,
  pocamarketResultSaveFailureStatus,
} from "@/lib/pocamarket-sync";

describe("Pocamarket sync persistence recovery", () => {
  it("requeues a result while persistence retries remain", () => {
    expect(pocamarketResultSaveFailureStatus(0)).toBe("QUEUED");
    expect(pocamarketResultSaveFailureStatus(1)).toBe("QUEUED");
  });

  it("terminates a result after the bounded number of attempts", () => {
    expect(POCAMARKET_RESULT_SAVE_MAX_ATTEMPTS).toBe(3);
    expect(pocamarketResultSaveFailureStatus(2)).toBe("FAILED");
    expect(pocamarketResultSaveFailureStatus(99)).toBe("FAILED");
  });

  it("uses a safe scheduled default while allowing a larger manual batch", () => {
    expect(DEFAULT_POCAMARKET_BATCH_SIZE).toBe(1_000);
    expect(normalizePocamarketBatchSize()).toBe(DEFAULT_POCAMARKET_BATCH_SIZE);
    expect(normalizePocamarketBatchSize(2_000)).toBe(2_000);
    expect(normalizePocamarketBatchSize(MAX_POCAMARKET_BATCH_SIZE)).toBe(10_000);
  });

  it("rejects invalid manual batch sizes", () => {
    expect(() => normalizePocamarketBatchSize(0)).toThrow();
    expect(() => normalizePocamarketBatchSize(10_001)).toThrow();
    expect(() => normalizePocamarketBatchSize(1.5)).toThrow();
  });
});
