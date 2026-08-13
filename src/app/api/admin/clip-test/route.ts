import sharp from "sharp";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { embedImageWithClipDetailed } from "@/lib/services/clipEmbeddingService";

export const maxDuration = 60;

export async function POST() {
  try {
    await requireApiUser();

    const hasToken = Boolean(process.env.HUGGINGFACE_API_TOKEN);

    if (!hasToken) {
      return Response.json({
        ok: false,
        reason: "HUGGINGFACE_API_TOKEN이 설정되지 않았습니다.",
      });
    }

    // Build a synthetic 256x256 test image (red/blue gradient) so we don't depend on R2.
    const testImage = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .jpeg({ quality: 85 })
      .toBuffer();

    const start = Date.now();
    const { embedding, debug } = await embedImageWithClipDetailed(testImage);
    const latencyMs = Date.now() - start;

    if (!embedding) {
      return Response.json({
        ok: false,
        latencyMs,
        reason:
          "HF API 호출이 실패했거나 임베딩 형식이 예상과 다릅니다.",
        debug,
      });
    }

    return Response.json({
      ok: true,
      latencyMs,
      embeddingLength: embedding.length,
      first5: embedding.slice(0, 5),
      debug,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
