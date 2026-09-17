import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  diagnoseImageMatchForSku,
  findProductImageCandidates,
  prepareUploadedProductImages,
} from "@/lib/services/productImageMatchService";
import { embedImageWithClip } from "@/lib/services/clipEmbeddingService";

export const maxDuration = 60;

function normalizeVector(values: number[]): number[] {
  let sumSquares = 0;
  for (const value of values) {
    sumSquares += value * value;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return values.slice();
  return values.map((value) => value / norm);
}

export async function POST(request: Request) {
  try {
    await requireApiUser();

    const formData = await request.formData();
    const frontImage =
      formData.get("uploaded_front_image") ?? formData.get("frontImage");
    const backImage =
      formData.get("uploaded_back_image") ?? formData.get("backImage");

    if (!(frontImage instanceof File) || frontImage.size === 0) {
      return jsonError("uploaded_front_image is required.", 422);
    }

    const prepared = await prepareUploadedProductImages(
      frontImage,
      backImage instanceof File ? backImage : null,
    );

    // Optional: pre-computed embedding from browser (transformers.js path).
    // When provided, we use it directly instead of relying on server-side CLIP.
    const embeddingRaw = formData.get("clip_embedding")?.toString();
    if (embeddingRaw) {
      try {
        const parsed = JSON.parse(embeddingRaw) as unknown;
        if (Array.isArray(parsed) && parsed.length === 512 && parsed.every((v) => typeof v === "number")) {
          prepared.frontFingerprint.clipEmbedding = normalizeVector(parsed);
        }
      } catch {
        // ignore — fall back to whatever clipEmbedding (if any) was computed server-side
      }
    }

    const group = formData.get("group")?.toString() || null;
    const member = formData.get("member")?.toString() || null;
    const album = formData.get("album")?.toString() || null;
    const version = formData.get("version")?.toString() || null;
    const debugSku = formData.get("debug_sku")?.toString().trim();

    if (!prepared.frontFingerprint.clipEmbedding?.length) {
      const serverEmbedding = await embedImageWithClip(
        Buffer.from(await frontImage.arrayBuffer()),
      ).catch(() => null);

      if (serverEmbedding?.length) {
        prepared.frontFingerprint.clipEmbedding = serverEmbedding;
      }
    }

    if (!prepared.frontFingerprint.clipEmbedding?.length) {
      const debug = debugSku
        ? await diagnoseImageMatchForSku(
            prepared.frontFingerprint,
            debugSku,
            { group, member, album, version },
            [],
          )
        : null;

      return Response.json({
        debug,
        upload_has_clip: false,
        candidates: [],
        confident_candidate: false,
        blocked_reason: "clip_unavailable",
      });
    }

    const hasFilters = Boolean(group || member || album || version);
    const candidates = await findProductImageCandidates(prepared.frontFingerprint, {
      // With a filter we want the whole (small) member/group set to be
      // returnable so the right card is never cut off; unfiltered returns a deep
      // ranked list. Search is DB-only now, so this stays fast.
      limit: hasFilters ? 500 : 300,
      group,
      member,
      album,
      version,
    });

    const debug = debugSku
      ? await diagnoseImageMatchForSku(
          prepared.frontFingerprint,
          debugSku,
          { group, member, album, version },
          candidates.map((candidate) => candidate.id),
        )
      : null;

    return Response.json({
      debug,
      upload_has_clip: Boolean(prepared.frontFingerprint.clipEmbedding?.length),
      candidates: candidates.map((candidate) => ({
        card_id: candidate.id,
        group_name: candidate.groupName,
        member_name: candidate.memberName,
        album_name: candidate.albumName,
        version_name: candidate.versionName,
        existing_image_url: candidate.existingImageUrl,
        hash_distance: candidate.hashDistance,
        orb_match_count: candidate.orbMatchCount,
        homography_inliers: candidate.homographyInliers,
        final_score: candidate.finalScore,
        product: candidate,
      })),
      confident_candidate: candidates.some((candidate) => candidate.finalScore >= 0.45),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    console.error("[image-match] failed:", error);
    return jsonError(asErrorMessage(error), 500);
  }
}
