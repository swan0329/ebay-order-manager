/**
 * 카드 이미지를 잘라내는 캔버스 계산. 이미지 작업대와 AI 이미지 작업의 구글렌즈
 * 후보가 같은 방식으로 카드를 추출하도록 한곳에 둔다. React와 무관한 순수 계산이다.
 */
export type Point = { x: number; y: number };

export function detectCardBounds(canvas: HTMLCanvasElement): Point[] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const gray = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  };
  const xs = new Array(width).fill(0),
    ys = new Array(height).fill(0);
  const step = Math.max(1, Math.floor(Math.max(width, height) / 500));
  for (let y = step; y < height - step; y += step)
    for (let x = step; x < width - step; x += step) {
      xs[x] += Math.abs(gray(x + step, y) - gray(x - step, y));
      ys[y] += Math.abs(gray(x, y + step) - gray(x, y - step));
    }
  const peak = (values: number[], start: number, end: number) => {
    let best = start;
    for (let i = start; i < end; i += 1) if (values[i] > values[best]) best = i;
    return best;
  };
  const left = peak(xs, Math.floor(width * 0.02), Math.floor(width * 0.48));
  const right = peak(xs, Math.floor(width * 0.52), Math.floor(width * 0.98));
  const top = peak(ys, Math.floor(height * 0.02), Math.floor(height * 0.48));
  const bottom = peak(ys, Math.floor(height * 0.52), Math.floor(height * 0.98));
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

export function seamlessQuadrilateralCrop(
  image: HTMLImageElement,
  source: [Point, Point, Point, Point],
  width: number,
  height: number,
) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!sourceContext) return null;
  sourceContext.drawImage(image, 0, 0);
  const sourcePixels = sourceContext.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d");
  if (!outputContext) return null;
  const outputPixels = outputContext.createImageData(width, height);
  const [topLeft, topRight, bottomRight, bottomLeft] = source;

  for (let y = 0; y < height; y += 1) {
    const v = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x += 1) {
      const u = width > 1 ? x / (width - 1) : 0;
      const sourceX =
        (1 - u) * (1 - v) * topLeft.x +
        u * (1 - v) * topRight.x +
        u * v * bottomRight.x +
        (1 - u) * v * bottomLeft.x;
      const sourceY =
        (1 - u) * (1 - v) * topLeft.y +
        u * (1 - v) * topRight.y +
        u * v * bottomRight.y +
        (1 - u) * v * bottomLeft.y;
      const x0 = Math.max(
        0,
        Math.min(sourceCanvas.width - 1, Math.floor(sourceX)),
      );
      const y0 = Math.max(
        0,
        Math.min(sourceCanvas.height - 1, Math.floor(sourceY)),
      );
      const x1 = Math.min(sourceCanvas.width - 1, x0 + 1);
      const y1 = Math.min(sourceCanvas.height - 1, y0 + 1);
      const fx = sourceX - x0;
      const fy = sourceY - y0;
      const destinationIndex = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 =
          sourcePixels.data[(y0 * sourceCanvas.width + x0) * 4 + channel];
        const p10 =
          sourcePixels.data[(y0 * sourceCanvas.width + x1) * 4 + channel];
        const p01 =
          sourcePixels.data[(y1 * sourceCanvas.width + x0) * 4 + channel];
        const p11 =
          sourcePixels.data[(y1 * sourceCanvas.width + x1) * 4 + channel];
        outputPixels.data[destinationIndex + channel] =
          (p00 * (1 - fx) + p10 * fx) * (1 - fy) +
          (p01 * (1 - fx) + p11 * fx) * fy;
      }
    }
  }
  outputContext.putImageData(outputPixels, 0, 0);
  return output;
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function roundCanvasCorners(canvas: HTMLCanvasElement, radius: number) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const r = Math.max(1, Math.min(radius, canvas.width / 2, canvas.height / 2));
  context.save();
  context.globalCompositeOperation = "destination-in";
  context.beginPath();
  context.roundRect(0, 0, canvas.width, canvas.height, r);
  context.fill();
  context.restore();
}

export function normalizeFourCorners(
  points: Point[],
  width: number,
  height: number,
): Point[] | null {
  if (points.length !== 4) return null;
  const clamped = points.map((p) => ({
    x: Math.max(0, Math.min(width - 1, p.x)),
    y: Math.max(0, Math.min(height - 1, p.y)),
  }));
  if (
    clamped.some((p, i) =>
      clamped.some((q, j) => i !== j && distance(p, q) < 8),
    )
  )
    return null;
  const cx = clamped.reduce((sum, p) => sum + p.x, 0) / 4,
    cy = clamped.reduce((sum, p) => sum + p.y, 0) / 4;
  const around = [...clamped].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  const topLeftIndex = around.reduce(
    (best, p, i) => (p.x + p.y < around[best].x + around[best].y ? i : best),
    0,
  );
  const rotated = [
    ...around.slice(topLeftIndex),
    ...around.slice(0, topLeftIndex),
  ];
  // Canvas coordinates increase downward. After TL, clockwise order must be TR.
  return rotated[1].x >= rotated[3].x
    ? rotated
    : [rotated[0], rotated[3], rotated[2], rotated[1]];
}
