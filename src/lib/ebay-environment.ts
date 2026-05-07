import { EbayEnvironment } from "@/generated/prisma";
import { getEbayEnvironment } from "@/lib/env";

export function currentEbayEnvironment() {
  return getEbayEnvironment() === "production"
    ? EbayEnvironment.PRODUCTION
    : EbayEnvironment.SANDBOX;
}
