import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { processProductUpload, retryFailedUploadJobs } from "@/lib/services/uploadQueue";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const retrySchema = z.object({
  jobId: z.string().optional(),
  productId: z.string().optional(),
  allFailed: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = retrySchema.parse(await request.json().catch(() => ({})));

    if (input.allFailed) {
      const results = await retryFailedUploadJobs(user.id);
      return Response.json({
        retried: results.length,
        success: results.filter((result) => !("error" in result)).length,
        failed: results.filter((result) => "error" in result).length,
      });
    }

    if (input.jobId) {
      const job = await prisma.productUploadJob.findFirst({
        where: { id: input.jobId, userId: user.id, productId: { not: null } },
      });

      if (!job?.productId) {
        return jsonError("재시도할 업로드 작업을 찾을 수 없습니다.", 404);
      }

      const result = await processProductUpload({
        userId: user.id,
        productId: job.productId,
        sku: job.sku,
        source: "retry",
        rawJson: { retryOf: job.id },
      });
      return Response.json(result);
    }

    if (input.productId) {
      const product = await prisma.product.findFirst({
        where: { id: input.productId },
      });

      if (!product) {
        return jsonError("상품을 찾을 수 없습니다.", 404);
      }

      const result = await processProductUpload({
        userId: user.id,
        productId: product.id,
        sku: product.sku,
        source: "retry",
      });
      return Response.json(result);
    }

    return jsonError("jobId, productId 또는 allFailed 값을 입력해 주세요.", 422);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("재시도 입력값을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
