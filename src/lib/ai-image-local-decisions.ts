export type AiImageDecision = "pass_ready" | "held" | "rework" | "removed";

/**
 * 자동 처리 중에는 배치 진행에 맞춰 목록을 다시 받아온다. 이때 서버가 보낸 내용이
 * 방금 사람이 내린 판정보다 이전 시점일 수 있다. 그대로 덮어쓰면 통과시킨 카드가
 * 검수 대기로 다시 올라온다. 사람이 내린 판정은 서버가 따라잡을 때까지 유지한다.
 */
export function applyLocalDecisions<T extends { id: string; status: string }>(
  previous: T[],
  items: T[],
  decisions: Map<string, AiImageDecision>,
) {
  // 목록에서 사라졌다고 판정을 지우면 안 된다. 목록을 다시 받는 요청이 여러 개
  // 겹치면 처리 이전 시점의 응답이 나중에 도착할 수 있고, 그때 판정이 없으면
  // 방금 끝낸 카드가 다시 나타난다. 판정은 이 화면을 여는 동안 계속 들고 있는다.
  // 보고 있던 순서를 유지하고 새로 온 결과는 뒤에 붙인다. 순서가 바뀌면 검수
  // 중인 카드가 눈앞에서 다른 카드로 바뀐다.
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const old of previous) {
    const fresh = byId.get(old.id);
    if (!fresh || seen.has(old.id)) continue;
    ordered.push(fresh);
    seen.add(old.id);
  }
  for (const item of items) if (!seen.has(item.id)) ordered.push(item);
  const merged: T[] = [];
  for (const item of ordered) {
    const decision = decisions.get(item.id);
    if (!decision) {
      merged.push(item);
      continue;
    }
    if (decision === "removed") continue;
    if (item.status === "review") {
      merged.push({ ...item, status: decision });
      continue;
    }
    // 서버가 다른 상태로 반영했으면 그 값을 그대로 쓴다. 다만 판정 기록은
    // 남겨 둔다. 뒤늦게 도착한 옛 응답이 다시 검수로 돌려놓지 못하게 한다.
    merged.push(item);
  }
  return merged;
}

