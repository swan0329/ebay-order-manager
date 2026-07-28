import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ensureImageWorkAssignments } from "@/lib/image-work-assignments";
import { jsonError } from "@/lib/http";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const createSchema = z.object({
  loginId: z.string().trim().min(3).max(64),
  name: z.string().trim().min(1).max(64),
  password: z.string().min(6).max(128),
});

const assignSchema = z.object({
  workerId: z.string().min(1),
  productIds: z.array(z.string().min(1)).min(1).max(1000),
});

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const input = createSchema.parse(await request.json());
    const exists = await prisma.user.findUnique({ where: { loginId: input.loginId } });
    if (exists) return jsonError("이미 사용 중인 로그인 ID입니다.", 409);
    const user = await prisma.user.create({
      data: { loginId: input.loginId, name: input.name, password: await bcrypt.hash(input.password, 12), role: "WORKER" },
      select: { id: true, loginId: true, name: true, role: true },
    });
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("계정 입력값을 확인해 주세요.", 422, error.flatten());
    return jsonError(error instanceof Error ? error.message : "계정 생성 실패", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireApiUser();
    const input = assignSchema.parse(await request.json());
    const worker = await prisma.user.findFirst({ where: { id: input.workerId, role: "WORKER" } });
    if (!worker) return jsonError("작업자 계정을 찾을 수 없습니다.", 404);
    await ensureImageWorkAssignments();
    const values = input.productIds.map((productId) => Prisma.sql`(${randomUUID()}, ${productId}, ${input.workerId}, 'assigned')`);
    await prisma.$executeRaw`
      INSERT INTO "image_work_assignments" ("id", "product_id", "worker_id", "status")
      VALUES ${Prisma.join(values, ",")}
      ON CONFLICT ("product_id") DO UPDATE SET
        "worker_id" = EXCLUDED."worker_id", "status" = 'assigned',
        "assigned_at" = NOW(), "submitted_at" = NULL,
        "reviewed_at" = NULL, "reviewed_by" = NULL, "rejection_reason" = NULL
    `;
    return Response.json({ ok: true, assigned: input.productIds.length });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("배정 정보를 확인해 주세요.", 422, error.flatten());
    return jsonError(error instanceof Error ? error.message : "배정 실패", 500);
  }
}
