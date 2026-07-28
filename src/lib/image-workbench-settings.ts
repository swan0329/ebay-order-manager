import { prisma } from "@/lib/prisma";

export type ImageWorkbenchSettings = {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  watermarkStrength: number;
  localAiEnabled: boolean;
};

const defaults: ImageWorkbenchSettings = {
  brightness: 8,
  contrast: 3,
  saturation: 5,
  sharpness: 12,
  watermarkStrength: 110,
  localAiEnabled: false,
};

async function ensureImageWorkbenchSettings() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "image_workbench_settings" (
      "user_id" TEXT PRIMARY KEY,
      "brightness" INTEGER NOT NULL DEFAULT 8,
      "contrast" INTEGER NOT NULL DEFAULT 3,
      "saturation" INTEGER NOT NULL DEFAULT 5,
      "sharpness" INTEGER NOT NULL DEFAULT 12,
      "watermark_strength" INTEGER NOT NULL DEFAULT 110,
      "local_ai_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_workbench_settings" ADD COLUMN IF NOT EXISTS "contrast" INTEGER NOT NULL DEFAULT 3`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_workbench_settings" ADD COLUMN IF NOT EXISTS "saturation" INTEGER NOT NULL DEFAULT 5`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_workbench_settings" ADD COLUMN IF NOT EXISTS "sharpness" INTEGER NOT NULL DEFAULT 12`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_workbench_settings" ADD COLUMN IF NOT EXISTS "watermark_strength" INTEGER NOT NULL DEFAULT 110`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "image_workbench_settings" ADD COLUMN IF NOT EXISTS "local_ai_enabled" BOOLEAN NOT NULL DEFAULT FALSE`);
}

export async function getImageWorkbenchSettings(userId: string): Promise<ImageWorkbenchSettings> {
  await ensureImageWorkbenchSettings();
  const rows = await prisma.$queryRaw<Array<ImageWorkbenchSettings>>`
    SELECT "brightness", "contrast", "saturation", "sharpness",
      "watermark_strength" AS "watermarkStrength",
      "local_ai_enabled" AS "localAiEnabled"
    FROM "image_workbench_settings"
    WHERE "user_id" = ${userId} LIMIT 1
  `;
  return rows[0] ?? defaults;
}

export async function saveImageWorkbenchSettings(userId: string, settings: ImageWorkbenchSettings) {
  await ensureImageWorkbenchSettings();
  await prisma.$executeRaw`
    INSERT INTO "image_workbench_settings" ("user_id", "brightness", "contrast", "saturation", "sharpness", "watermark_strength", "local_ai_enabled", "updated_at")
    VALUES (${userId}, ${settings.brightness}, ${settings.contrast}, ${settings.saturation}, ${settings.sharpness}, ${settings.watermarkStrength}, ${settings.localAiEnabled}, NOW())
    ON CONFLICT ("user_id") DO UPDATE SET
      "brightness" = EXCLUDED."brightness",
      "contrast" = EXCLUDED."contrast",
      "saturation" = EXCLUDED."saturation",
      "sharpness" = EXCLUDED."sharpness",
      "watermark_strength" = EXCLUDED."watermark_strength",
      "local_ai_enabled" = EXCLUDED."local_ai_enabled",
      "updated_at" = NOW()
  `;
}
