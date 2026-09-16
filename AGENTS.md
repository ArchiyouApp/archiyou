# Agent guide lines

## General coding style

* We prefer Allman style symmetrical braces. Please in this way always
* Please avoid for(..) and while(...) loops if you can also use a .map/reduce() loop. 

## Lit components

Please make sure you follow these standards for Lit components. This includes pages (src/pages), components (src/components), apps (src/apps) and layouts (src/layouts):

### Always order the Lit components this way

1. First the render function
2. Then the logic in this order: (@state(), @property(), @provide(), @consume() and signals (coming from src/state) 
3. Then the lifecycle methods. In this order: connectedCallback(), disconnectedCallback, attributeChangeCallback, adoptedCallback and so on.
4. All the behaviour, variables and methods
5. Add the CSS styling last

### Basic Component template

Follow this setup for all components:

```ts
import { LitElement, html, css } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { msg } from "@lit/localize";

// Webawesome component imports
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/icon/icon.js";

@customElement("ct-component-name")
export class CTComponentName extends SignalWatcher(LitElement)
{
  
  // ── 1. Render ──
  override render()
  {
    return html`
      <div class="container">
        <span class="label">${this.label}</span>
        <wa-button variant="brand" @click=${this._handleClick}>
          <wa-icon slot="prefix" name="bolt"></wa-icon>
          ${msg("Action")}
        </wa-button>
      </div>
    `;
  }

  // ── 2. State, Properties & Signals ──
  @state() private _active = false;
  @property({ type: String }) label = "";
  @property({ type: Boolean, reflect: true }) disabled = false;

  // Signal example (from src/state/):
  // private _data = someSignal.get();

  // ── 3. Lifecycle ──
  override connectedCallback()
  {
    super.connectedCallback();
    // set up subscriptions, observers, etc.
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    // clean up subscriptions, observers, etc.
  }

  override firstUpdated()
  {
    // DOM is ready; query shadowRoot elements here
  }

  override updated(changed: Map<string, unknown>)
  {
    if (changed.has("label"))
    {
      // react to label changes
    }
  }

  // ── 4. Behaviour & Methods ──
  private _handleClick()
  {
    this._active = !this._active;
    this.dispatchEvent(
      new CustomEvent("ct-action", {
        detail: { active: this._active },
        bubbles: true,
        composed: true,
      })
    );
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
    }

    *,
    *::before,
    *::after {
      box-sizing: inherit;
    }

    .container {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-4);
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      font-family: var(--font-sans);
      color: var(--color-text);
    }

    .label {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    "ct-component-name": CTComponentName;
  }
}

```

### Component styling ####

1. Never use inline styling in HTML templates (i.e. style="....")
2. Always use the standards of the components of Webawesome
3. Use designs tokens as much as possible (src/design-tokens.ts)

### Avoid these recurring problems ####

- Avoid stray .js files output: If you need to do TS checking please always use --noEmit with tsc



## Commits with generated code

Archiyou is NLnet-funded and discloses AI involvement per commit. Code an agent wrote is committed with `pnpm commit:ai` (author "with <model>", disclosure block, human-written summary, approval before commit) and belongs to a record in `documentation/nlnet/ai/records/`. The process: `documentation/nlnet/ai/README.md`; for Claude Code: `.claude/skills/ai-disclosure/SKILL.md`. No co-author trailers, no links to chat platforms.
