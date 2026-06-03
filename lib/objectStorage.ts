import { Readable } from "stream";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type ObjectStorageProvider = "local" | "minio";

export type PutObjectInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
  checksum?: string;
  metadata?: Record<string, string | undefined>;
};

export type ObjectStorage = {
  provider: ObjectStorageProvider;
  putObject(input: PutObjectInput): Promise<void>;
  getObject(key: string): Promise<Uint8Array | null>;
  hasObject(key: string): Promise<boolean>;
};

type MinioConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

function readMinioConfig(): MinioConfig {
  const endpoint = process.env.PRISMATICA_S3_ENDPOINT?.trim() ?? "";
  const region = process.env.PRISMATICA_S3_REGION?.trim() || "us-east-1";
  const bucket = process.env.PRISMATICA_S3_BUCKET?.trim() ?? "";
  const accessKeyId = process.env.PRISMATICA_S3_ACCESS_KEY?.trim() ?? "";
  const secretAccessKey = process.env.PRISMATICA_S3_SECRET_KEY?.trim() ?? "";
  const forcePathStyle = (process.env.PRISMATICA_S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true";

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing MinIO configuration. Set PRISMATICA_S3_ENDPOINT, PRISMATICA_S3_BUCKET, PRISMATICA_S3_ACCESS_KEY, and PRISMATICA_S3_SECRET_KEY.");
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle
  };
}

function isObjectNotFoundError(error: unknown) {
  const candidate = error as { name?: string; Code?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  const errorName = candidate.name ?? candidate.Code ?? candidate.code ?? "";
  if (errorName === "NoSuchBucket") {
    return false;
  }
  return errorName === "NoSuchKey" || errorName === "NotFound" || candidate.$metadata?.httpStatusCode === 404;
}

function objectMetadata(input: PutObjectInput) {
  const metadata = {
    ...(input.checksum ? { checksum: input.checksum } : {}),
    ...(input.metadata ?? {})
  };
  return Object.fromEntries(Object.entries(metadata).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

async function streamToBuffer(streamBody: unknown): Promise<Uint8Array> {
  const body = streamBody as { transformToByteArray?: () => Promise<Uint8Array> };
  if (body?.transformToByteArray) {
    return body.transformToByteArray();
  }

  if (streamBody instanceof Readable || typeof (streamBody as AsyncIterable<Uint8Array> | undefined)?.[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of streamBody as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported object body stream type returned by S3 client.");
}

class MinioObjectStorage implements ObjectStorage {
  provider: ObjectStorageProvider = "minio";
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: MinioConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  async putObject(input: PutObjectInput) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: objectMetadata(input)
      })
    );
  }

  async getObject(key: string) {
    try {
      const output = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key
        })
      );
      if (!output.Body) {
        return null;
      }
      return await streamToBuffer(output.Body);
    } catch (error) {
      if (isObjectNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async hasObject(key: string) {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key
        })
      );
      return true;
    } catch (error) {
      if (isObjectNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }
}

export function createObjectStorageFromEnv(): ObjectStorage {
  const provider = (process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER ?? "local").toLowerCase();
  if (provider === "minio") {
    return new MinioObjectStorage(readMinioConfig());
  }

  return {
    provider: "local",
    async putObject() {
      throw new Error("Local object storage adapter is not implemented. Use filesystem PDF storage or set provider to minio.");
    },
    async getObject() {
      return null;
    },
    async hasObject() {
      return false;
    }
  };
}
