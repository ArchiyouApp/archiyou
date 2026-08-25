import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import JSON5 from 'json5';
import { templateLiteralsToJsonStrings } from './script-data-parse.js';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';
import { OVERLAY_MENU_WIDTH, OVERLAY_MENU_HEIGHT } from '@archiyou/editor/src/settings';

type ValidationState = 'idle' | 'valid' | 'invalid';

@customElement('script-importer')
export class ScriptImporter extends SignalWatcher(LitElement)
{
  override render()
  {
    if (!this.open) return nothing;

    return html`
      <div class="backdrop" @click=${this._cancel}></div>
      <div class="dialog" role="dialog" aria-modal="true"
           @click=${(e: Event) => e.stopPropagation()}>

        <div class="dialog-header">
          <wa-icon library="lucide" name="import"></wa-icon>
          <span>Import from data/JSON</span>
          <button class="close-btn" @click=${this._cancel}>
            <wa-icon library="lucide" name="x"></wa-icon>
          </button>
        </div>

        <div class="dialog-body">
          <label class="field">
            <span class="field-label">Script data</span>
            <textarea
              class="paste-input"
              .value=${this._text}
              placeholder=${`{\n  name: 'my-script',\n  code: 'box(10)'\n}\n\n// or:\nexport default { name: 'my-script', code: 'box(10)' };`}
              @input=${this._onInput}
            ></textarea>
          </label>

          <div class=${`status ${this._state}`}>
            <div class="status-row">
              <wa-icon
                library="lucide"
                name=${this._state === 'valid' ? 'circle-check' : this._state === 'invalid' ? 'circle-alert' : 'info'}
              ></wa-icon>
              <span class="status-message">${this._message}</span>
            </div>
            ${this._previewName
              ? html`<div class="preview">Imported name: <strong>${this._previewName}</strong></div>`
              : nothing}
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn-secondary" @click=${this._cancel}>Cancel</button>
          <button class="btn-primary" ?disabled=${this._validatedData === null} @click=${this._import}>
            Import
          </button>
        </div>
      </div>
    `;
  }

  @property({ type: Boolean, reflect: true }) open = false;

  @state() private _text = '';
  @state() private _state: ValidationState = 'idle';
  @state() private _message = 'Paste ScriptData as JSON, object literal, or export default module.';
  @state() private _previewName = '';

  private _validatedData: ScriptData | null = null;

  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('open') && this.open)
    {
      this._reset();
    }
  }

  private _reset()
  {
    this._text = '';
    this._state = 'idle';
    this._message = 'Paste ScriptData as JSON, object literal, or export default module.';
    this._previewName = '';
    this._validatedData = null;
  }

  private _onInput(e: InputEvent)
  {
    this._text = (e.target as HTMLTextAreaElement).value;
    this._validate();
  }

  private _validate()
  {
    const text = this._text.trim();
    this._validatedData = null;
    this._previewName = '';

    if (!text)
    {
      this._state = 'idle';
      this._message = 'Paste ScriptData as JSON, object literal, or export default module.';
      return;
    }

    try
    {
      const parsed = this._parseInput(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      {
        throw new Error('Input must evaluate to a plain object.');
      }

      // Strip `published` from old-format scripts — it often contains stale/incompatible data
      const { published: _ignored, ...cleanedParsed } = parsed as Record<string, any>;

      const script = Script.fromData(cleanedParsed as Record<string, any>);
      if (!script)
      {
        const fieldErrors = Script.diagnoseData(cleanedParsed as Record<string, any>);
        if (fieldErrors.length > 0)
        {
          throw new Error(`Invalid ScriptData:\n${fieldErrors.join('\n')}`);
        }
        throw new Error('Input is not valid ScriptData.');
      }

      this._validatedData = script.toData();
      this._previewName = script.name ?? 'untitled';
      this._state = 'valid';
      this._message = 'Valid ScriptData. Import is ready.';
    }
    catch (error)
    {
      this._state = 'invalid';
      this._message = error instanceof Error ? error.message : 'Invalid input.';
    }
  }

  private _parseInput(text: string): unknown
  {
    try
    {
      return JSON.parse(text);
    }
    catch { /* fall through */ }

    // Strip `export default` wrapper (ES module format)
    const stripped = text.replace(/^\s*export\s+default\s+/, '').replace(/;\s*$/, '');

    // Try JSON5 first (handles unquoted keys, trailing commas, etc.)
    try
    {
      return JSON5.parse(stripped);
    }
    catch { /* fall through — may contain template literals */ }

    // JSON5 cannot read backtick-delimited strings, which script exports use for
    // multi-line `code` fields. This used to fall back to
    // `new Function('return (' + text + ')')()`, i.e. arbitrary code execution on
    // whatever the user pasted — a paste-jacking vector, and the session JWT is
    // readable from localStorage. Instead, rewrite plain template literals into
    // ordinary JSON strings and let JSON5 do the parsing.
    //
    // A literal containing ${...} interpolation is refused rather than guessed at:
    // evaluating it is the one case that genuinely needs a JS engine, and is
    // exactly the case an attacker needs.
    try
    {
      return JSON5.parse(templateLiteralsToJsonStrings(stripped));
    }
    catch (error)
    {
      const message = error instanceof Error ? error.message : 'Unable to parse input.';
      throw new Error(`Could not parse as JSON or object literal: ${message}`);
    }
  }

  private _import()
  {
    if (!this._validatedData) return;

    this.dispatchEvent(new CustomEvent<ScriptData>('script-importer-import', {
      detail: this._validatedData,
      bubbles: true,
      composed: true,
    }));
  }

  private _cancel()
  {
    this.dispatchEvent(new CustomEvent('script-importer-cancel', {
      bubbles: true,
      composed: true,
    }));
  }

  static override styles = css`
    :host {
      display: contents;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 200;
    }

    .dialog {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 201;
      width: ${unsafeCSS(OVERLAY_MENU_WIDTH)};
      max-width: calc(100vw - 32px);
      max-height: ${unsafeCSS(OVERLAY_MENU_HEIGHT)};
      background: var(--color-bg-elevated, #fff);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg, 12px);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: column;
      font-family: var(--font-sans);
      overflow: hidden;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-border);
      font-weight: 500;
      font-size: var(--text-sm);
      color: var(--color-text);
      flex-shrink: 0;
    }

    .close-btn {
      margin-left: auto;
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-gray-dark, #666);
      border-radius: var(--radius-sm, 4px);
    }

    .close-btn:hover {
      background: color-mix(in srgb, var(--color-border) 40%, transparent);
    }

    .dialog-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field-label {
      font-size: var(--text-sm);
      font-weight: 500;
      color: var(--color-text-muted);
    }

    .paste-input {
      width: 100%;
      box-sizing: border-box;
      display: block;
      min-height: 260px;
      resize: vertical;
      font-family: var(--font-mono, monospace);
      font-size: var(--text-sm);
      line-height: 1.45;
      color: var(--color-text);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm, 4px);
      padding: 10px 12px;
      outline: none;
    }

