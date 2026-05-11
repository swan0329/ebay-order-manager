import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { confirmProductImageMatch } from "@/lib/services/productImageMatchService";

const confirmSchema = z.object({
  productId: z.string().min(1),
  frontImageUrl: z.string().startsWith("data:image/"),
  backImageUrl: z.string().startsWith("data:image/").nullable().optional(),
  matchConfidence: z.number().min(0).max(1).nullable().optional(),
  matchedBy: z.enum(["image_similarity", "manual", "google_search"]).optional(),
});

export async function POST(request: Request) {
  try {
    await requireApiUser();

    const input = confirmSchema.parse(await request.json());
    const product = await confirmProductImageMatch({
      ...input,
      publicBaseUrl: publicBaseUrl(request),
    });

    return Response.json({ product });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("Invalid image match input.", 422, error.flatten());
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
