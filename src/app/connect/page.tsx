import { headers } from "next/headers";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  PlugZap,
  RotateCcw,
} from "lucide-react";
import { EbayApiUsageCard } from "@/components/EbayApiUsageCard";
import { EbayConnectionTest } from "@/components/EbayConnectionTest";
import { TopNav } from "@/components/TopNav";
import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/view-models";

export const dynamic = "force-dynamic";

type ConnectSearchParams = Promise<{
  connected?: string;
  error?: string;
  code?: string;
  state?: string;
}>;

function isRefreshTokenExpired(refreshTokenExpiresAt: Date | null | undefined) {
  return refreshTokenExpiresAt
    ? refreshTokenExpiresAt.getTime() <= Date.now()
    : false;
}

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

  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const callbackUrl = host
    ? `${proto}://${host}/api/ebay/callback`
    : "/api/ebay/callback";

  const refreshExpired = isRefreshTokenExpired(account?.refreshTokenExpiresAt);

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {/* 자동화 주기를 정할 때 볼 근거. 아무것도 바꾸지 않고 현황만 읽는다. */}
        <div className="mb-4">
          <EbayApiUsageCard />
        </div>
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

        {params.connected ? (
          <section className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="font-semibold">eBay 계정 연결이 완료되었습니다.</p>
            </div>
          </section>
        ) : null}

          <section className="mb-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
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
            <dt className="text-zinc-500">콜백 URL</dt>
            <dd className="font-medium text-zinc-950">
              <code className="break-all rounded bg-zinc-100 px-1.5 py-0.5 text-xs">
                {callbackUrl}
              </code>
              <p className="mt-1 text-xs font-normal text-zinc-500">
                eBay 개발자 포털 RuName의 “Your auth accepted URL”이 이 주소와
                정확히 같아야 인증 후 자동으로 돌아옵니다.
              </p>
            </dd>
          </dl>
        </section>

        <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-5">
          {account ? (
            <div>
              {refreshExpired ? (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    <span className="font-semibold">재연결이 필요합니다.</span>{" "}
                    eBay refresh token이 만료되어 주문을 불러올 수 없습니다. 아래
                    “Fresh eBay Connect”로 다시 연결해 주세요.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  {refreshExpired ? (
                    <div className="mb-3 flex items-center gap-2 text-rose-700">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="text-sm font-semibold">재연결 필요</span>
                    </div>
                  ) : (
                    <div className="mb-3 flex items-center gap-2 text-emerald-700">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="text-sm font-semibold">연결됨</span>
                    </div>
                  )}
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
                    <dd
                      className={
                        refreshExpired
                          ? "font-medium text-rose-700"
                          : "font-medium text-zinc-950"
                      }
                    >
                      {formatDate(account.refreshTokenExpiresAt)}
                      {refreshExpired ? " (만료됨)" : ""}
                    </dd>
                  </dl>
                  <EbayConnectionTest autoRun={Boolean(params.connected)} />
                </div>
                <a
                  href="/api/ebay/oauth/start"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
                >
                  <RotateCcw className="h-4 w-4" />
                  Fresh eBay Connect
                </a>
              </div>
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
                Fresh eBay Connect
              </a>
            </div>
          )}
        </section>

        <section className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-5">
          <div className="flex items-start gap-3">
            <RotateCcw className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
            <div>
              <h2 className="text-base font-semibold text-zinc-950">
                eBay 연결 시작
              </h2>
              <p className="mt-1 text-sm text-zinc-700">
                새 OAuth 시도를 시작합니다. 승인 뒤에는 이 화면으로 자동 복귀하고,
                실제 주문 API까지 자동 점검해 연결 성공 여부를 표시합니다.
              </p>
              <a
                href="/api/ebay/oauth/start"
                className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                <RotateCcw className="h-4 w-4" />
                eBay 연결 시작
              </a>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="text-base font-semibold text-zinc-950">
                자동 복귀가 안 될 때 한 번만 설정할 것
              </h2>
              <p className="mt-1 text-sm text-zinc-700">
                eBay 개발자 포털의 이 앱 RuName <code className="rounded bg-amber-100 px-1">{process.env.EBAY_RU_NAME}</code>에서
                <strong> Your auth accepted URL</strong>을 아래 주소와 정확히 같게 저장해 주세요.
                이 값이 다르면 eBay는 승인 완료 화면만 보이고 이 시스템에는 연결 정보가 저장되지 않습니다.
              </p>
              <code className="mt-3 block break-all rounded-md bg-white px-3 py-2 text-xs text-zinc-900">{callbackUrl}</code>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-300 bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-amber-100">
                  <ExternalLink className="h-4 w-4" /> eBay 개발자 설정 열기
                </a>
                <a href="/api/ebay/oauth/start" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800">
                  <RotateCcw className="h-4 w-4" /> 설정 후 다시 연결
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
