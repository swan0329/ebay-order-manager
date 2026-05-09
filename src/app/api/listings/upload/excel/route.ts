import { z } from "zod";
import { parseCsvObjects } from "@/lib/csv";
import { asErrorMessage, jsonError } from "@/lib/http";
import { buildListingPayloadPreview } from "@/lib/services/listingService";
import {
  normalizeListingUploadRow,
  parseListingUploadWorkbook,
} from "@/lib/services/listingUploadInput";
import { resolveListingTemplateDefaults } from "@/lib/services/listingTemplateService";
import { upsertProductFromListingInput } from "@/lib/services/inventoryService";
import { processProductUpload } from "@/lib/services/uploadQueue";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const maxRowsPerRequest = 100;
const maxPreviewRows = 20;

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const form = await request.formData();
    const file = form.get("file");
    const templateId = String(form.get("templateId") ?? form.get("template_id") ?? "").trim();
    const previewOnly =
      String(form.get("previewOnly") ?? form.get("validateOnly") ?? "").toLowerCase() ===
      "true";

    if (!(file instanceof File)) {
      return jsonError("엑셀 파일을 선택해 주세요.", 422);
    }

    const { template, defaults } = await resolveListingTemplateDefaults(
      user.id,
      templateId || null,
    );
    const fileName = file.name.toLowerCase();
    const rows =
      fileName.endsWith(".csv")
        ? parseCsvObjects(await file.text())
        : parseListingUploadWorkbook(Buffer.from(await file.arrayBuffer()));
    const limitedRows = rows.slice(0, previewOnly ? maxPreviewRows : maxRowsPerRequest);

    if (previewOnly) {
      const previews = limitedRows.map((row, index) => {
        const input = normalizeListingUploadRow(row, {
          templateDefaults: defaults ?? undefined,
          rowIndex: index + 1,
        });

        return {
          rowNumber: index + 2,
          finalInput: input,
          preview: buildListingPayloadPreview(input),
        };
      });

      return Response.json({
        ok: true,
        template,
        rows: previews,
        skipped: Math.max(rows.length - limitedRows.length, 0),
      });
    }

    let created = 0;
    let updated = 0;
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const [index, row] of limitedRows.entries()) {
      try {
        const input = normalizeListingUploadRow(row, {
          templateDefaults: defaults ?? undefined,
          rowIndex: index + 1,
        });
        const result = await upsertProductFromListingInput(input, user.id);
        const upload = await processProductUpload({
          userId: user.id,
          productId: result.product.id,
          sku: result.product.sku,
          source: "excel",
          templateId: template?.id,
          rawJson: row,
          finalInput: input,
        });

        if ("error" in upload) {
          failed += 1;
          errors.push(`${index + 2}행 ${input.sku}: ${upload.error}`);
        } else {
          success += 1;
        }

        if (result.created) {
          created += 1;
        } else {
          updated += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push(
          `${index + 2}행 ${
            error instanceof z.ZodError
              ? error.issues[0]?.message ?? "입력값 오류"
              : asErrorMessage(error)
          }`,
        );
      }
    }

    return Response.json({
      template,
      created,
      updated,
      success,
      failed,
      skipped: Math.max(rows.length - limitedRows.length, 0),
      errors,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
