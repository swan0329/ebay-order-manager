type EbayEnvironmentBadgeProps = {
  environment: string | null;
  username?: string | null;
  expectedEnvironment?: string | null;
};

export function EbayEnvironmentBadge({
  environment,
  username,
  expectedEnvironment,
}: EbayEnvironmentBadgeProps) {
  const normalized = environment?.toUpperCase() ?? null;
  const expected = expectedEnvironment?.toUpperCase() ?? null;
  const isProduction = normalized === "PRODUCTION";
  const label = normalized
    ? isProduction
      ? "Production"
      : "Sandbox"
    : "eBay 미연결";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
          isProduction
            ? "bg-rose-50 text-rose-700 ring-rose-200"
            : normalized
              ? "bg-blue-50 text-blue-700 ring-blue-200"
              : "bg-zinc-100 text-zinc-600 ring-zinc-200"
        }`}
      >
        eBay {label}
      </span>
      {username ? <span className="text-xs text-zinc-500">{username}</span> : null}
      {expected && normalized && expected !== normalized ? (
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
          앱 설정은 {expected}
        </span>
      ) : null}
    </div>
  );
}
