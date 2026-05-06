import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { asErrorMessage, jsonError } from "@/lib/http";

const loginSchema = z.object({
  loginId: z.string().trim().min(1).max(64),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await request.json());
    const user = await prisma.user.findUnique({
      where: { loginId: input.loginId },
    });

    if (!user || !(await bcrypt.compare(input.password, user.password))) {
      return jsonError("로그인 ID 또는 비밀번호가 올바르지 않습니다.", 401);
    }

    await createSession(user.id);

    return Response.json({
      user: { id: user.id, loginId: user.loginId, name: user.name, role: user.role },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError("입력값을 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
