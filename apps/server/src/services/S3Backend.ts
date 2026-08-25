/**
 * S3Backend — the only file in the server that imports the AWS SDK.
 *
 * Everything the backup needs from object storage is three operations, so that is
 * the whole interface. Confining the SDK here means BackupService can be tested
 * against a twenty-line fake instead of a mocked client, and every
 * provider-compatibility quirk has exactly one place to live.
 *
 * "S3" here means any S3-compatible provider: AWS, Cloudflare R2, Backblaze B2,
 * DigitalOcean Spaces, MinIO, Hetzner. The endpoint decides which.
 */

import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';

export interface BackupObject {
  key: string;
  lastModified: Date;
  size: number;
}

/** The storage surface BackupService depends on. Implemented by S3; faked in tests. */
export interface BackupStore {
  /** Every object under the prefix, following pagination to the end. */
  list(prefix: string): Promise<BackupObject[]>;
  /** Streamed multipart upload. */
  put(key: string, body: Readable): Promise<void>;
  /** Batch delete. Throws if the provider reports any per-key failure. */
  remove(keys: string[]): Promise<void>;
}

export interface S3StoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** 'when_required' (default) | 'when_supported' — see below. */
  checksums: string;
}

/** Providers cap a list page at 1000; this is a runaway guard, not a real limit. */
const MAX_LISTED = 10_000;
/** The API allows 1000 per call; smaller batches keep an error report readable. */
const DELETE_BATCH = 100;
/** 8 MB parts with a queue of 1 ⇒ ~16 MB peak RSS regardless of archive size. */
const PART_SIZE = 8 * 1024 * 1024;

export function createS3Store(cfg: S3StoreConfig): BackupStore {
  const client = new S3Client({
    region: cfg.region || 'us-east-1',
    // Empty endpoint = real AWS S3, where the SDK derives the host from the region.
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: cfg.forcePathStyle,
    // Explicit, never the default provider chain: an unset key must be a clean
    // config error, not a silent attempt to reach the EC2 metadata endpoint.
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Since SDK v3.729 the default ('WHEN_SUPPORTED') adds x-amz-checksum-crc32 and
    // aws-chunked streaming trailers, which several S3-compatible providers reject
    // with an opaque 400. This is the single most likely cause of "works on AWS,
    // fails on R2/B2/Spaces", so it defaults off and is env-overridable.
    requestChecksumCalculation: normalizeChecksums(cfg.checksums),
    responseChecksumValidation: normalizeChecksums(cfg.checksums),
  });

  return {
    async list(prefix: string): Promise<BackupObject[]> {
      const out: BackupObject[] = [];
      let token: string | undefined;

      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: prefix ? `${prefix}/` : undefined,
            ContinuationToken: token,
          }),
        );

        for (const o of page.Contents ?? []) {
          if (!o.Key) continue;
          out.push({ key: o.Key, lastModified: o.LastModified ?? new Date(0), size: o.Size ?? 0 });
        }

        if (out.length > MAX_LISTED) {
          throw new Error(
            `more than ${MAX_LISTED} objects under "${prefix}" — refusing to page further. Narrow SERVER_BACKUP_S3_PREFIX or clean the bucket up by hand.`,
          );
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);

      return out;
    },

    async put(key: string, body: Readable): Promise<void> {
      const upload = new Upload({
        client,
        params: {
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/gzip',
        },
        partSize: PART_SIZE,
        // Sequential parts: bounded memory, and kinder to a modest uplink than
        // saturating it with parallel writes at 3am.
        queueSize: 1,
        // Abort the multipart upload on failure rather than leaving billable
        // orphaned parts behind.
        leavePartsOnError: false,
      });
      await upload.done();
    },

    async remove(keys: string[]): Promise<void> {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        const batch = keys.slice(i, i + DELETE_BATCH);
        const res = await client.send(
          new DeleteObjectsCommand({
            Bucket: cfg.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        // DeleteObjects returns HTTP 200 with per-key errors in the body — easy to
        // miss, and missing it would report a prune that never happened.
        const errors = res.Errors ?? [];
        if (errors.length) {
          const detail = errors.slice(0, 5).map((e) => `${e.Key}: ${e.Code} ${e.Message}`).join('; ');
          throw new Error(`${errors.length} object(s) could not be deleted — ${detail}`);
        }
      }
    },
  };
}

function normalizeChecksums(value: string): 'WHEN_REQUIRED' | 'WHEN_SUPPORTED' {
  return value.trim().toLowerCase() === 'when_supported' ? 'WHEN_SUPPORTED' : 'WHEN_REQUIRED';
}

/**
 * A one-line description of where a backup is going, safe to log.
 * The secret access key is never included in any form; the key id is masked.
 */
export function describeStore(cfg: S3StoreConfig): string {
  const where = cfg.endpoint || 'aws s3';
  const id = cfg.accessKeyId.length > 4 ? `****${cfg.accessKeyId.slice(-4)}` : '****';
  return `${where} · bucket ${cfg.bucket} · region ${cfg.region} · key ${id}${cfg.forcePathStyle ? ' · path-style' : ''}`;
}
