import { describe, expect, it } from "vitest";

/**
 * 다시 잡기는 원본 대비 0~1 비율로 저장한 네 점을 화면 좌표로 되살린다. 화면 크기가
 * 달라져도 같은 자리를 가리켜야 처음부터 다시 찍지 않아도 된다.
 */
const toCanvas = (
  corners: Array<{ x: number; y: number }>,
  canvas: { width: number; height: number },
) => corners.map((point) => ({ x: point.x * canvas.width, y: point.y * canvas.height }));

const toNormalized = (
  points: Array<{ x: number; y: number }>,
  canvas: { width: number; height: number },
) => points.map((point) => ({ x: point.x / canvas.width, y: point.y / canvas.height }));

describe("렌즈 영역 좌표 보관", () => {
  it("저장했다가 되살리면 같은 자리를 가리킨다", () => {
    const canvas = { width: 720, height: 1280 };
    const picked = [
      { x: 100, y: 200 }, { x: 600, y: 210 }, { x: 590, y: 1000 }, { x: 110, y: 990 },
    ];
    const restored = toCanvas(toNormalized(picked, canvas), canvas);
    for (const [index, point] of restored.entries()) {
      expect(point.x).toBeCloseTo(picked[index].x, 6);
      expect(point.y).toBeCloseTo(picked[index].y, 6);
    }
  });

  it("화면 크기가 달라져도 같은 비율 자리에 놓인다", () => {
    const saved = toNormalized(
      [{ x: 180, y: 320 }, { x: 540, y: 320 }, { x: 540, y: 960 }, { x: 180, y: 960 }],
      { width: 720, height: 1280 },
    );
    const smaller = toCanvas(saved, { width: 360, height: 640 });
    expect(smaller[0]).toEqual({ x: 90, y: 160 });
    expect(smaller[2]).toEqual({ x: 270, y: 480 });
  });

  it("비율은 언제나 0과 1 사이에 머문다", () => {
    const saved = toNormalized(
      [{ x: 0, y: 0 }, { x: 720, y: 0 }, { x: 720, y: 1280 }, { x: 0, y: 1280 }],
      { width: 720, height: 1280 },
    );
    expect(saved.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true);
  });
});
