import { AlertTriangle, CheckCircle2, ExternalLink, PlugZap } from "lucide-react";
import { TopNav } from "@/components/TopNav";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/view-models";

export const dynamic = "force-dynamic";

type ConnectSearchParams = Promise<{
  connected?: string;
  error?: string;
}>;

function ebayConfigStatus() {
  const requiredKeys = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RU_NAME"];
  const missing = requiredKeys.filter((key) => !process.env[key]);
  const ruName = process.env.EBAY_RU_NAME?.trim() ?? "";

  return {
    missing,
    hasUrlLikeRuName: /^https?:\/\//.test(ruName),
    environment: process.env.EBAY_ENV === "production" ? "production" : "sandbox",
  };
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: ConnectSearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const configStatus = ebayConfigStatus();
  const account = await prisma.ebayAccount.findFirst({
    where: { userId: user.id, environment: currentEbayEnvironment() },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-zinc-950 text-white">
            <PlugZap className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">eBay 계정 연결</h1>
            <p className="text-sm text-zinc-500">OAuth User token</p>
          </div>
        </div>

        {params.error ? (
          <section className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">eBay 연결 실패</p>
                <p className="mt-1 break-words">{params.error}</p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-semibold text-zinc-950">설정 상태</h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[150px_1fr]">
            <dt className="text-zinc-500">환경</dt>
            <dd className="font-medium text-zinc-950">{configStatus.environment}</dd>
            <dt className="text-zinc-500">필수 eBay 값</dt>
            <dd
              className={
                configStatus.missing.length
                  ? "font-medium text-rose-700"
                  : "font-medium text-emerald-700"
              }
            >
              {configStatus.missing.length
                ? `누락: ${configStatus.missing.join(", ")}`
                : "입력 완료"}
            </dd>
            <dt className="text-zinc-500">RuName 형식</dt>
            <dd
              className={
                configStatus.hasUrlLikeRuName
                  ? "font-medium text-amber-700"
                  : "font-medium text-zinc-950"
              }
            >
              {configStatus.hasUrlLikeRuName
                ? "URL처럼 보입니다. eBay가 발급한 RuName 값을 넣어야 합니다."
                : "확인 필요 없음"}
            </dd>
          </dl>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          {account ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="text-sm font-semibold">연결됨</span>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-[130px_1fr]">
                  <dt className="text-zinc-500">환경</dt>
                  <dd className="font-medium text-zinc-950">{account.environment}</dd>
                  <dt className="text-zinc-500">계정</dt>
                  <dd className="font-medium text-zinc-950">
                    {account.username ?? account.ebayUserId ?? "-"}
                  </dd>
                  <dt className="text-zinc-500">Access token 만료</dt>
                  <dd className="font-medium text-zinc-950">
                    {formatDate(account.expiresAt)}
                  </dd>
                  <dt className="text-zinc-500">Refresh token 만료</dt>
                  <dd className="font-medium text-zinc-950">
                    {formatDate(account.refreshTokenExpiresAt)}
                  </dd>
                </dl>
              </div>
              <a
                href="/api/ebay/oauth/start"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                <ExternalLink className="h-4 w-4" />
                다시 연결
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-950">
                  연결된 eBay 판매자 계정 없음
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  주문 동기화와 운송장 등록을 시작하려면 계정을 연결하세요.
                </p>
              </div>
              <a
                href="/api/ebay/oauth/start"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                <ExternalLink className="h-4 w-4" />
                연결
              </a>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
