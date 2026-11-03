/**
 * ProjectFileStore — a project's dossier on disk (plans/PROJECTS.md):
 * `{config.projectFiles.path}/{professional}/{projectId}/{fileId}`.
 *
 * Anything the professional keeps with a project: drawings, photos, a quote from a
 * supplier. The bytes arrive as raw request bodies, so only the types below are taken and
 * the content type comes from the extension, never from the client. No HTML, SVG or
 * scripts: a file can reach a client's browser as a delivery attachment. Files are stored
 * under their row's id (the name a person gave them is only data), served only to the
 * professional (routes/projects.ts) and copied into a delivery to reach a client, so
 * deleting one never changes what was sent.
 */

import { createReadStream, type ReadStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { config } from '../config';

/** What a dossier may hold, by extension, and whether a browser may show it in place. */
const FILE_TYPES: Record<string, { mime: string; inline?: boolean }> = {
  pdf: { mime: 'application/pdf', inline: true },
  png: { mime: 'image/png', inline: true },
  jpg: { mime: 'image/jpeg', inline: true },
  jpeg: { mime: 'image/jpeg', inline: true },
  webp: { mime: 'image/webp', inline: true },
  gif: { mime: 'image/gif', inline: true },
  heic: { mime: 'image/heic' },
  txt: { mime: 'text/plain; charset=utf-8' },
  csv: { mime: 'text/csv; charset=utf-8' },
  md: { mime: 'text/markdown; charset=utf-8' },
  rtf: { mime: 'application/rtf' },
  doc: { mime: 'application/msword' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xls: { mime: 'application/vnd.ms-excel' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  ppt: { mime: 'application/vnd.ms-powerpoint' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  odt: { mime: 'application/vnd.oasis.opendocument.text' },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet' },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation' },
  dxf: { mime: 'image/vnd.dxf' },
  dwg: { mime: 'image/vnd.dwg' },
  step: { mime: 'model/step' },
  stp: { mime: 'model/step' },
  stl: { mime: 'model/stl' },
  obj: { mime: 'model/obj' },
  glb: { mime: 'model/gltf-binary' },
  '3dm': { mime: 'model/vnd.3dm' },
  ifc: { mime: 'application/x-step' },
  skp: { mime: 'application/vnd.sketchup.skp' },
  zip: { mime: 'application/zip' },
};

const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

/** The longest name kept: enough for a real file name, short enough for any header. */
export const PROJECT_FILE_NAME_MAX = 120;

/** The content type of a file name, and whether it may show in the browser; null when a
 *  dossier cannot hold it. */
export function projectFileType(name: string): { mime: string; inline: boolean } | null
{
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const type = FILE_TYPES[name.slice(dot + 1).toLowerCase()];
  return type ? { mime: type.mime, inline: !!type.inline } : null;
}

/** The extensions a dossier takes, for the file picker's `accept`. */
export const PROJECT_FILE_EXTENSIONS = Object.keys(FILE_TYPES);

/**
 * A name as it may be stored and sent in a header: no path, no control characters or
 * quotes, at most PROJECT_FILE_NAME_MAX characters with the extension kept. Null when
 * nothing is left of it.
 */
export function cleanFileName(name: string): string | null
{
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!clean) return null;
  if (clean.length <= PROJECT_FILE_NAME_MAX) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : '';
  return clean.slice(0, PROJECT_FILE_NAME_MAX - ext.length) + ext;
}

export class ProjectFileStore
{
  private get root(): string
  {
    return resolve(config.projectFiles.path);
  }

  private dir(professional: string, projectId: string): string
  {
    if (![professional, projectId].every((s) => SAFE_SEGMENT.test(s) && !s.startsWith('.')))
    {
      throw new Error('ProjectFileStore: unsafe path segment');
    }
    return join(this.root, professional, projectId);
  }

  private path(professional: string, projectId: string, fileId: string): string
  {
    if (!SAFE_SEGMENT.test(fileId) || fileId.startsWith('.')) throw new Error('ProjectFileStore: unsafe file id');
    return join(this.dir(professional, projectId), fileId);
  }

  async write(professional: string, projectId: string, fileId: string, data: Buffer): Promise<void>
  {
    const dir = this.dir(professional, projectId);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${fileId}.${process.pid}.tmp`);
    await writeFile(tmp, data);
    await rename(tmp, this.path(professional, projectId, fileId));
  }

  /** A file to stream, with its size; null when it is not there. */
  async read(professional: string, projectId: string, fileId: string): Promise<{ stream: ReadStream; bytes: number } | null>
  {
    const path = this.path(professional, projectId, fileId);
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

  /** Copy a file to `target` (a delivery's file): what was sent stays when this one goes. */
  async copyTo(professional: string, projectId: string, fileId: string, target: string): Promise<void>
  {
    await copyFile(this.path(professional, projectId, fileId), target);
  }

  async remove(professional: string, projectId: string, fileId: string): Promise<void>
  {
    await rm(this.path(professional, projectId, fileId), { force: true });
  }

  /** The whole dossier of a project. */
  async removeProject(professional: string, projectId: string): Promise<void>
  {
    await rm(this.dir(professional, projectId), { recursive: true, force: true });
  }
}

export const projectFileStore = new ProjectFileStore();
