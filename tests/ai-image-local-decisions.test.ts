import { describe, expect, it } from "vitest";
import {
  applyLocalDecisions,
  type AiImageDecision,
} from "@/lib/ai-image-local-decisions";

const item = (id: string, status: string) => ({ id, sku: id, status });

describe("자동 처리 중 검수 판정 유지", () => {
  it("서버가 아직 예전 상태를 보내도 방금 통과시킨 카드는 검수로 돌아오지 않는다", () => {
    const decisions = new Map<string, AiImageDecision>([["a", "pass_ready"]]);
    const merged = applyLocalDecisions(
      [],
      [item("a", "review"), item("b", "review")],
      decisions,
    );
    expect(merged.map((m) => [m.id, m.status])).toEqual([
      ["a", "pass_ready"],
      ["b", "review"],
    ]);
  });

  it("업로드까지 끝난 카드는 목록에서 빠진 채로 유지된다", () => {
    const decisions = new Map<string, AiImageDecision>([["a", "removed"]]);
    expect(
      applyLocalDecisions([], [item("a", "review"), item("b", "review")], decisions)
        .map((m) => m.id),
    ).toEqual(["b"]);
  });

  it("서버가 반영한 상태를 그대로 쓰되 판정 기록은 남긴다", () => {
    const decisions = new Map<string, AiImageDecision>([["a", "held"]]);
    const merged = applyLocalDecisions([], [item("a", "held")], decisions);
    expect(merged[0].status).toBe("held");
    expect(decisions.has("a")).toBe(true);
  });

  it("뒤늦게 도착한 옛 목록이 끝낸 카드를 되살리지 못한다", () => {
    const decisions = new Map<string, AiImageDecision>([["a", "removed"]]);
    // 처리 후 목록(이미 빠짐)이 먼저 오고, 처리 전 목록이 나중에 도착하는 경우
    applyLocalDecisions([], [item("b", "review")], decisions);
    const late = applyLocalDecisions(
      [],
      [item("a", "review"), item("b", "review")],
      decisions,
    );
    expect(late.map((m) => m.id)).toEqual(["b"]);
  });

  it("판정하지 않은 카드는 서버 내용을 그대로 쓴다", () => {
    const decisions = new Map<string, AiImageDecision>();
    const items = [item("a", "review"), item("b", "failed")];
    expect(applyLocalDecisions(items, items, decisions)).toEqual(items);
  });
});

describe("검수 중 목록 순서", () => {
  it("보던 순서를 유지하고 새로 처리된 결과는 뒤에 붙인다", () => {
    const previous = [item("a", "review"), item("b", "review")];
    const fromServer = [item("z", "review"), item("b", "review"), item("a", "review")];
    expect(
      applyLocalDecisions(previous, fromServer, new Map()).map((m) => m.id),
    ).toEqual(["a", "b", "z"]);
  });

  it("서버가 보낸 최신 내용으로 갱신하되 자리만 지킨다", () => {
    const previous = [item("a", "review"), item("b", "review")];
    const fromServer = [item("b", "failed"), item("a", "review")];
    const merged = applyLocalDecisions(previous, fromServer, new Map());
    expect(merged.map((m) => [m.id, m.status])).toEqual([
      ["a", "review"],
      ["b", "failed"],
    ]);
  });
});
