import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.ts";

// S3 Client configuration
export const s3Client = new S3Client({
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
  ...(env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY && {
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

// Input sanitization for S3 keys - prevent path traversal
export const sanitizeS3Key = (fileId: number): string => {
  const sanitizedId = Math.floor(Math.abs(fileId));
  return `downloads/${String(sanitizedId)}.zip`;
};

// S3 health check
export const checkS3Health = async (): Promise<boolean> => {
  if (!env.S3_BUCKET_NAME) return true; // Mock mode
  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: "__health_check_marker__",
    });
    await s3Client.send(command);
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "NotFound") return true;
    return false;
  }
};

// S3 file availability check
export const checkS3Availability = async (
  fileId: number,
): Promise<{
  available: boolean;
  s3Key: string | null;
  size: number | null;
}> => {
  const s3Key = sanitizeS3Key(fileId);

  // If no bucket configured, use mock mode
  if (!env.S3_BUCKET_NAME) {
    const available = fileId % 7 === 0;
    return {
      available,
      s3Key: available ? s3Key : null,
      size: available ? Math.floor(Math.random() * 10000000) + 1000 : null,
    };
  }

  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: s3Key,
    });
    const response = await s3Client.send(command);
    return {
      available: true,
      s3Key,
      size: response.ContentLength ?? null,
    };
  } catch {
    return {
      available: false,
      s3Key: null,
      size: null,
    };
  }
};

// Generate presigned URL for direct S3 download
export const generatePresignedUrl = async (fileId: number): Promise<string> => {
  const s3Key = sanitizeS3Key(fileId);

  // Mock mode - return a fake URL
  if (!env.S3_BUCKET_NAME) {
    return `https://storage.example.com/${s3Key}?token=${crypto.randomUUID()}`;
  }

  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: s3Key,
  });

  return await getSignedUrl(s3Client, command, {
    expiresIn: env.PRESIGNED_URL_EXPIRY_SECONDS,
  });
};

// Graceful shutdown
export const closeS3 = () => {
  s3Client.destroy();
  console.log("[S3] Client destroyed");
};

