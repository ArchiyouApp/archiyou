/**
 * DeliveryFileStore — the frozen files of a delivery on disk (plans/PROJECTS.md):
 * `{config.deliveries.path}/{professional}/{deliveryId}/{name}`.
 *
 * The files are made in the professional's browser and arrive as raw request bodies, so
 * only a short list of extensions is taken, and the content type is fixed here by the
 * extension, never taken from the client. Attachments are copies of the project's dossier
 * files (ProjectFileStore), with the dossier's wider list of types. They are served only
 * through the delivery's link (routes/client.ts), so there is no static mount and
 * revoking a link takes its files offline as well.
 */

import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { DeliveryFileKind } from '@archiyou/types';

import { config } from '../config';
import { projectFileType } from './ProjectFileStore';

/** What a delivery may hold, by extension. */
const FILE_TYPES: Record<string, { kind: DeliveryFileKind; mime: string }> = {
  glb: { kind: 'model', mime: 'model/gltf-binary' },
  pdf: { kind: 'document', mime: 'application/pdf' },
  xlsx: { kind: 'sheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  png: { kind: 'preview', mime: 'image/png' },
};

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

function safeName(name: string): boolean
{
  return SAFE_NAME.test(name) && !name.includes('..');
}

/** The kind and content type of a made file's name, or null when a delivery cannot hold it. */
export function deliveryFileType(name: string): { kind: DeliveryFileKind; mime: string } | null
{
  if (!safeName(name)) return null;
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return FILE_TYPES[ext] ?? null;
}

/** The content type of an attachment's name (a dossier file's type), or null. */
export function attachmentFileType(name: string): { kind: DeliveryFileKind; mime: string } | null
{
  const type = safeName(name) ? projectFileType(name) : null;
  return type ? { kind: 'attachment', mime: type.mime } : null;
}

/**
 * A dossier file's name as a delivery file name: letters, digits, `.`, `_` and `-` only,
 * the extension kept, not one of `taken`. "Offerte leverancier (2).pdf" becomes
 * "Offerte_leverancier_2.pdf".
 */
export function attachmentName(name: string, taken: string[]): string
{
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 70) || 'file';
  const candidate = (n: number) => `${stem}${n ? `-${n}` : ''}${ext ? `.${ext}` : ''}`;
  const free = Array.from({ length: taken.length + 1 }, (_, n) => candidate(n)).find((c) => !taken.includes(c));
  return free ?? candidate(taken.length + 1);
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

  /** Store one file, replacing one of that name. The caller checked its type
   *  (deliveryFileType, attachmentFileType); this only takes safe names. */
  async write(professional: string, deliveryId: string, name: string, data: Buffer): Promise<void>
  {
    await this.put(professional, deliveryId, name, (tmp) => writeFile(tmp, data));
  }

  /** Store one file that `copy` writes to the path it is given (a dossier file's copy). */
  async put(professional: string, deliveryId: string, name: string, copy: (path: string) => Promise<void>): Promise<void>
  {
    if (!safeName(name)) throw new Error(`DeliveryFileStore: refusing file name "${name}"`);
    const dir = this.dir(professional, deliveryId);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${name}.${process.pid}.tmp`);
    await copy(tmp);
    await rename(tmp, join(dir, name));
  }

  /** A file to stream to the client, with its size; null when it is not there. */
  async read(professional: string, deliveryId: string, name: string): Promise<{ stream: ReadStream; bytes: number } | null>
  {
    if (!safeName(name)) return null;
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
