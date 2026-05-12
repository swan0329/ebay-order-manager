import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { confirmPhotoCardImage } from "@/lib/services/photoCardMatchService";

const confirmSchema = z.object({
  card_id: z.string().min(1).optional(),
  cardId: z.string().min(1).optional(),
  user_front_image_url: z.string().startsWith("data:image/").optional(),
  userFrontImageUrl: z.string().startsWith("data:image/").optional(),
  user_back_image_url: z.string().startsWith("data:image/").nullable().optional(),
  userBackImageUrl: z.string().startsWith("data:image/").nullable().optional(),
});

export async function POST(request: Request) {
  try {
    await requireApiUser();

    const input = confirmSchema.parse(await request.json());
    const cardId = input.card_id ?? input.cardId;
    const userFrontImageUrl = input.user_front_image_url ?? input.userFrontImageUrl;
    const userBackImageUrl = input.user_back_image_url ?? input.userBackImageUrl;

    if (!cardId || !userFrontImageUrl) {
      return jsonError("card_id and user_front_image_url are required.", 422);
    }

    const product = await confirmPhotoCardImage({
      cardId,
      userFrontImageUrl,
      userBackImageUrl,
      publicBaseUrl: publicBaseUrl(request),
    });

    return Response.json({ product });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("Invalid photo card image input.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

function publicBaseUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? requestUrl.host;
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    (requestUrl.protocol ? requestUrl.protocol.replace(/:$/, "") : "https");

  return `${protocol}://${host}`;
}
