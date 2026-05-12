import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  bulkUploadPhotoCardImagesToR2,
  countPendingPhotoCardR2Uploads,
} from "@/lib/services/photoCardMatchService";

const filterSchema = z.object({
  group: z.string().optional(),
  member: z.string().optional(),
  album: z.string().optional(),
  version: z.string().optional(),
  keyword: z.string().optional(),
});

const uploadSchema = filterSchema.extend({
  batch_size: z.number().int().min(1).max(50).optional(),
  batchSize: z.number().int().min(1).max(50).optional(),
});

export async function GET(request: Request) {
  try {
    await requireApiUser();

    const url = new URL(request.url);
    const input = filterSchema.parse({
      group: url.searchParams.get("group") ?? undefined,
      member: url.searchParams.get("member") ?? undefined,
      album: url.searchParams.get("album") ?? undefined,
      version: url.searchParams.get("version") ?? undefined,
      keyword: url.searchParams.get("keyword") ?? undefined,
    });
    const pendingCount = await countPendingPhotoCardR2Uploads(input);

    return Response.json({ pendingCount });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("Invalid filter input.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    await requireApiUser();

    const body = (await request.json().catch(() => ({}))) as unknown;
    const input = uploadSchema.parse(body);
    const result = await bulkUploadPhotoCardImagesToR2({
      group: input.group,
      member: input.member,
      album: input.album,
      version: input.version,
      keyword: input.keyword,
      batchSize: input.batch_size ?? input.batchSize,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("Invalid upload input.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
