import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma";
import { normalizeDatabaseUrlForPrisma } from "../src/lib/database-url";

normalizeDatabaseUrlForPrisma();

const prisma = new PrismaClient();

async function main() {
  const loginId = process.env.ADMIN_LOGIN_ID ?? process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!loginId || !password) {
    throw new Error("ADMIN_LOGIN_ID and ADMIN_PASSWORD are required for seeding.");
  }

  const hash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { loginId },
    update: { password: hash, name: "Administrator" },
    create: { loginId, password: hash, name: "Administrator" },
  });

  console.log(`Admin user ready: ${loginId}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
