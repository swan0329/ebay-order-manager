import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildAuthorizationUrl } from "@/lib/ebay";
import { asErrorMessage } from "@/lib/http";
import { requireUser } from "@/lib/session";

export async function GET() {
  await requireUser();

  const state = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set("ebay_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });

  let authorizationUrl: string;

  try {
    authorizationUrl = buildAuthorizationUrl(state);
  } catch (error) {
    redirect(
      `/connect?error=${encodeURIComponent(
        `eBay 설정값을 확인해 주세요. ${asErrorMessage(error)}`,
      )}`,
    );
  }

  redirect(authorizationUrl);
}
