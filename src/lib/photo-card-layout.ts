export type CardBox = { x0: number; y0: number; x1: number; y1: number };
export type CardLayout =
  /** 카드 한 장이 화면을 채운다. 지금까지처럼 바깥 테두리를 둥글게 만든다. */
  | { kind: "single" }
  /** 흰 배경 위에 카드 두 장이 대각선으로 놓여 있다. 카드마다 따로 둥글게 만든다. */
  | { kind: "cards"; boxes: CardBox[] }
  /** 두 장처럼 보이지만 경계를 확신할 수 없다. 잘못 깎느니 둥글게 만들지 않는다. */
  | { kind: "unknown" };

export type GreyscaleImage = {
  width: number;
  height: number;
  /** 0~255 밝기. 배경(흰색)은 크고 카드 내용은 작다. */
  data: Uint8Array | Buffer;
};

// 배경 밝기는 사진마다 다르다. 어떤 사진은 배경이 246이고 카드 안의 흰 벽이 233이다.
// 고정된 기준을 쓰면 카드 속 밝은 부분을 배경으로 착각해 경계를 잘못 잡는다.
const BACKGROUND_TOLERANCE = 4;
const MIN_BACKGROUND_SHARE = 0.1;
// 배경이 이만큼 연달아 나와야 카드가 끝난 것으로 본다.
const BACKGROUND_RUN = 4;
// 사분면이 아니라 네 귀퉁이를 본다. 두 카드가 가운데서 맞닿아 사분면을 침범하기
// 때문에 사분면 밝기로는 배치를 가릴 수 없다.
const CORNER_WIDTH = 0.18;
const CORNER_HEIGHT = 0.12;
const BACKGROUND_CORNER = 0.9;
const CARD_CORNER = 0.35;
const MIN_SIDE = 0.25;
const MIN_ASPECT = 0.4;
const MAX_ASPECT = 1.0;
// 경계는 한 줄만 보고 정하지 않는다. 카드 안에 밝은 부분이 있으면 그 줄만 짧게
// 끊긴다. 맞닿은 쪽 끝에서 여러 줄을 훑어 흔한 값을 쓴다.
const EDGE_BAND = 0.14;
const EDGE_PERCENTILE = 0.8;
// 상자가 못 덮은 카드 내용이 이보다 많으면 깎지 않는다. 깎으면 그만큼 지워진다.
const MAX_UNCOVERED = 0.01;

/**
 * 이 사진의 배경 밝기를 찾는다. 배경은 넓고 고른 한 가지 밝기로 깔려 있으므로
 * 밝은 쪽에서 가장 흔한 밝기가 배경이다. 다만 흰 뒷면 카드(255)가 배경(246)보다
 * 넓은 사진도 있어 어느 쪽이 배경인지 한 번에 정할 수 없다. 넓은 순서로 후보를
 * 돌려주고 두 장 배치가 만들어지는 쪽을 쓴다.
 */
function backgroundCandidates(image: GreyscaleImage) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < image.width * image.height; index += 1)
    histogram[image.data[index]] += 1;
  const band = (level: number) => {
    let count = 0;
    for (
      let value = Math.max(0, level - BACKGROUND_TOLERANCE);
      value <= Math.min(255, level + BACKGROUND_TOLERANCE);
      value += 1
    )
      count += histogram[value];
    return count;
  };
  const pixels = image.width * image.height;
  const candidates: number[] = [];
  const taken: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    let best = -1;
    let bestCount = 0;
    for (let level = 200; level < 256; level += 1) {
      if (taken.some((used) => Math.abs(used - level) <= BACKGROUND_TOLERANCE)) continue;
      const count = band(level);
      if (count > bestCount) {
        bestCount = count;
        best = level;
      }
    }
    if (best < 0 || bestCount / pixels < MIN_BACKGROUND_SHARE) break;
    candidates.push(best);
    taken.push(best);
  }
  return candidates;
}

/**
 * 배경인지 본다. "밝으면 배경"으로 보면 안 된다. 배경보다 더 흰 뒷면 카드를
 * 배경으로 삼아 카드 경계를 통째로 놓친다. 배경 밝기 언저리만 배경으로 본다.
 */
function reader(image: GreyscaleImage, level: number) {
  const { width, data } = image;
  return (x: number, y: number) => Math.abs(data[y * width + x] - level) <= BACKGROUND_TOLERANCE;
}

function cornerBrightness(image: GreyscaleImage, level: number) {
  const bright = reader(image, level);
  const cornerWidth = Math.max(2, Math.round(image.width * CORNER_WIDTH));
  const cornerHeight = Math.max(2, Math.round(image.height * CORNER_HEIGHT));
  const ratio = (x0: number, y0: number) => {
    let light = 0;
    let total = 0;
    for (let y = y0; y < y0 + cornerHeight; y += 1)
      for (let x = x0; x < x0 + cornerWidth; x += 1) {
        if (bright(x, y)) light += 1;
        total += 1;
      }
    return total ? light / total : 0;
  };
  return {
    topLeft: ratio(0, 0),
    topRight: ratio(image.width - cornerWidth, 0),
    bottomLeft: ratio(0, image.height - cornerHeight),
    bottomRight: ratio(image.width - cornerWidth, image.height - cornerHeight),
  };
}

