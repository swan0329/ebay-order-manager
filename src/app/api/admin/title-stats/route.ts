import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

// eBay 제목 길이 가이드: 최대 80자. 60자 미만은 키워드 활용 여지 큼.
function lengthStats(values: string[]) {
  const lengths = values.map((value) => value.length).sort((a, b) => a - b);
  if (lengths.length === 0) {
    return null;
  }

  const sum = lengths.reduce((acc, value) => acc + value, 0);
  const percentile = (p: number) =>
    lengths[Math.min(lengths.length - 1, Math.floor(p * lengths.length))];

  const within = (min: number, max: number) =>
    lengths.filter((value) => value >= min && value <= max).length;

  return {
    count: lengths.length,
    min: lengths[0],
    max: lengths[lengths.length - 1],
    mean: Math.round((sum / lengths.length) * 10) / 10,
    median: percentile(0.5),
    p25: percentile(0.25),
    p75: percentile(0.75),
    "over80_eBay한도초과": lengths.filter((value) => value > 80).length,
    atLeast60: lengths.filter((value) => value >= 60).length,
    "under40_짧음": lengths.filter((value) => value < 40).length,
    buckets: {
      "1-20": within(1, 20),
      "21-40": within(21, 40),
      "41-60": within(41, 60),
      "61-80": within(61, 80),
      "81+": lengths.filter((value) => value > 80).length,
    },
  };
}

function patternSignals(titles: string[]) {
  const total = titles.length || 1;
  const decorative =
    /[★☆♥♡✦✧✨🔥💖⭐【】『』※◆◇■□▶►]|[\u{1F000}-\u{1FAFF}]/u;
  const spammy = /(\bL@@K\b|\bLOOK\b|\bWOW\b|\bRARE\b|\bHOT\b|\bSALE\b|\bNEW\b|!{2,})/i;
  const brackets = /[[\]()]/;

  let decorativeCount = 0;
  let spammyCount = 0;
  let bracketCount = 0;
  let photocardCount = 0;
  let duplicatePhotocardCount = 0;
  let wordSum = 0;

  for (const title of titles) {
    if (decorative.test(title)) decorativeCount += 1;
    if (spammy.test(title)) spammyCount += 1;
    if (brackets.test(title)) bracketCount += 1;

    const lower = title.toLowerCase();
    const photocardHits = (lower.match(/photocard|photo card|\bpc\b/g) ?? []).length;
    if (photocardHits >= 1) photocardCount += 1;
    if (photocardHits >= 2) duplicatePhotocardCount += 1;

    wordSum += title.trim().split(/\s+/).filter(Boolean).length;
  }

  return {
    avgWordCount: Math.round((wordSum / total) * 10) / 10,
    withDecorativeChars: decorativeCount,
    withSpammyTokens: spammyCount,
    withBrackets: bracketCount,
    mentionsPhotocard: photocardCount,
    duplicatePhotocardKeyword: duplicatePhotocardCount,
  };
}

function examples(values: string[]) {
  const byLength = [...values].sort((a, b) => b.length - a.length);
  const longest = byLength.slice(0, 10).map((v) => ({ len: v.length, title: v }));
  const shortest = byLength
    .slice(-10)
    .reverse()
    .map((v) => ({ len: v.length, title: v }));

  return { longest, shortest };
}

export async function GET() {
  try {
    await requireApiUser();

    const products = await prisma.product.findMany({
      select: { productName: true, ebayTitle: true, status: true },
    });

    const productNames = products
      .map((p) => p.productName?.trim() ?? "")
      .filter((v) => v.length > 0);
    const ebayTitles = products
      .map((p) => p.ebayTitle?.trim() ?? "")
      .filter((v) => v.length > 0);

    // 실제 eBay에 올라갈 제목 = ebayTitle 우선, 없으면 productName fallback.
    const effectiveTitles = products
      .map((p) => (p.ebayTitle?.trim() || p.productName?.trim() || ""))
      .filter((v) => v.length > 0);

    const statusBreakdown: Record<string, number> = {};
    for (const p of products) {
      statusBreakdown[p.status] = (statusBreakdown[p.status] ?? 0) + 1;
    }

    return Response.json({
      totalProducts: products.length,
      withEbayTitle: ebayTitles.length,
      withoutEbayTitle: products.length - ebayTitles.length,
      statusBreakdown,
      productName: {
        length: lengthStats(productNames),
        patterns: patternSignals(productNames),
        examples: examples(productNames),
      },
      ebayTitle: {
        length: lengthStats(ebayTitles),
        patterns: patternSignals(ebayTitles),
        examples: examples(ebayTitles),
      },
      effectiveTitle: {
        note: "ebayTitle 우선, 없으면 productName으로 대체한 '실제 eBay 노출 제목' 기준",
        length: lengthStats(effectiveTitles),
        patterns: patternSignals(effectiveTitles),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
