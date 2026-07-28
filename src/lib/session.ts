import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requiredEnv } from "@/lib/env";

const cookieName = "ebay_order_manager_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;

type SessionPayload = {
  userId: string;
  loginId?: string;
  name?: string | null;
  role: "ADMIN" | "WORKER";
};

function sessionSecret() {
  return new TextEncoder().encode(requiredEnv("SESSION_SECRET"));
}

export async function createSession(user: {
  id: string;
  loginId: string;
  name?: string | null;
  role: "ADMIN" | "WORKER";
}) {
  const expiresAt = new Date(Date.now() + sessionTtlMs);
  const token = await new SignJWT({
    userId: user.id,
    loginId: user.loginId,
    name: user.name ?? null,
    role: user.role,
  } satisfies SessionPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(sessionSecret());

  const cookieStore = await cookies();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(cookieName);
}

export async function readSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(cookieName)?.value;

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    if (
      typeof payload.userId !== "string" ||
      !["ADMIN", "WORKER"].includes(String(payload.role))
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      loginId: typeof payload.loginId === "string" ? payload.loginId : undefined,
      name:
        typeof payload.name === "string" || payload.name === null
          ? payload.name
          : undefined,
      role: payload.role as "ADMIN" | "WORKER",
    };
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const session = await readSession();

  if (!session) {
    return null;
  }

  if (session.loginId) {
    return {
      id: session.userId,
      loginId: session.loginId,
      name: session.name ?? null,
      role: session.role,
    };
  }

  return prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, loginId: true, name: true, role: true },
  });
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }
  if (user.role !== "ADMIN") {
    redirect("/worker/images");
  }

  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function requireApiUser() {
  const user = await getCurrentUser();

  if (!user || user.role !== "ADMIN") {
    throw new UnauthorizedError();
  }

  return user;
}

export async function requireWorker() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "WORKER") redirect("/products/image-workbench");
  return user;
}
