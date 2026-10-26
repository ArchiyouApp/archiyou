import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg, str } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/slider/slider.js';
import '@awesome.me/webawesome/dist/components/switch/switch.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';

import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';

import { executionResult, editorScript, isReadOnly, bakeAnimations, pipelineModelPath } from '@archiyou/editor/src/state/workspace';
import {
  animationsBaked, animationStatus, sendAnimationCommand,
  type AnimationLoopMode, type BakedAnimation,
} from '@archiyou/editor/src/state/viewer';
import { getOutput } from '@archiyou/core/src/runner/worker/output';
// the table and the code only: no animator, no kernel, on the main thread
import { PRESETS, PRESET_KINDS } from '@archiyou/core/src/animator/standard';
import {
  animationsInCode, appendAnimation, exampleCode, isAnimationName, newAnimationCode, removeAnimation,
  renameAnimation, uniqueName, variableFor, type AnimationCode,
} from '@archiyou/core/src/animator/code';
import type { AnimationInfo, PresetKind } from '@archiyou/core/src/animator/types';
import { chapterAt } from '../../viewer/animation-playback.js';
import { codeTheme } from '../codebox.js';

/** One animation of the script: what the code says, and what the last run made of it. */
interface AnimationRow
{
  name: string;
  title?: string;
  duration?: number;
  loop?: AnimationLoopMode;
  /** A parameter sweep: made from one run per frame, which this tool does not do yet. */
  sweep: boolean;
  /** Where it is in the code. Missing when the code does not name it in so many words (a
   *  computed name), or does not parse right now. */
  code?: AnimationCode;
}

type AddKind = PresetKind | 'new';

const SPEEDS = [0.25, 0.5, 1, 2];

const LOOP_MODES: Array<{ mode: AnimationLoopMode, icon: string, label: () => string }> = [
  { mode: 'none', icon: 'arrow-right-to-line', label: () => msg('Play once') },
  { mode: 'loop', icon: 'repeat', label: () => msg('Loop') },
  { mode: 'pingpong', icon: 'arrow-left-right', label: () => msg('Back and forth') },
];

/**
 *  editor-animation-tool
 *
 *  The animations of the script. Add a standard one, written out in full as an example, or a new
 *  one of your own, and its code goes at the end of the script (animator/code.ts writes it);
 *  rename or delete one, and its code changes with it. The selected one plays in the viewer: play, scrub, loop, speed, its camera,
 *  its chapters, and its code to read.
 *
 *  While the tool is open the editor bakes the script's animations into the model it shows
 *  (bakeAnimations); closed, it bakes none, so a script runs as fast as without them. Like the
 *  instruct tool it holds no scene logic: it writes signals, and the viewer plays (model-viewer,
 *  ANIMATIONS). Code edits go to the page as `script-edit`, which runs them.
 *
 *  Loaded on first open (see the editor's TOOLS), so the editor bundle does not carry it.
 */
