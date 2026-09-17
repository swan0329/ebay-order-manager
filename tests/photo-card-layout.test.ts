import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cardLayoutMaskSvg, detectCardLayout } from "@/lib/photo-card-layout";

const W = 120;
const H = 191;

async function grey(svg: string) {
  const { data, info } = await sharp(Buffer.from(svg))
    .resize(W, H, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

const canvas = (inner: string) =>
  `<svg width="250" height="388"><rect width="250" height="388" fill="white"/>${inner}</svg>`;

// 왼쪽 위·오른쪽 아래에 카드 두 장이 놓인 실제 배치
const diagonal = canvas(
  `<rect x="0" y="0" width="140" height="217" fill="#303030"/><rect x="110" y="171" width="140" height="217" fill="#101010"/>`,
);
// 반대 대각선
const mirrored = canvas(
  `<rect x="110" y="0" width="140" height="217" fill="#303030"/><rect x="0" y="171" width="140" height="217" fill="#101010"/>`,
);
const single = `<svg width="250" height="388"><rect width="250" height="388" fill="#404040"/></svg>`;

describe("포토카드 배치 판정", () => {
  it("대각선 두 장을 카드 두 개로 본다", async () => {
    const layout = detectCardLayout(await grey(diagonal));
    expect(layout.kind).toBe("cards");
    if (layout.kind !== "cards") return;
    expect(layout.boxes).toHaveLength(2);
    const [first, second] = layout.boxes;
    expect(first.x0).toBe(0);
    expect(first.y0).toBe(0);
    expect(first.x1).toBeGreaterThan(0.5);
    expect(first.x1).toBeLessThan(0.62);
    expect(second.x1).toBe(1);
    expect(second.y1).toBe(1);
    expect(second.x0).toBeGreaterThan(0.38);
    expect(second.y0).toBeGreaterThan(0.38);
  });

  it("반대 방향 대각선도 카드 두 개로 본다", async () => {
    const layout = detectCardLayout(await grey(mirrored));
    expect(layout.kind).toBe("cards");
    if (layout.kind !== "cards") return;
    expect(layout.boxes[0].x1).toBe(1);
    expect(layout.boxes[1].x0).toBe(0);
  });

  it("화면을 채운 한 장은 지금처럼 한 장으로 본다", async () => {
    expect((await detectCardLayout(await grey(single))).kind).toBe("single");
  });

  it("여백이 있는 한 장도 한 장으로 본다", async () => {
    const padded = canvas(`<rect x="20" y="30" width="210" height="330" fill="#505050"/>`);
    expect((await detectCardLayout(await grey(padded))).kind).toBe("single");
  });

  it("대각선이지만 한쪽 폭이 카드로 보기 어려우면 판정을 포기한다", async () => {
    const narrow = canvas(
      `<rect x="0" y="0" width="140" height="217" fill="#303030"/><rect x="195" y="268" width="55" height="120" fill="#101010"/>`,
    );
    expect((await detectCardLayout(await grey(narrow))).kind).toBe("unknown");
  });

  it("카드 안에 흰 부분이 있어도 카드 전체를 상자에 담는다", async () => {
    // 왼쪽 위 카드의 아래쪽 왼편에 흰 소매 같은 밝은 덩어리가 있는 사진
    const sleeve = canvas(
      `<rect x="0" y="0" width="140" height="217" fill="#303030"/>` +
        `<rect x="0" y="150" width="40" height="67" fill="#fdfdfd"/>` +
        `<rect x="110" y="171" width="140" height="217" fill="#101010"/>`,
    );
    const layout = detectCardLayout(await grey(sleeve));
    expect(layout.kind).toBe("cards");
    if (layout.kind !== "cards") return;
    // 흰 소매에서 끊기면 0.4 근처가 된다. 카드 아래 끝인 0.55 근처여야 한다.
    expect(layout.boxes[0].y1).toBeGreaterThan(0.5);
  });

  it("배경보다 더 흰 뒷면 카드도 카드로 본다", async () => {
    // 배경은 246, 뒷면 카드는 255인 사진. "밝으면 배경"으로 보면 뒷장을 통째로 놓친다.
    const whiteBack =
      `<svg width="250" height="388"><rect width="250" height="388" fill="#f6f6f6"/>` +
      `<rect x="0" y="0" width="140" height="217" fill="#303030"/>` +
      `<rect x="110" y="171" width="140" height="217" fill="#ffffff"/>` +
      `<text x="140" y="300" font-size="30" fill="#000000">ABC</text></svg>`;
    const layout = detectCardLayout(await grey(whiteBack));
    expect(layout.kind).toBe("cards");
    if (layout.kind !== "cards") return;
    expect(layout.boxes[1].y0).toBeLessThan(0.5);
  });

  it("상자가 덮지 못한 카드 내용이 있으면 깎지 않는다", async () => {
    // 배경 한가운데에 카드가 아닌 내용이 남아 있는 사진. 그대로 깎으면 지워진다.
    const extra = canvas(
      `<rect x="0" y="0" width="140" height="217" fill="#303030"/>` +
        `<rect x="110" y="171" width="140" height="217" fill="#101010"/>` +
        `<rect x="160" y="60" width="80" height="100" fill="#202020"/>`,
    );
    expect((await detectCardLayout(await grey(extra))).kind).toBe("unknown");
  });

  it("귀퉁이에 작은 표식만 있으면 대각선으로 보지 않는다", async () => {
    const mark = canvas(
      `<rect x="0" y="0" width="140" height="217" fill="#303030"/><rect x="230" y="370" width="18" height="16" fill="#101010"/>`,
    );
    expect((await detectCardLayout(await grey(mark))).kind).toBe("single");
  });
});

describe("배치별 마스크", () => {
  it("한 장이면 바깥 테두리 하나만 둥글게 만든다", () => {
    const svg = cardLayoutMaskSvg({ kind: "single" }, 540, 860, 0.045, 24);
    expect(svg).toContain(`<rect width="540" height="860" rx="24"`);
    expect((svg?.match(/<rect/g) ?? []).length).toBe(1);
  });

  it("두 장이면 카드마다 자기 크기에 맞는 반경을 쓴다", () => {
    const svg = cardLayoutMaskSvg(
      { kind: "cards", boxes: [
        { x0: 0, y0: 0, x1: 0.56, y1: 0.56 },
        { x0: 0.44, y0: 0.44, x1: 1, y1: 1 },
      ] },
      540,
      860,
      0.045,
      24,
    );
    expect((svg?.match(/<rect/g) ?? []).length).toBe(2);
    expect(svg).toContain(`x="0" y="0" width="302" height="482" rx="14"`);
  });

  it("확신할 수 없으면 아무것도 깎지 않는다", () => {
    expect(cardLayoutMaskSvg({ kind: "unknown" }, 540, 860, 0.045, 24)).toBeNull();
  });
});
