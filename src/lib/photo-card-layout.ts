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

const BACKGROUND_LEVEL = 232;
// 사분면이 아니라 네 귀퉁이를 본다. 두 카드가 가운데서 맞닿아 사분면을 침범하기
// 때문에 사분면 밝기로는 배치를 가릴 수 없다.
const CORNER_WIDTH = 0.18;
const CORNER_HEIGHT = 0.12;
const BACKGROUND_CORNER = 0.9;
const CARD_CORNER = 0.35;
const MIN_SIDE = 0.25;
const MIN_ASPECT = 0.4;
const MAX_ASPECT = 1.0;

function reader(image: GreyscaleImage) {
  const { width, data } = image;
  return (x: number, y: number) => data[y * width + x] >= BACKGROUND_LEVEL;
}

function cornerBrightness(image: GreyscaleImage) {
  const bright = reader(image);
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

/** 한 줄을 따라가며 배경이 시작되는 지점을 찾는다. */
function contentEdge(isBright: (index: number) => boolean, length: number, forward: boolean) {
  for (let step = 0; step < length; step += 1) {
    const index = forward ? step : length - 1 - step;
    if (isBright(index)) return forward ? index : index + 1;
  }
  return forward ? length : 0;
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
  const corners = cornerBrightness(image);
  const bright = reader(image);
  const { width, height } = image;
  const topRow = Math.round(height * 0.03);
  const bottomRow = height - 1 - topRow;
  const leftColumn = Math.round(width * 0.03);
  const rightColumn = width - 1 - leftColumn;

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

  const boxes: CardBox[] = leftDiagonal
    ? [
        {
          x0: 0,
          y0: 0,
          x1: contentEdge((x) => bright(x, topRow), width, true) / width,
          y1: contentEdge((y) => bright(leftColumn, y), height, true) / height,
        },
        {
          x0: contentEdge((x) => bright(x, bottomRow), width, false) / width,
          y0: contentEdge((y) => bright(rightColumn, y), height, false) / height,
          x1: 1,
          y1: 1,
        },
      ]
    : [
        {
          x0: contentEdge((x) => bright(x, topRow), width, false) / width,
          y0: 0,
          x1: 1,
          y1: contentEdge((y) => bright(rightColumn, y), height, true) / height,
        },
        {
          x0: 0,
          y0: contentEdge((y) => bright(leftColumn, y), height, false) / height,
          x1: contentEdge((x) => bright(x, bottomRow), width, true) / width,
          y1: 1,
        },
      ];
  const frameAspect = width / height;
  return boxes.every((box) => validBox(box, frameAspect))
    ? { kind: "cards", boxes }
    : { kind: "unknown" };
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
