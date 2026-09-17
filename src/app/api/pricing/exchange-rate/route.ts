import { NextResponse } from "next/server";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const endpoint = "https://api.frankfurter.dev/v2/rate/USD/KRW?providers=ECB";

export async function GET() {
  try {
    await requireApiUser();
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`환율 제공처 응답 오류 (${response.status})`);
    const data = await response.json() as {
      date?: unknown; base?: unknown; quote?: unknown; rate?: unknown;
    };
    const rate = Number(data.rate);
    if (
      data.base !== "USD" ||
      data.quote !== "KRW" ||
      typeof data.date !== "string" ||
      !Number.isFinite(rate) ||
      rate <= 0
    ) throw new Error("환율 제공처 응답 형식이 올바르지 않습니다.");
    return NextResponse.json({
      rate: rate.toFixed(4),
      effectiveDate: data.date,
      provider: "European Central Bank (via Frankfurter)",
    });
  } catch (error) {
    const unauthorized = error instanceof UnauthorizedError;
    return NextResponse.json(
      { error: unauthorized ? "관리자 권한이 필요합니다." : error instanceof Error ? error.message : "최신 환율을 가져오지 못했습니다." },
      { status: unauthorized ? 401 : 502 },
    );
  }
}
