import { describe, expect, it } from "vitest";

/**
 * 잘라낸 결과와 원본을 함께 보낸다. 휴대폰 사진 원본을 그대로 실으면 요청이 서버가
 * 받는 크기를 넘겨 저장이 조용히 실패한다. 줄여서 보내고, 그래도 크면 원본 보관을
 * 포기해 잘라낸 결과만은 반드시 저장한다.
 */
const SOURCE_MAX_EDGE = 2000;
const MAX_UPLOAD_CHARS = 3_500_000;

const scaled = (width: number, height: number) => {
  const longest = Math.max(width, height);
  const scale = longest > SOURCE_MAX_EDGE ? SOURCE_MAX_EDGE / longest : 1;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

const payload = (cropped: number, source?: number) =>
  cropped + (source ?? 0) > MAX_UPLOAD_CHARS ? { corners: true } : { corners: true, source: true };

describe("원본 보관 크기", () => {
  it("큰 사진은 긴 변을 2000으로 줄인다", () => {
    expect(scaled(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(scaled(3024, 4032)).toEqual({ width: 1500, height: 2000 });
  });

  it("작은 사진은 그대로 둔다", () => {
    expect(scaled(1200, 900)).toEqual({ width: 1200, height: 900 });
  });

  it("합쳐서 한도를 넘으면 원본을 빼고 결과만 보낸다", () => {
    expect(payload(1_000_000, 5_000_000)).toEqual({ corners: true });
  });

  it("한도 안이면 원본도 함께 보낸다", () => {
    expect(payload(1_000_000, 1_000_000)).toEqual({ corners: true, source: true });
  });
});
