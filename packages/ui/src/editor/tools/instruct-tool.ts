import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg } from '@lit/localize';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';

import { executionResult } from '@archiyou/editor/src/state/workspace';
import {
  instructAvailable, instructName, instructStep,
  setInstructStep, clearInstructStep,
} from '@archiyou/editor/src/state/viewer';
import type { InstructDoc, InstructStep } from '../../viewer/instruct-playback.js';
import { capCentreShiftPx } from '../../cap-centring.js';

/**
 *  editor-instruct-tool
 *
 *  Walks an instructable (docs.instruct in a script) step by step in the 3D viewer, and shows
 *  what each step says: its parts, its note, its tools and hardware.
 *
 *  The viewer owns the scene work — hiding, ghosting, framing, sliding parts into place — and
 *  exposes it as an API. This is only a driver: it writes the step index to a signal and
 *  renders the step's own text. That split is why the viewer has no instruct buttons of its
 *  own, and why a configurator could drive the same API with completely different controls.
 */
@customElement('editor-instruct-tool')
export class EditorInstructTool extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    const available = instructAvailable.get();

    if (!executionResult.get())
    {
      return this._renderEmpty('list-ordered', msg('Run the script to see instructions'));
    }
    if (available.length === 0)
    {
      return this._renderEmpty('list-ordered',
        msg('No instructables in this script. Make one with docs.instruct().'));
    }

    const doc = this._activeDoc();
    if (!doc) { return this._renderEmpty('list-ordered', msg('Instructable not found')); }

    const index = instructStep.get();
    const step = doc.steps[index];

    /*  Two states, and they share almost nothing: before you start you are reading a contents
        page, and once you have you are following one instruction. Which is why the header and
        the step controls live inside each state rather than above both. */
    return html`
      <div class="instruct">
        ${step ? this._renderStep(doc, step, index) : this._renderIdle(doc, available)}
      </div>
    `;
  }

  /** Before anything is picked: what this thing is, what it is made of, and what it takes. */
  private _renderIdle(doc: InstructDoc, available: Array<{ name: string; steps: number }>)
  {
    return html`
      ${available.length > 1
        ? html`
          <wa-select size="small" value=${doc.name} @change=${this._selectDoc}>
            ${available.map(a => html`<wa-option value=${a.name}>${a.name}</wa-option>`)}
          </wa-select>`
        : html`<h3 class="title">${doc.title || doc.name}</h3>`}

      ${doc.parts.length ? html`
        <section>
          <h5>${msg('Parts')}</h5>
          ${this._renderParts(doc.parts)}
        </section>` : ''}

      <section>
        <h5>${doc.steps.length} ${msg('steps')}</h5>
        <ol class="overview">
          ${doc.steps.map((s, i) => html`
            <li @click=${() => setInstructStep(doc.name, i)}>
              <span class="num"><span>${i + 1}</span></span>
              <span class="step-name">${s.title}</span>
            </li>
          `)}
        </ol>
      </section>

      <wa-button class="start" size="small" variant="brand" @click=${this._start}>
        <wa-icon slot="prefix" library="lucide" name="play"></wa-icon>
        ${msg('Start')}
      </wa-button>
    `;
  }

  /** One step: where you are, what to do, and what it takes to do it. */
  private _renderStep(doc: InstructDoc, step: InstructStep, index: number)
  {
    const parts = step.uses
      .map(label => doc.parts.find(p => p.label === label))
      .filter(Boolean) as InstructDoc['parts'];

    return html`
      <div class="controls">
        <wa-button class="arrow" size="small" ?disabled=${index <= 0}
                   @click=${this._prev} title=${msg('Previous step')}>
          <wa-icon library="lucide" name="chevron-left"></wa-icon>
        </wa-button>

        <div class="current">
          <span class="num"><span>${step.number}</span></span>
          <span class="step-name">${step.title}</span>
        </div>

        <wa-button class="arrow" size="small" ?disabled=${index >= doc.steps.length - 1}
                   @click=${this._next} title=${msg('Next step')}>
          <wa-icon library="lucide" name="chevron-right"></wa-icon>
        </wa-button>
      </div>

      ${step.note ? html`<p class="note">${step.note}</p>` : ''}

      ${parts.length ? html`
        <section>
          <h5>${msg('Parts')}</h5>
          ${this._renderParts(parts, doc, step)}
        </section>` : ''}

      ${step.hardware?.length ? html`
        <section>
          <h5>${msg('Hardware')}</h5>
          <ul class="plain">
            ${step.hardware.map(h => html`<li>${h.quantity}x ${h.name}</li>`)}
          </ul>
        </section>` : ''}

      ${step.tools?.length ? html`
        <section>
          <h5>${msg('Tools')}</h5>
          <ul class="plain">${step.tools.map(t => html`<li>${t}</li>`)}</ul>
        </section>` : ''}

      <wa-button class="back" size="small" appearance="plain" @click=${this._reset}>
        ${msg('Back to main model')}
      </wa-button>
    `;
  }

  /** The part rows, the same in the contents page and in a step — label, what it is, how big,
   *  how many. Highlighted when a step is passed and the part is what it is about. */
  private _renderParts(parts: InstructDoc['parts'], doc?: InstructDoc, step?: InstructStep)
  {
    return html`
      <ul class="parts-list ${step ? 'compact' : ''}">
        ${parts.map(p => html`
          <li class=${(doc && step && step.subject.length && this._isSubject(doc, step, p.label))
                        ? 'subject' : ''}>
            <span class="label">${p.label}</span>
            <span class="name">${p.name}</span>
            <span class="dims">${p.section} · ${p.length}</span>
            <span class="qty">x${p.quantity}</span>
          </li>
        `)}
      </ul>
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
  @state() private _selected: string | null = null;

  // ── 3. Lifecycle ──
  override updated()
  {
    /*  The step badges are circled numerals, and a browser centres a line box rather than the
        digits in it — so without this they sit about a pixel low in their circle. Measured, not
        assumed; see cap-centring.ts, and note the printed manual centres the same badge the
        same way (core/annotator/svgPrimitives.ts). */
    const num = this.renderRoot.querySelector<HTMLElement>('.num');
    if (num) { this.style.setProperty('--ay-cap-shift', `${capCentreShiftPx(num).toFixed(3)}px`); }
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    // Closing the tool puts the model back — a half-assembled scene left behind would look
    // like a broken script rather than a closed panel.
    clearInstructStep();
  }

  // ── 4. Behaviour & Methods ──

  /** The instructable being shown: the one picked, else the one playing, else the first. */
  private _activeDoc(): InstructDoc | null
  {
    const docs = (executionResult.get()?.state?.instruct ?? []) as InstructDoc[];
    if (docs.length === 0) return null;

    const wanted = this._selected ?? instructName.get();
    return docs.find(d => d.name === wanted) ?? docs[0];
  }

  /** Whether a part is what this step is about, rather than the context around it. */
  private _isSubject(doc: InstructDoc, step: InstructStep, label: string): boolean
  {
    const part = doc.parts.find(p => p.label === label);
    return !!part && part.paths.some(path => step.subject.includes(path));
  }

  private _selectDoc = (e: Event) =>
  {
    this._selected = (e.target as HTMLInputElement).value;
    setInstructStep(this._selected, 0);
  };

  private _start = () =>
  {
    const doc = this._activeDoc();
    if (doc) setInstructStep(doc.name, 0);
  };

  private _next = () =>
  {
    const doc = this._activeDoc();
    if (doc) setInstructStep(doc.name, Math.min(instructStep.get() + 1, doc.steps.length - 1));
  };

  private _prev = () =>
  {
    const doc = this._activeDoc();
    if (doc) setInstructStep(doc.name, Math.max(instructStep.get() - 1, 0));
  };

  private _reset = () => clearInstructStep();

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      height: 100%;
      overflow-y: auto;
      font-family: var(--font-sans);
      color: var(--color-text);
    }

    *, *::before, *::after { box-sizing: inherit; }

    /* NOTE: --space-lg, not --space-4. The token scale is xs/sm/md/lg/xl (styles/design-tokens.ts);
       an undefined custom property makes the whole declaration invalid, which is how this panel
       came to have no padding at all. Same story behind --text-md and --color-brand below. */
    .instruct {
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
      padding: var(--space-lg);
    }

    /* ── The contents page ── */

    .title {
      margin: 0;
      text-align: center;
      font-size: var(--text-base);
      font-weight: 400;
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

    .overview { display: flex; flex-direction: column; gap: 2px; font-size: var(--text-sm); }
    .overview li {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: 2px 0;
      cursor: pointer;
    }
    .overview li:hover { color: var(--color-primary); }
    .overview li:hover .num { border-color: var(--color-primary); }

    .start {
      align-self: center;
      margin-top: var(--space-xs);
    }
    .start::part(base) {
      background-color: var(--color-primary);
      border-color: var(--color-primary);
      color: var(--color-white, #fff);
    }

    /* ── One step ── */

    .controls { display: flex; align-items: center; gap: var(--space-sm); }

    /*  Small buttons, full-size arrows: the chevron keeps its own font-size and the box around
        it shrinks to a square that does not compete with the step title. */
    .arrow::part(base) {
      width: 1.75rem;
      height: 1.75rem;
      min-height: 0;
      padding: 0;
      background-color: var(--color-gray);
      border-color: transparent;
      color: var(--color-text);
    }
    .arrow::part(base):hover { background-color: var(--color-gray-light); }
    .arrow[disabled]::part(base) { opacity: .4; }

    /* the step title wraps to two lines and the circled number stays beside it */
    .current {
      flex: 1;
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-width: 0;
    }
    .current .step-name {
      font-size: var(--text-sm);
      font-weight: 600;
      line-height: 1.3;
    }

    /** The step number, circled — the same badge in the contents page and beside the step. */
    .num {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full);
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
      /* the digits, not their line box, go in the middle — see updated() */
      text-indent: 0;
    }
    .num > span {
      display: block;
      transform: translateY(var(--ay-cap-shift, 0px));
    }

    .note { margin: 0; font-size: var(--text-sm); line-height: 1.5; }

    .back {
      align-self: center;
      margin-top: var(--space-xs);
    }
    .back::part(base) {
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }
    .back::part(base):hover { color: var(--color-primary); }

    /* ── Lists ── */

    ul, ol { list-style: none; margin: 0; padding: 0; }
    ul.plain li { font-size: var(--text-sm); padding: 1px 0; }

    .parts-list li {
      display: grid;
      grid-template-columns: 1.6em 1fr auto auto;
      gap: var(--space-xs);
      align-items: baseline;
      font-size: var(--text-xs);
      padding: 1px 0;
    }
    .parts-list .label { font-weight: 700; }
    .parts-list .dims, .parts-list .qty { color: var(--color-text-muted); }
    .parts-list li.subject .label,
    .parts-list li.subject .name { color: var(--color-primary); font-weight: 600; }

    /*  In a step the part list is reference beside the instruction, so it gives way to it: a
        size down and, apart from the part the step is about, a tone down. On the contents page
        the same list IS the content and stays at full strength. */
    .parts-list.compact li { color: var(--color-text-muted); }
    .parts-list.compact .label { color: var(--color-text); }

    .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: var(--space-sm);
      height: 100%;
      padding: var(--space-lg);
      text-align: center;
      color: var(--color-text-muted);
      font-size: var(--text-sm);
    }
    .empty wa-icon { font-size: 2rem; opacity: .5; }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-instruct-tool': EditorInstructTool;
  }
}
