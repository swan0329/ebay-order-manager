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
    const frontImage = formData.get("frontImage");
    const backImage = formData.get("backImage");

    if (!(frontImage instanceof File) || frontImage.size === 0) {
      return jsonError("frontImage is required.", 422);
    }

    const prepared = await prepareUploadedProductImages(
      frontImage,
      backImage instanceof File ? backImage : null,
    );
    const candidates = await findProductImageCandidates(prepared.frontSignature, {
      limit: 10,
    });

    return Response.json({
      upload: {
        frontImageUrl: prepared.frontImageUrl,
        backImageUrl: prepared.backImageUrl,
      },
      candidates,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
