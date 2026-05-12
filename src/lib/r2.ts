import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;
  endpoint: string;
};

export type UploadBufferToR2Input = {
  buffer: Buffer | Uint8Array;
  key: string;
  contentType: string;
  cacheControl?: string;
};

export type UploadBufferToR2Result = {
  key: string;
  url: string;
};

export type DeleteObjectFromR2Result = {
  ok: boolean;
  skipped: boolean;
  key: string | null;
  error?: string;
};

let cachedClient: S3Client | null = null;
let cachedEndpoint: string | null = null;

export function assertR2Configured(): R2Config {
  const accountId = requiredEnvText("R2_ACCOUNT_ID");
  const accessKeyId = requiredEnvText("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnvText("R2_SECRET_ACCESS_KEY");
  const bucketName = requiredEnvText("R2_BUCKET_NAME");
  const publicBaseUrl = normalizePublicBaseUrl(requiredEnvText("R2_PUBLIC_BASE_URL"));
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicBaseUrl,
    endpoint,
  };
}

export async function uploadBufferToR2(
  input: UploadBufferToR2Input,
): Promise<UploadBufferToR2Result> {
  const config = assertR2Configured();
  const key = normalizeR2Key(input.key);

  if (!key) {
    throw new Error("R2 key is required.");
  }

  await clientFor(config).send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: input.buffer,
      ContentType: input.contentType,
      CacheControl: input.cacheControl ?? "public, max-age=31536000, immutable",
    }),
  );

  return {
    key,
    url: buildPublicR2Url(key, config.publicBaseUrl),
  };
}

export async function deleteObjectFromR2(
  key: string | null | undefined,
): Promise<DeleteObjectFromR2Result> {
  const normalizedKey = normalizeR2Key(key);

  if (!normalizedKey) {
    return {
      ok: true,
      skipped: true,
      key: null,
    };
  }

  const config = assertR2Configured();

  try {
    await clientFor(config).send(
      new DeleteObjectCommand({
        Bucket: config.bucketName,
        Key: normalizedKey,
      }),
    );
    return {
      ok: true,
      skipped: false,
      key: normalizedKey,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      key: normalizedKey,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function testR2Connection() {
  const config = assertR2Configured();

  await clientFor(config).send(
    new HeadBucketCommand({
      Bucket: config.bucketName,
    }),
  );

  return {
    ok: true,
    bucketName: config.bucketName,
    publicBaseUrl: config.publicBaseUrl,
    endpoint: config.endpoint,
  };
}

export function buildPublicR2Url(key: string, publicBaseUrl?: string | null) {
  const baseUrl = normalizePublicBaseUrl(publicBaseUrl ?? requiredEnvText("R2_PUBLIC_BASE_URL"));
  const normalizedKey = normalizeR2Key(key);

  if (!normalizedKey) {
    throw new Error("R2 key is required.");
  }

  return `${baseUrl}/${normalizedKey}`;
}

export function r2KeyFromPublicUrl(url: string | null | undefined) {
  const text = String(url ?? "").trim();

  if (!text) {
    return null;
  }

  const configuredBase = process.env.R2_PUBLIC_BASE_URL?.trim();
  const bases = [configuredBase].filter((value): value is string => Boolean(value));

  for (const base of bases) {
    const normalizedBase = normalizePublicBaseUrl(base);

    if (text === normalizedBase) {
      return null;
    }

    if (text.startsWith(`${normalizedBase}/`)) {
      return normalizeR2Key(text.slice(normalizedBase.length + 1));
    }
  }

  return null;
}

function clientFor(config: R2Config) {
  if (!cachedClient || cachedEndpoint !== config.endpoint) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    cachedEndpoint = config.endpoint;
  }

  return cachedClient;
}

function requiredEnvText(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for Cloudflare R2.`);
  }

  return value;
}

function normalizePublicBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function normalizeR2Key(value: string | null | undefined) {
  const text = String(value ?? "").trim().replace(/^\/+/, "");
  return text || null;
}
