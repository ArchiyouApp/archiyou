/**
 * <project-files> — a project's dossier: the files the professional keeps with it
 * (plans/PROJECTS.md). Presentational: the page uploads, saves and deletes.
 *
 * Files can be dropped on it as well as chosen with the page's Upload button.
 *
 * Emits:
 *   project-file-download   detail = ProjectFileData
 *   project-file-delete     detail = ProjectFileData
 *   project-files-drop      detail = File[]
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import type { ProjectFileData } from '@archiyou/types';

import { formatDay } from './project-configurations.js';

/** "820 kB", "4.2 MB". */
export function formatBytes(bytes: number): string
{
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} kB`;
  return `${(bytes / 1000 / 1000).toFixed(1)} MB`;
}

/** A lucide icon for a file, by its type. */
export function fileIcon(mime: string): string
{
  if (mime.startsWith('image/')) return 'file-image';
  if (mime === 'application/pdf') return 'file-text';
  if (mime.startsWith('model/') || mime.includes('dwg') || mime.includes('dxf') || mime.includes('sketchup')) return 'file-box';
  if (mime.includes('sheet') || mime.includes('excel') || mime.startsWith('text/csv')) return 'file-spreadsheet';
  if (mime === 'application/zip') return 'file-archive';
  return 'file';
}

@customElement('project-files')
export class ProjectFiles extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class=${this._dragging ? 'drop dragging' : 'drop'}
        @dragover=${this._onDragOver} @dragleave=${() => { this._dragging = false; }} @drop=${this._onDrop}>
        ${this.files.length === 0
          ? html`<p class="empty">${msg('No files yet. Upload drawings, photos or quotes, or drop them here.')}</p>`
          : html`<ul>${this.files.map(f => this._renderFile(f))}</ul>`}
      </div>
    `;
  }

  private _renderFile(f: ProjectFileData)
  {
    return html`
      <li>
        <wa-icon library="lucide" name=${fileIcon(f.mime)}></wa-icon>
        <span class="name" title=${f.name}>${f.name}</span>
        <span class="meta">${formatBytes(f.bytes)} · ${formatDay(f.created)}</span>
        <span class="actions">
          <wa-button size="small" appearance="plain" title=${msg('Download')} @click=${() => this._emit('project-file-download', f)}>
            <wa-icon library="lucide" name="download" label=${msg('Download')}></wa-icon>
          </wa-button>
          <wa-button size="small" appearance="plain" variant="danger" title=${msg('Delete')} @click=${() => this._emit('project-file-delete', f)}>
            <wa-icon library="lucide" name="trash-2" label=${msg('Delete')}></wa-icon>
          </wa-button>
        </span>
      </li>`;
  }

  // ── 2. Properties, State ──
  @property({ attribute: false }) files: ProjectFileData[] = [];

  @state() private _dragging = false;

  // ── 4. Behaviour & Methods ──
  private _onDragOver(e: DragEvent)
  {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    this._dragging = true;
  }

  private _onDrop(e: DragEvent)
  {
    e.preventDefault();
    this._dragging = false;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) this._emit('project-files-drop', files);
  }

  private _emit<T>(name: string, detail: T)
  {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: block;
    }

    .drop {
      border: 1px dashed transparent;
      border-radius: var(--radius-md);
    }

    .drop.dragging {
      border-color: var(--color-primary);
      background: var(--color-primary-subtle);
    }

    .empty {
      margin: 0;
      padding: var(--space-xs) 0;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    ul {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-width: 0;
      padding: 2px 0;
      font-size: var(--text-xs);
    }

    li + li {
      border-top: 1px solid var(--color-border);
    }

    li > wa-icon {
      flex-shrink: 0;
      color: var(--color-text-muted);
    }

    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      flex-shrink: 0;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }

    .actions {
      display: flex;
      flex-shrink: 0;
    }

    .actions wa-button {
      font-size: var(--text-xs);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'project-files': ProjectFiles;
  }
}
