import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function unquote(value: string) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);

    if (!match || line.trimStart().startsWith("#")) {
      continue;
    }

    process.env[match[1]] ??= unquote(match[2]);
  }
}

loadEnv();

async function main() {
  const limit = Number(process.argv[2] ?? "1000");

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("Usage: npm run products:image-signatures -- <positive limit>");
  }

  const [{ rebuildProductImageSignatures }, { prisma }] = await Promise.all([
    import("../src/lib/services/productImageMatchService"),
    import("../src/lib/prisma"),
  ]);

  try {
    const result = await rebuildProductImageSignatures(limit);
    console.log(
      `scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
