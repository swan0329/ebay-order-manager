const statusStyle: Record<string, string> = {
  NOT_STARTED: "border-amber-200 bg-amber-50 text-amber-800",
  IN_PROGRESS: "border-blue-200 bg-blue-50 text-blue-800",
  FULFILLED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  FAILED: "border-rose-200 bg-rose-50 text-rose-800",
  PENDING: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

const statusLabel: Record<string, string> = {
  NOT_STARTED: "배송대기",
  IN_PROGRESS: "부분배송",
  FULFILLED: "배송완료",
  COMPLETED: "완료",
  FAILED: "실패",
  PENDING: "대기",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${
        statusStyle[status] ?? "border-zinc-200 bg-zinc-50 text-zinc-700"
      }`}
    >
      {statusLabel[status] ?? status}
    </span>
  );
}
