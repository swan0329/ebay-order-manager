import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requiredEnv } from "@/lib/env";

const cookieName = "ebay_order_manager_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;

type SessionPayload = {
  userId: string;
  role: "ADMIN";
};

function sessionSecret() {
  return new TextEncoder().encode(requiredEnv("SESSION_SECRET"));
}

export async function createSession(userId: string) {
  const expiresAt = new Date(Date.now() + sessionTtlMs);
  const token = await new SignJWT({ userId, role: "ADMIN" } satisfies SessionPayload)
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
    if (typeof payload.userId !== "string" || payload.role !== "ADMIN") {
      return null;
    }

    return { userId: payload.userId, role: "ADMIN" };
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const session = await readSession();

  if (!session) {
    return null;
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

  if (!user) {
    throw new UnauthorizedError();
  }

  return user;
}