@customElement('editor-animation-tool')
export class EditorAnimationTool extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    if (!executionResult.get())
    {
      return this._renderEmpty('clapperboard', msg('Run the script to animate it'));
    }

    const rows = this._rows();
    const selected = rows.find(r => r.name === this._selectedName(rows));
    const baked = new Map(animationsBaked.get().map(a => [a.name, a]));
    const editable = !isReadOnly.get();

    return html`
      <div class="toolbar">
        <span class="spacer"></span>
        <wa-button appearance="plain" ?disabled=${!baked.size}
                   title=${msg('Download the GLB with its animations')} @click=${this._download}>
          <wa-icon library="lucide" name="download" label=${msg('Download the GLB with its animations')}></wa-icon>
        </wa-button>
      </div>

      <div class="animation">
        <section class="intro">
          <p class="lead">${msg('Manage the animations of this model.')}</p>
          ${editable ? this._renderAdd(rows) : nothing}
        </section>

        <section>
          <h5>${msg('Animations')}</h5>
          ${rows.length
            ? html`<ul class="rows">${rows.map(row => this._renderRow(row, row === selected, baked.get(row.name), editable))}</ul>`
            : html`<p class="hint none">${msg('None yet.')}</p>`}
        </section>

        ${selected ? this._renderSelected(selected, baked.get(selected.name)) : nothing}
      </div>
    `;
  }

  /** Add a standard one, or a new one of your own. */
  private _renderAdd(rows: AnimationRow[])
  {
    const hasInstruct = this._hasInstruct();
    const kind = this._kindToAdd();
    const about = (kind === 'new')
      ? msg('Keys of your own: poses of parts at the times you choose.')
      : PRESETS[kind].description;

    return html`
      <p class="hint">
        ${msg('Add a standard animation as an example to start from, or a new one of your own. Its code goes at the end of the script: change it there, and the animation follows.')}
      </p>
      <div class="add">
        <wa-select class="kind" size="small" .value=${kind}
                   @change=${(e: Event) => { this._addKind = (e.target as HTMLSelectElement).value as AddKind; }}>
          ${PRESET_KINDS.map(k => html`
            <wa-option value=${k} ?disabled=${k === 'assembly' && !hasInstruct}>${PRESETS[k].title}</wa-option>`)}
          <wa-option value="new">${msg('New animation')}</wa-option>
        </wa-select>
        <wa-button size="small" variant="brand" @click=${() => this._add(kind, rows)}>
          <wa-icon slot="start" library="lucide" name="plus"></wa-icon>
          ${msg('Add')}
        </wa-button>
      </div>
      <p class="hint">${about}</p>
    `;
  }

  private _renderRow(row: AnimationRow, isSelected: boolean, carried: BakedAnimation | undefined, editable: boolean)
  {
    const duration = carried?.duration ?? row.duration;
    const renaming = this._renaming === row.name;
    const unreadable = row.code ? undefined : msg('Its code does not name it in so many words: change it in the script');

    return html`
      <li class=${isSelected ? 'picked' : ''}>
        ${renaming ? html`
          <div class="rename">
            <wa-input size="small" .value=${this._renameValue} autofocus
                      @input=${(e: Event) => { this._renameValue = String((e.target as HTMLInputElement).value ?? ''); this._renameError = ''; }}
                      @keydown=${(e: KeyboardEvent) => this._renameKey(e, row)}
                      @blur=${() => this._commitRename(row)}></wa-input>
            ${this._renameError ? html`<span class="error">${this._renameError}</span>` : nothing}
          </div>` : html`
          <button class="name" @click=${() => this._select(row.name)}>
            <span class="title">${row.name}</span>
            <span class="meta">
              ${[row.title, duration ? `${duration.toFixed(1)} s` : '', row.sweep ? msg('parameter sweep') : ''].filter(Boolean).join(' · ')}
            </span>
          </button>`}
        ${editable && !renaming ? html`
          <wa-button class="icon" size="small" appearance="plain" ?disabled=${!row.code}
                     title=${unreadable ?? msg('Rename')} @click=${() => this._startRename(row)}>
            <wa-icon library="lucide" name="pencil" label=${msg('Rename')}></wa-icon>
          </wa-button>
          <wa-button class="icon" size="small" appearance="plain" ?disabled=${!row.code?.removable}
                     title=${row.code?.removable ? msg('Delete it and its code')
                       : (unreadable ?? msg('Its code is part of a larger statement: delete it in the script'))}
                     @click=${() => this._remove(row)}>
            <wa-icon library="lucide" name="trash-2" label=${msg('Delete')}></wa-icon>
          </wa-button>` : nothing}
      </li>
    `;
  }

  /** The selected animation: the transport of the viewer, then its code. */
  private _renderSelected(row: AnimationRow, carried: BakedAnimation | undefined)
  {
    const status = animationStatus.get();
    const loaded = status.name === row.name;
    const duration = loaded ? status.duration : (carried?.duration ?? row.duration ?? 0);
    const time = loaded ? status.time : 0;
    const loop = loaded ? status.loop : (this._loop ?? carried?.loop ?? row.loop ?? 'none');
    const speed = loaded ? status.speed : this._speed;
    const playing = loaded && status.playing;
    const chapters = carried?.chapters ?? [];
    const current = loaded ? chapterAt(chapters, time) : -1;

    return html`
      <section class="selected">
        <h5>${msg('Selected animation')}: <span class="selected-name">${row.name}</span></h5>

        <div class="player">
          <wa-button class="icon" size="small" variant="brand" title=${msg('Stop')} ?disabled=${!loaded} @click=${this._stop}>
            <wa-icon library="lucide" name="square" label=${msg('Stop')}></wa-icon>
          </wa-button>
          <wa-button class="icon" size="small" variant="brand" ?disabled=${row.sweep || !carried}
                     title=${playing ? msg('Pause') : msg('Play')} @click=${() => this._togglePlay(row)}>
            <wa-icon library="lucide" name=${playing ? 'pause' : 'play'} label=${playing ? msg('Pause') : msg('Play')}></wa-icon>
          </wa-button>
          <wa-slider class="scrubber" size="small" min="0" max=${duration || 1} step="0.01" ?disabled=${!carried}
                     .value=${time} @input=${(e: Event) => this._scrub(row, Number((e.target as HTMLInputElement).value))}></wa-slider>
          <span class="time">${time.toFixed(1)} / ${duration.toFixed(1)} s</span>
        </div>

        <div class="options">
          <span class="loops">
            ${LOOP_MODES.map(m => html`
              <wa-button class="icon" size="small" appearance=${m.mode === loop ? 'filled' : 'plain'}
                         variant=${m.mode === loop ? 'brand' : 'neutral'} title=${m.label()}
                         @click=${() => this._setLoop(row, m.mode)}>
                <wa-icon library="lucide" name=${m.icon} label=${m.label()}></wa-icon>
              </wa-button>`)}
          </span>

          <wa-dropdown class="speed" placement="bottom-end" hoist
                       @wa-select=${(e: CustomEvent) => this._setSpeed(row, Number((e.detail.item as { value: string }).value))}>
            <wa-button slot="trigger" class="speed-button" size="small" appearance="plain" title=${msg(str`Speed ${speed}×`)}>
              <wa-icon slot="start" library="lucide" name="gauge"></wa-icon>
              ${speed}×
            </wa-button>
            ${SPEEDS.map(s => html`<wa-dropdown-item type="checkbox" value=${String(s)} ?checked=${s === speed}>${s}×</wa-dropdown-item>`)}
          </wa-dropdown>

          ${carried?.camera ? html`
            <wa-switch class="follow" size="small" .checked=${loaded ? status.follow : this._follow} @change=${this._setFollow}>
              ${msg('Look through its camera')}
            </wa-switch>` : nothing}
        </div>

        ${row.sweep
          ? html`<p class="hint">${msg('A parameter sweep is made from a run per frame, which the editor does not play yet.')}</p>`
          : !carried ? html`<p class="hint">${msg('Not in the model yet: the next run makes it.')}</p>` : nothing}

        ${chapters.length ? html`
          <ol class="chapters">
            ${chapters.map((c, i) => html`
              <li class=${i === current ? 'current' : ''} @click=${() => this._scrub(row, c.tStart)}>
                <span class="num">${i + 1}</span><span>${c.title}</span>
              </li>`)}
          </ol>` : nothing}

        <div class="code">
          <button class="code-toggle" @click=${() => { this._showCode = !this._showCode; }}>
            <wa-icon library="lucide" name=${this._showCode ? 'chevron-down' : 'chevron-right'}></wa-icon>
            <wa-icon library="lucide" name="code"></wa-icon>
            ${this._showCode ? msg('Hide code') : msg('Show code')}
          </button>
          ${this._showCode
            ? (row.code
              ? html`<div class="code-view"></div>`
              : html`<p class="hint">${msg('Its code does not name it in so many words: look for it in the script.')}</p>`)
            : nothing}
        </div>
      </section>
    `;
  }

  private _renderEmpty(icon: string, text: string)
  {
    return html`
      <div class="empty">
        <wa-icon library="lucide" name=${icon}></wa-icon>
        <span>${text}</span>
      </div>
    `;
  }

  // ── 2. State ──
  /** The animation in the player: the one picked, else the one playing, else the first. */
  @state() private _selected: string | null = null;
  @state() private _addKind: AddKind = 'flyin';
  /** The row whose name is being edited, and what it says so far. */
  @state() private _renaming: string | null = null;
  @state() private _renameValue = '';
  @state() private _renameError = '';
  @state() private _showCode = true;
  /** How the next play goes: the animation's own loop until one is picked. */
  @state() private _loop: AnimationLoopMode | null = null;
  @state() private _speed = 1;
  /** An animation with a camera of its own (a turntable) is seen through it, until switched off. */
  @state() private _follow = true;

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    // the model the editor shows carries the script's animations while this is open
    bakeAnimations.set(true);
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    // Closing the tool puts the model back, and the next run bakes no animations
    sendAnimationCommand({ action: 'stop' });
    bakeAnimations.set(false);
    this._codeView?.destroy();
    this._codeView = null;
    this._codeKey = '';
  }

  override updated()
  {
    // wa-select can miss a value set before its options are there (first paint)
    const select = this.shadowRoot?.querySelector<HTMLElement & { value: string }>('.kind');
    if (select && select.value !== this._kindToAdd()) select.value = this._kindToAdd();
    this._updateCodeView();
  }

  // ── 4. Behaviour & Methods ──
  private _codeView: EditorView | null = null;
  private _codeKey = '';
  private _parsedFor: string | null = null;
  private _parsed: AnimationCode[] | null = null;

  /** The animations of the code in its order, with what the last run made of them; then the
   *  ones the run declared that the code does not name in so many words. */
  private _rows(): AnimationRow[]
  {
    const infos = ((executionResult.get()?.state as any)?.animations ?? []) as AnimationInfo[];
    const info = new Map(infos.map(a => [a.name, a]));
    const inCode = this._animationsInCode() ?? [];
    const named = new Set(inCode.map(a => a.name));

    const row = (name: string, code?: AnimationCode): AnimationRow =>
    {
      const a = info.get(name);
      return { name, title: a?.title, duration: a?.duration, loop: a?.loop, sweep: !!a?.params, code };
    };

    return [
      ...inCode.map(c => row(c.name, c)),
      ...infos.filter(a => !named.has(a.name)).map(a => row(a.name)),
    ];
  }

  private _hasInstruct(): boolean
  {
    return !!((executionResult.get()?.state as any)?.instruct?.length);
  }

  /** What Add adds: the pick, but no assembly without an instructable to play. */
  private _kindToAdd(): AddKind
  {
    return (this._addKind === 'assembly' && !this._hasInstruct()) ? 'flyin' : this._addKind;
  }

  /** The animations in the code as it is now, parsed once per change. */
  private _animationsInCode(): AnimationCode[] | null
  {
    const code = editorScript.get()?.code ?? '';
    if (code !== this._parsedFor)
    {
      this._parsedFor = code;
      this._parsed = animationsInCode(code);
    }
    return this._parsed;
  }

  private _selectedName(rows: AnimationRow[]): string | null
  {
    const names = rows.map(r => r.name);
    return [this._selected, animationStatus.get().name, names[0]].find(n => n && names.includes(n)) ?? null;
  }

  private _select(name: string)
  {
    // the player is the selected one's: another one playing goes back to the model
    const loaded = animationStatus.get().name;
    if (loaded && loaded !== name) sendAnimationCommand({ action: 'stop' });
    this._selected = name;
    this._loop = null;
  }

  /** The script with this code instead, to the page, which runs it. */
  private _editScript(code: string)
  {
    if (code === (editorScript.get()?.code ?? '')) return;
    this.dispatchEvent(new CustomEvent<{ code: string }>('script-edit', {
      detail: { code }, bubbles: true, composed: true,
    }));
  }

  /** Add it at the end of the script, select it, and play it as soon as the run brings it. */
  private _add(kind: AddKind, rows: AnimationRow[])
  {
    const code = editorScript.get()?.code ?? '';
    const name = uniqueName(kind === 'new' ? 'animation' : kind, rows.map(r => r.name));
    const variable = variableFor(name, code);
    const snippet = (kind === 'new') ? newAnimationCode(name, variable) : exampleCode(kind, name, variable);

    this._select(name);
    this._editScript(appendAnimation(code, snippet));
    this._play(name);
  }

  private _remove(row: AnimationRow)
  {
    if (!row.code?.removable) return;
    if (animationStatus.get().name === row.name) sendAnimationCommand({ action: 'stop' });
    if (this._selected === row.name) this._selected = null;
    this._editScript(removeAnimation(editorScript.get()?.code ?? '', row.code));
  }

  private _startRename(row: AnimationRow)
  {
    this._renaming = row.name;
    this._renameValue = row.name;
    this._renameError = '';
  }

  private _renameKey(e: KeyboardEvent, row: AnimationRow)
  {
    if (e.key === 'Enter') { e.preventDefault(); this._commitRename(row); }
    if (e.key === 'Escape') { e.preventDefault(); this._renaming = null; }
  }

  private _commitRename(row: AnimationRow)
  {
    if (this._renaming !== row.name) return;
    const name = this._renameValue.trim();
    if (name === row.name || !row.code) { this._renaming = null; return; }

    if (!isAnimationName(name))
    {
      this._renameError = msg('Letters, digits, - and _ only.');
      return;
    }
    if (this._rows().some(r => r.name === name))
    {
      this._renameError = msg(str`There is an animation called ${name} already.`);
      return;
    }

    // the clip gets the new name on the next run: the old one goes back to the model
    if (animationStatus.get().name === row.name) sendAnimationCommand({ action: 'stop' });
    this._renaming = null;
    this._selected = name;
    this._editScript(renameAnimation(editorScript.get()?.code ?? '', row.code, name));
  }

  /** Play the selected one, from the start when it ended; pause and resume the one playing. */
  private _togglePlay(row: AnimationRow)
  {
    const status = animationStatus.get();
    const ended = !status.playing && status.duration > 0 && status.time >= status.duration - 1e-3;
    if (status.name === row.name && !ended)
    {
      sendAnimationCommand({ action: status.playing ? 'pause' : 'resume' });
      return;
    }
    this._play(row.name);
  }

  private _play(name: string, from?: number)
  {
    sendAnimationCommand({
      action: 'play', name, speed: this._speed, follow: this._follow,
      ...(this._loop ? { loop: this._loop } : {}),
      ...(from !== undefined ? { t: from } : {}),
    });
  }

  private _stop = () => sendAnimationCommand({ action: 'stop' });

  /** Go to `t` and hold there: in the one loaded, or in the selected one, loaded there. */
  private _scrub(row: AnimationRow, t: number)
  {
    const status = animationStatus.get();
    if (status.name !== row.name)
    {
      this._play(row.name, t);
      sendAnimationCommand({ action: 'pause' });
      return;
    }
    if (status.playing) sendAnimationCommand({ action: 'pause' });
    sendAnimationCommand({ action: 'seek', t });
  }

  private _setLoop(row: AnimationRow, loop: AnimationLoopMode)
  {
    this._loop = loop;
    if (animationStatus.get().name === row.name) sendAnimationCommand({ action: 'options', loop });
  }

  private _setSpeed(row: AnimationRow, speed: number)
  {
    if (!(speed > 0)) return;
    this._speed = speed;
    if (animationStatus.get().name === row.name) sendAnimationCommand({ action: 'options', speed });
  }

  private _setFollow = (e: Event) =>
  {
    this._follow = (e.target as HTMLInputElement).checked;
    if (animationStatus.get().name) sendAnimationCommand({ action: 'options', follow: this._follow });
  };

  /** The selected one's code, read-only, coloured as the code box colours it. */
  private _updateCodeView()
  {
    const host = this.shadowRoot?.querySelector<HTMLElement>('.code-view');
    const rows = host ? this._rows() : [];
    const code = rows.find(r => r.name === this._selectedName(rows))?.code?.code;
    if (!host || code === undefined)
    {
      this._codeView?.destroy();
      this._codeView = null;
      this._codeKey = '';
      return;
    }

    const key = `${document.documentElement.dataset['theme'] ?? ''}|${code}`;
    if (key === this._codeKey && this._codeView?.dom.parentElement === host) return;
    this._codeKey = key;

    this._codeView?.destroy();
    this._codeView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: code,
        extensions: [javascript(), codeTheme(), EditorView.lineWrapping, EditorState.readOnly.of(true), EditorView.editable.of(false)],
      }),
    });
  }

  /** The GLB the viewer shows, animations and all, straight from the last run. */
  private _download = () =>
  {
    const result = executionResult.get();
    const glb = result ? getOutput(result, pipelineModelPath('default')) : undefined;
    if (!(glb instanceof ArrayBuffer) && !(glb instanceof Uint8Array)) return;

    const url = URL.createObjectURL(new Blob([glb as BlobPart], { type: 'model/gltf-binary' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editorScript.get()?.name || 'model'}.glb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ── 5. Styles ──
  static override styles = css`
    :host {
      /* buttons in the primary colour, as the editor's own buttons have it (Web Awesome's
         theme fills them with brand-50, which the design tokens make the dark primary) */
      --wa-color-brand-fill-loud: var(--color-primary);
      --wa-color-brand-on-loud: var(--color-on-primary);

      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      height: 100%;
      font-family: var(--font-sans);
      color: var(--color-text);
    }

    *, *::before, *::after { box-sizing: inherit; }

    /* ── The subheader, as the documents tool has it ── */

    /* padded as the panel header, so its buttons sit under the close button */
    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: 0 var(--space-md);
      background: var(--color-gray-light);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .spacer { flex: 1; }

    .animation {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
      padding: var(--space-lg);
    }

    h5 {
      margin: 0 0 var(--space-xs);
      text-align: center;
      font-size: var(--text-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .04em;
      color: var(--color-text-muted);
    }
    .selected-name {
      text-transform: none;
      letter-spacing: normal;
      font-family: var(--font-mono);
      color: var(--color-primary);
    }

    p { margin: 0; }
    .lead { font-size: var(--text-sm); font-weight: 600; }
    .hint { font-size: var(--text-xs); color: var(--color-text-muted); }
    .none { text-align: center; }

    ul, ol { list-style: none; margin: 0; padding: 0; }

    .icon::part(base) {
      width: 1.75rem;
      height: 1.75rem;
      min-height: 0;
      padding: 0;
    }

    /* ── Adding ── */

    .intro { display: flex; flex-direction: column; gap: var(--space-sm); }
    .add { display: flex; align-items: center; gap: var(--space-sm); }
    .add .kind { flex: 1; min-width: 0; }

    /* ── The list ── */

    .rows li {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding: 2px var(--space-xs);
      border-radius: var(--radius-sm);
    }
    .rows li.picked { background: var(--color-primary-subtle); }
    .rows li.picked .title { color: var(--color-primary); }

    .name {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      padding: 0;
      border: none;
      background: none;
      text-align: left;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    .name:hover .title { color: var(--color-primary); }
    .title { font-size: var(--text-sm); font-family: var(--font-mono); }
    .meta { font-size: var(--text-xs); color: var(--color-text-muted); }

    .rename { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .error { font-size: var(--text-xs); color: var(--color-danger); }

    /* ── The selected one ── */

    .selected {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      padding-top: var(--space-sm);
      border-top: 1px solid var(--color-border);
    }

    .player, .options {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }
    .options { flex-wrap: wrap; }
    .scrubber {
      flex: 1;
      min-width: 4rem;
      margin-left: var(--space-md);
      --wa-form-control-activated-color: var(--color-primary);
    }
    .time {
      flex: none;
      margin: 0 var(--space-xs);
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
      color: var(--color-text-muted);
    }
    .loops { display: flex; gap: 2px; }
    .speed-button::part(base) {
      height: 1.75rem;
      min-height: 0;
      padding: 0 var(--space-xs);
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
    }
    .speed::part(menu) { background-color: var(--color-bg-elevated); }
    .speed wa-dropdown-item { font-size: var(--text-xs); }

    .follow {
      margin-left: auto;
      --wa-form-control-activated-color: var(--color-secondary);
    }
    .follow::part(label) { font-size: var(--text-xs); }

    .chapters li {
      display: flex;
      gap: var(--space-sm);
      padding: 1px 0;
      font-size: var(--text-sm);
      cursor: pointer;
    }
    .chapters li:hover, .chapters li.current { color: var(--color-primary); }
    .chapters .num {
      flex: none;
      width: 1.5em;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--color-text-muted);
    }

    /* ── Its code ── */

    .code { display: flex; flex-direction: column; gap: var(--space-xs); }
    .code-toggle {
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
      cursor: pointer;
    }
    .code-toggle:hover { color: var(--color-primary); }
    .code-view {
      overflow: hidden;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-bg-code);
      font-size: var(--text-xs);
    }
    .code-view .cm-editor { background: transparent; }
    .code-view .cm-scroller { font-family: var(--font-mono); }

    /* ── Empty ── */

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      height: 100%;
      padding: var(--space-lg);
      text-align: center;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
    .empty wa-icon { font-size: 1.5rem; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-animation-tool': EditorAnimationTool;
  }
}