/**
 * 한 줄을 따라가며 배경이 시작되는 지점을 찾는다. 배경 한 점만 보고 멈추면 안 된다.
 * 흰 카드에 찍힌 검은 글씨 둘레는 압축 때문에 배경과 같은 밝기를 스쳐 지나가고,
 * 그 한 점에서 멈추면 카드가 반 토막 난다. 배경이 연달아 나올 때만 끝으로 본다.
 */
function contentEdge(isBright: (index: number) => boolean, length: number, forward: boolean) {
  let run = 0;
  for (let step = 0; step < length; step += 1) {
    const index = forward ? step : length - 1 - step;
    if (!isBright(index)) {
      run = 0;
      continue;
    }
    run += 1;
    if (run >= BACKGROUND_RUN) return forward ? index - run + 1 : index + run;
  }
  return forward ? length : 0;
}

/**
 * 여러 줄에서 잰 경계 중 하나를 고른다. 앞에서 재는 값은 클수록, 뒤에서 재는 값은
 * 작을수록 카드가 크다. 카드 안의 밝은 부분 때문에 짧게 끊긴 줄에 끌려가지 않도록
 * 카드가 큰 쪽으로 치우친 값을 쓴다.
 */
function edgeEstimate(values: number[], forward: boolean) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const ratio = forward ? EDGE_PERCENTILE : 1 - EDGE_PERCENTILE;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function bandIndexes(length: number, fromStart: boolean, share = EDGE_BAND) {
  const band = Math.max(3, Math.round(length * share));
  const indexes: number[] = [];
  for (let step = 1; step < band; step += 1)
    indexes.push(fromStart ? step : length - 1 - step);
  return indexes;
}

/**
 * 마스크가 카드 내용을 덮지 못하면 그 부분은 지워져 흰색으로 남는다. 잘못 깎느니
 * 깎지 않는 편이 낫다. 배경이 아닌 점이 상자 밖에 얼마나 있는지 센다.
 */
function uncoveredShare(image: GreyscaleImage, level: number, boxes: CardBox[]) {
  const bright = reader(image, level);
  const inside = (x: number, y: number) =>
    boxes.some(
      (box) =>
        x >= box.x0 * image.width &&
        x <= box.x1 * image.width &&
        y >= box.y0 * image.height &&
        y <= box.y1 * image.height,
    );
  let content = 0;
  let uncovered = 0;
  for (let y = 0; y < image.height; y += 1)
    for (let x = 0; x < image.width; x += 1) {
      if (bright(x, y)) continue;
      content += 1;
      if (!inside(x, y)) uncovered += 1;
    }
  return content ? uncovered / content : 0;
}

function validBox(box: CardBox, frameAspect: number) {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  if (width < MIN_SIDE || height < MIN_SIDE) return false;
  // 비율 판정은 화면 비율을 반영한 실제 모양으로 한다. 0~1로 정규화한 값만 나누면
  // 세로로 긴 카드도 정사각형처럼 보여 정상 배치를 걸러 버린다.
  const aspect = (width / height) * frameAspect;
  return aspect >= MIN_ASPECT && aspect <= MAX_ASPECT;
}

/**
 * 포카마켓 사진 중에는 한 장에 카드 두 장이 대각선으로 담긴 것이 있다(앞뒤 또는 2장 세트).
 * 이걸 한 장으로 보고 바깥 테두리만 둥글게 만들면 카드 두 장의 모서리는 각진 채로 남고
 * 맞닿은 두 모서리만 잘려 검은 카드에서는 흰 자국이 보인다. 배치를 먼저 가려낸다.
 */
export function detectCardLayout(image: GreyscaleImage): CardLayout {
  if (image.width < 16 || image.height < 16) return { kind: "single" };
  let result: CardLayout = { kind: "single" };
  for (const level of backgroundCandidates(image)) {
    const attempt = layoutForBackground(image, level);
    if (attempt.kind === "cards") return attempt;
    // 한 후보로 두 장을 만들지 못하면 다음 후보를 본다. 판정을 포기한 결과는
    // 남겨 둔다. 두 장처럼 보이는데 경계를 못 잡은 것이므로 깎으면 안 된다.
    if (attempt.kind === "unknown") result = attempt;
  }
  return result;
}

