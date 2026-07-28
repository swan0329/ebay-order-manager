import { z } from "zod";
import { lookup } from "node:dns/promises";
import net from "node:net";
import sharp from "sharp";
import { jsonError } from "@/lib/http";
import { workerCanAccessProduct } from "@/lib/image-work-assignments";
import { getCurrentUser, UnauthorizedError } from "@/lib/session";
import { embedImageWithClip } from "@/lib/services/clipEmbeddingService";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ referenceUrl: z.string().url(), candidateUrls: z.array(z.string().url()).min(1).max(8) });

async function imageBuffer(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("지원하지 않는 이미지 주소입니다.");
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.some(({ address }) => {
    if (!net.isIP(address)) return true;
    if (address === "::1" || /^(fc|fd|fe80):/i.test(address)) return true;
    const parts = address.split(".").map(Number);
    return address.startsWith("127.") || address.startsWith("10.") || address.startsWith("192.168.") || address.startsWith("169.254.") || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  })) throw new Error("내부 주소는 사용할 수 없습니다.");
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`이미지 요청 실패: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 15_000_000) throw new Error("이미지가 15MB를 초과합니다.");
  return buffer;
}

function cosine(left: number[], right: number[]) {
  let dot = 0, a = 0, b = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) { dot += left[index] * right[index]; a += left[index] ** 2; b += right[index] ** 2; }
  return dot / (Math.sqrt(a) * Math.sqrt(b) || 1);
}

async function clipRanking(referenceUrl: string, candidateUrls: string[]) {
  const reference = await imageBuffer(referenceUrl);
  const referenceEmbedding = await embedImageWithClip(reference);
  const results = await Promise.all(candidateUrls.map(async (url) => {
    const buffer = await imageBuffer(url);
    const [embedding, metadata, stats] = await Promise.all([embedImageWithClip(buffer), sharp(buffer).metadata(), sharp(buffer).greyscale().stats()]);
    const similarity = referenceEmbedding && embedding ? (cosine(referenceEmbedding, embedding) + 1) / 2 : .5;
    const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
    const resolution = Math.min(1, Math.sqrt(pixels) / 1200);
    const sharpness = Math.min(1, (stats.channels[0]?.stdev ?? 0) / 60);
    const score = Math.max(0, Math.min(1, similarity * .78 + resolution * .14 + sharpness * .08));
    return { url, score, reason: `동일 카드 유사도 ${Math.round(similarity * 100)}% · 해상도 ${metadata.width ?? 0}×${metadata.height ?? 0}` };
  }));
  return results.sort((a, b) => b.score - a.score);
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthorizedError();
    const { id } = await context.params;
    if (user.role === "WORKER" && !(await workerCanAccessProduct(user.id, id))) throw new UnauthorizedError();
    const input = schema.parse(await request.json());
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return Response.json({ results: await clipRanking(input.referenceUrl, input.candidateUrls) });
    }
    const content: Array<Record<string, unknown>> = [
      { type: "input_text", text: "첫 이미지는 기준 포토카드다. 이후 후보들을 같은 카드 여부, 해상도/선명도, 워터마크, 잘림, 네 모서리 추출 가능성으로 평가하라. 각 후보에 0~1 score와 짧은 한국어 reason을 주고 score 내림차순으로 반환하라. 다른 카드 가능성이 있으면 0.3 이하로 평가하라." },
      { type: "input_image", image_url: input.referenceUrl, detail: "low" },
      ...input.candidateUrls.flatMap((url, index) => [{ type: "input_text", text: `후보 ${index + 1}: ${url}` }, { type: "input_image", image_url: url, detail: "low" }]),
    ];
    const responseSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              index: { type: "integer" },
              score: { type: "number" },
              reason: { type: "string" },
            },
            required: ["index", "score", "reason"],
          },
        },
      },
      required: ["results"],
    };
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL ?? "gpt-5-mini",
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "candidate_ranking", strict: true, schema: responseSchema } },
      }),
    });
    const body = await response.json() as { output_text?: string; error?: { message?: string }; output?: Array<{ content?: Array<{ text?: string }> }> };
    if (!response.ok) return jsonError(body.error?.message ?? "AI 후보 평가 실패", 502);
    const outputText = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
    const parsed = JSON.parse(outputText) as { results: Array<{ index: number; score: number; reason: string }> };
    const results = parsed.results.map((item) => ({ url: input.candidateUrls[item.index - 1], score: Math.max(0, Math.min(1, item.score)), reason: item.reason })).filter((item) => item.url).sort((a, b) => b.score - a.score);
    return Response.json({ results });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("후보 이미지 입력을 확인해 주세요.", 422);
    return jsonError(error instanceof Error ? error.message : "AI 분석 실패", 500);
  }
}