    .paste-input:focus {
      border-color: var(--color-primary);
    }

    .status {
      display: flex;
      flex-direction: column;
      flex: 0 0 auto;
      gap: 6px;
      padding: 10px 12px;
      border-radius: var(--radius-sm, 4px);
      border: 1px solid var(--color-border);
      background: var(--color-bg);
      font-size: var(--text-sm);
      color: var(--color-text);
    }

    .status-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .status-message {
      font-size: var(--text-sm);
      white-space: pre-line;
      line-height: 1.5;
    }

    .status.valid {
      border-color: color-mix(in srgb, #22c55e 40%, var(--color-border));
      background: color-mix(in srgb, #22c55e 8%, transparent);
    }

    .status.invalid {
      border-color: color-mix(in srgb, #ef4444 40%, var(--color-border));
      background: color-mix(in srgb, #ef4444 8%, transparent);
    }

    .preview {
      color: var(--color-text-muted);
      padding-left: 26px;
    }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .btn-primary,
    .btn-secondary {
      padding: 7px 16px;
      border-radius: var(--radius-sm, 4px);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: 500;
      cursor: pointer;
      border: none;
    }

    .btn-primary {
      background: var(--color-primary);
      color: var(--color-white, #fff);
    }

    .btn-primary:hover:not(:disabled) {
      opacity: 0.88;
    }

    .btn-primary:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .btn-secondary {
      background: transparent;
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-secondary:hover {
      background: color-mix(in srgb, var(--color-border) 30%, transparent);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'script-importer': ScriptImporter;
  }
}