import {
    CopyObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
    S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const bucket = process.env.S3_BUCKET ?? "linger";

export function s3Client(endpoint: string): S3Client {
    return new S3Client({
        endpoint,
        region: process.env.S3_REGION ?? "auto",
        forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "linger",
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "linger-local",
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
    });
}

const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:8174";

/** The API's own client, which reaches storage at S3_ENDPOINT. */
export const s3 = s3Client(endpoint);

/**
 * Signs the URLs devices use. With S3_PUBLIC_ENDPOINT set (a LAN address in development, so a
 * phone or an emulator can reach local storage), signed URLs point there; otherwise at S3_ENDPOINT.
 */
export function signerFor(env: Record<string, string | undefined> = process.env): S3Client {
    return env.S3_PUBLIC_ENDPOINT ? s3Client(env.S3_PUBLIC_ENDPOINT) : s3;
}

export const signer = signerFor();

/** Seconds an upload URL stays valid. */
export const UPLOAD_SECONDS = 15 * 60;
/** The largest original or cover the API accepts. The app sends photos well under this. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Seconds a photo URL stays valid; the app refetches the gallery for fresh ones. */
export const PHOTO_SECONDS = 60 * 60;

export type ShotVariant = "original" | "developed" | "thumb";

export const keys = {
    event: (eventId: string) => `events/${eventId}/`,
    cover: (eventId: string) => `events/${eventId}/cover.jpg`,
    shotFolder: (eventId: string, shotId: string) => `events/${eventId}/shots/${shotId}/`,
    shot: (eventId: string, shotId: string, variant: ShotVariant) =>
        `${keys.shotFolder(eventId, shotId)}${variant}.jpg`,
};

/** Image types a cover may be uploaded as. Shots are always JPEG. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/heic", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/**
 * A signed PUT. The content type is part of the signature, so the stored object is always served
 * as that image type; sizes are checked when an upload is confirmed.
 */
export function uploadUrl(key: string, contentType: ImageType = "image/jpeg"): Promise<string> {
    return getSignedUrl(
        signer,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn: UPLOAD_SECONDS, signableHeaders: new Set(["content-type"]) },
    );
}

export function downloadUrl(
    key: string,
    seconds = PHOTO_SECONDS,
    client: S3Client = signer,
): Promise<string> {
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: seconds,
    });
}

export async function put(key: string, data: Buffer): Promise<void> {
    await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: "image/jpeg" }),
    );
}

/** Copies an object inside the bucket without downloading it. */
export async function copy(from: string, to: string): Promise<void> {
    await s3.send(
        new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${from}`, Key: to }),
    );
}

export async function get(key: string): Promise<Buffer> {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
}

/** The object's size in bytes, or null when there is no such object. */
export async function objectSize(key: string): Promise<number | null> {
    try {
        const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return res.ContentLength ?? 0;
    } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
            return null;
        }
        throw error;
    }
}

export async function exists(key: string): Promise<boolean> {
    return (await objectSize(key)) !== null;
}

export async function remove(key: string): Promise<void> {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function list(prefix: string): Promise<string[]> {
    const found: string[] = [];
    let token: string | undefined;
    do {
        const res = await s3.send(
            new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const item of res.Contents ?? []) if (item.Key) found.push(item.Key);
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return found;
}

/** Deletes every object under a prefix. */
export async function removePrefix(prefix: string): Promise<number> {
    const found = await list(prefix);
    for (let i = 0; i < found.length; i += 1000) {
        const batch = found.slice(i, i + 1000);
        await s3.send(
            new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
            }),
        );
    }
    return found.length;
}

export async function healthy(): Promise<boolean> {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
        return true;
    } catch {
        return false;
    }
}
