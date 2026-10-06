/**
 * DeliveryFileStore — the frozen files of a delivery on disk (plans/PROJECTS.md):
 * `{config.deliveries.path}/{professional}/{deliveryId}/{name}`.
 *
 * The files are made in the professional's browser and arrive as raw request bodies, so
 * only a short list of extensions is taken, and the content type is fixed here by the
 * extension, never taken from the client. They are served only through the delivery's
 * link (routes/client.ts), so there is no static mount and revoking a link takes its
 * files offline as well.
 */

import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { DeliveryFileKind } from '@archiyou/types';

import { config } from '../config';

/** What a delivery may hold, by extension. */
const FILE_TYPES: Record<string, { kind: DeliveryFileKind; mime: string }> = {
  glb: { kind: 'model', mime: 'model/gltf-binary' },
  pdf: { kind: 'document', mime: 'application/pdf' },
  xlsx: { kind: 'sheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  png: { kind: 'preview', mime: 'image/png' },
};

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

/** The kind and content type of a file name, or null when a delivery cannot hold it. */
export function deliveryFileType(name: string): { kind: DeliveryFileKind; mime: string } | null
{
  if (!SAFE_NAME.test(name) || name.includes('..')) return null;
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return FILE_TYPES[ext] ?? null;
}

export class DeliveryFileStore
{
  private get root(): string
  {
    return resolve(config.deliveries.path);
  }

  private dir(professional: string, deliveryId: string): string
  {
    if (!SAFE_SEGMENT.test(professional) || !SAFE_SEGMENT.test(deliveryId) || professional.startsWith('.') || deliveryId.startsWith('.'))
    {
      throw new Error('DeliveryFileStore: unsafe path segment');
    }
    return join(this.root, professional, deliveryId);
  }

  /** Store one file (the name must pass deliveryFileType), replacing one of that name. */
  async write(professional: string, deliveryId: string, name: string, data: Buffer): Promise<void>
  {
    if (!deliveryFileType(name)) throw new Error(`DeliveryFileStore: refusing file name "${name}"`);
    const dir = this.dir(professional, deliveryId);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${name}.${process.pid}.tmp`);
    await writeFile(tmp, data);
    await rename(tmp, join(dir, name));
  }

  /** A file to stream to the client, with its size; null when it is not there. */
  async read(professional: string, deliveryId: string, name: string): Promise<{ stream: ReadStream; bytes: number } | null>
  {
    if (!deliveryFileType(name)) return null;
    const path = join(this.dir(professional, deliveryId), name);
    try
    {
      const { size } = await stat(path);
      return { stream: createReadStream(path), bytes: size };
    }
    catch
    {
      return null;
    }
  }

  /** Every file of a delivery. */
  async remove(professional: string, deliveryId: string): Promise<void>
  {
    await rm(this.dir(professional, deliveryId), { recursive: true, force: true });
  }
}

export const deliveryFileStore = new DeliveryFileStore();