function layoutForBackground(image: GreyscaleImage, level: number): CardLayout {
  const corners = cornerBrightness(image, level);
  const bright = reader(image, level);
  const { width, height } = image;

  const leftDiagonal =
    corners.topRight >= BACKGROUND_CORNER &&
    corners.bottomLeft >= BACKGROUND_CORNER &&
    corners.topLeft <= CARD_CORNER &&
    corners.bottomRight <= CARD_CORNER;
  const rightDiagonal =
    corners.topLeft >= BACKGROUND_CORNER &&
    corners.bottomRight >= BACKGROUND_CORNER &&
    corners.topRight <= CARD_CORNER &&
    corners.bottomLeft <= CARD_CORNER;
  if (!leftDiagonal && !rightDiagonal) return { kind: "single" };

  // 경계는 두 번 잰다. 먼저 맞닿은 쪽 끝에서 대강 잡고, 다음에는 그 카드만 있는
  // 구간의 줄을 모두 훑어 다시 잰다. 한 번만 재면 카드 안의 흰 소매 같은 밝은
  // 부분에 끌려가 카드가 실제보다 작게 잡히고, 작게 잡힌 만큼 나중에 지워진다.
  // 다른 카드까지 걸친 줄을 쓰면 반대로 카드가 화면 끝까지 늘어난다.
  const horizontal = (rows: number[], forward: boolean) =>
    edgeEstimate(
      rows.map((y) => contentEdge((x) => bright(x, y), width, forward)),
      forward,
    ) / width;
  const vertical = (columns: number[], forward: boolean) =>
    edgeEstimate(
      columns.map((x) => contentEdge((y) => bright(x, y), height, forward)),
      forward,
    ) / height;
  /** from~to 구간(0~1)의 줄 번호. 구간이 비면 빈 배열을 돌려준다. */
  const span = (from: number, to: number, length: number) => {
    const first = Math.max(1, Math.round(from * length));
    const last = Math.min(length - 2, Math.round(to * length));
    const indexes: number[] = [];
    for (let index = first; index <= last; index += 1) indexes.push(index);
    return indexes;
  };
  const refine = (indexes: number[], forward: boolean, rough: number, axis: "x" | "y") =>
    indexes.length
      ? axis === "x"
        ? horizontal(indexes, forward)
        : vertical(indexes, forward)
      : rough;

  // 1차: 맞닿은 쪽 끝의 몇 줄만 보고 대강 잡는다.
  const topLeftSide = leftDiagonal;
  const roughTop = {
    across: horizontal(bandIndexes(height, true), topLeftSide),
    down: vertical(bandIndexes(width, topLeftSide), true),
  };
  const roughBottom = {
    across: horizontal(bandIndexes(height, false), !topLeftSide),
    up: vertical(bandIndexes(width, !topLeftSide), false),
  };

  // 2차: 위 카드는 아래 카드가 시작되기 전까지, 아래 카드는 위 카드가 끝난 뒤부터.
  const topRows = span(0, roughBottom.up, height);
  const bottomRows = span(roughTop.down, 1, height);
  const topColumns = topLeftSide
    ? span(0, roughBottom.across, width)
    : span(roughBottom.across, 1, width);
  const bottomColumns = topLeftSide
    ? span(roughTop.across, 1, width)
    : span(0, roughTop.across, width);

  const topAcross = refine(topRows, topLeftSide, roughTop.across, "x");
  const topDown = refine(topColumns, true, roughTop.down, "y");
  const bottomAcross = refine(bottomRows, !topLeftSide, roughBottom.across, "x");
  const bottomUp = refine(bottomColumns, false, roughBottom.up, "y");

  const topBox: CardBox = topLeftSide
    ? { x0: 0, y0: 0, x1: topAcross, y1: topDown }
    : { x0: topAcross, y0: 0, x1: 1, y1: topDown };
  const bottomBox: CardBox = topLeftSide
    ? { x0: bottomAcross, y0: bottomUp, x1: 1, y1: 1 }
    : { x0: 0, y0: bottomUp, x1: bottomAcross, y1: 1 };
  const boxes: CardBox[] = [topBox, bottomBox];
  const frameAspect = width / height;
  if (!boxes.every((box) => validBox(box, frameAspect))) return { kind: "unknown" };
  if (uncoveredShare(image, level, boxes) > MAX_UNCOVERED) return { kind: "unknown" };
  return { kind: "cards", boxes };
}

/** 카드마다 자기 크기에 맞는 반경으로 둥글게 만드는 마스크. */
export function cardLayoutMaskSvg(
  layout: CardLayout,
  width: number,
  height: number,
  radiusRatio: number,
  singleRadius: number,
) {
  if (layout.kind === "unknown") return null;
  const rects =
    layout.kind === "single"
      ? [`<rect width="${width}" height="${height}" rx="${singleRadius}" fill="white"/>`]
      : layout.boxes.map((box) => {
          const x = Math.round(box.x0 * width);
          const y = Math.round(box.y0 * height);
          const boxWidth = Math.round((box.x1 - box.x0) * width);
          const boxHeight = Math.round((box.y1 - box.y0) * height);
          const radius = Math.max(2, Math.round(Math.min(boxWidth, boxHeight) * radiusRatio));
          return `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="${radius}" fill="white"/>`;
        });
  return `<svg width="${width}" height="${height}">${rects.join("")}</svg>`;
}
