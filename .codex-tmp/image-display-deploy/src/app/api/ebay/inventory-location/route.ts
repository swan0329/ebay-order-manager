import { z } from "zod";
import {
  ensureKoreaEbayInventoryLocation,
  hasCachedActiveEbayInventoryLocation,
} from "@/lib/ebay-inventory-location";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const schema = z.object({
  postalCode: z.string().trim().regex(/^\d{5}$/),
  city: z.string().trim().min(2).max(64),
  stateOrProvince: z.string().trim().min(2).max(64),
  confirmed: z.literal(true),
});

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json({ ready: await hasCachedActiveEbayInventoryLocation(user.id) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    return Response.json(await ensureKoreaEbayInventoryLocation(user.id, {
      postalCode: input.postalCode,
      city: input.city,
      stateOrProvince: input.stateOrProvince,
    }));
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) {
      return jsonError("한국 우편번호와 영문 도시·시/도 정보를 입력해 주세요.", 422);
    }
    return jsonError(asErrorMessage(error), 502);
  }
}
