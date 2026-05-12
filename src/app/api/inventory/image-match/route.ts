import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  findProductImageCandidates,
  prepareUploadedProductImages,
} from "@/lib/services/productImageMatchService";

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
    const candidates = await findProductImageCandidates(prepared.frontFingerprint, {
      limit: 10,
    });

    return Response.json({
      uploaded_preview_url: prepared.frontImageUrl,
      upload: {
        frontImageUrl: prepared.frontImageUrl,
        backImageUrl: prepared.backImageUrl,
      },
      candidates: candidates.map((candidate) => ({
        card_id: candidate.id,
        group_name: candidate.groupName,
        member_name: candidate.memberName,
        album_name: candidate.albumName,
        version_name: candidate.versionName,
        existing_image_url: candidate.existingImageUrl,
        uploaded_preview_url: prepared.frontImageUrl,
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

    return jsonError(asErrorMessage(error), 500);
  }
}
