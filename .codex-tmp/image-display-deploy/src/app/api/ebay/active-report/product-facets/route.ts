import { z } from "zod";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

const schema = z.object({
  group: z.string().trim().max(120).nullish(),
  member: z.string().trim().max(120).nullish(),
});

function values(rows: Array<{ value: string | null }>) {
  return rows
    .map((row) => row.value?.trim())
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));
}

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const { group, member } = schema.parse(await request.json().catch(() => ({})));
    const active = { not: "inactive" } as const;
    const [groups, members, albums] = await Promise.all([
      prisma.product.findMany({
        where: { status: active, brand: { not: null } },
        distinct: ["brand"],
        select: { brand: true },
        orderBy: { brand: "asc" },
      }),
      prisma.product.findMany({
        where: {
          status: active,
          optionName: { not: null },
          ...(group ? { brand: { equals: group, mode: "insensitive" as const } } : {}),
        },
        distinct: ["optionName"],
        select: { optionName: true },
        orderBy: { optionName: "asc" },
      }),
      prisma.product.findMany({
        where: {
          status: active,
          category: { not: null },
          ...(group ? { brand: { equals: group, mode: "insensitive" as const } } : {}),
          ...(member ? { optionName: { equals: member, mode: "insensitive" as const } } : {}),
        },
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
      }),
    ]);

    return Response.json({
      groups: values(groups.map((row) => ({ value: row.brand }))),
      members: values(members.map((row) => ({ value: row.optionName }))),
      albums: values(albums.map((row) => ({ value: row.category }))),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) return jsonError("필터 값을 확인해 주세요.", 422);
    return jsonError(error instanceof Error ? error.message : "후보 필터를 불러오지 못했습니다.", 500);
  }
}
