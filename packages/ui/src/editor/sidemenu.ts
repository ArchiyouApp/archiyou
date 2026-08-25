import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import './hamburger-menu.js';

type MenuItem = 'info' | 'code' | 'history' | 'files' | 'templates' | 'help' | 'settings';

@customElement('editor-side-menu')
export class SideMenu extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <!-- top: hamburger dropdown -->
      <editor-hamburger-menu></editor-hamburger-menu>

      <!-- sections -->
      <div class="sections">
        <wa-button
          appearance="plain"
          class=${this._active === 'info' ? 'active' : ''}
          @click=${() => this._select('info')}
        ><wa-icon library="lucide" name="info" label="Info"></wa-icon></wa-button>

        <wa-button
          appearance="plain"
          class=${this._active === 'code' ? 'active' : ''}
          @click=${() => this._select('code')}
        ><wa-icon library="lucide" name="code" label="Code editor"></wa-icon></wa-button>

        <wa-button
          appearance="plain"
          class=${this._active === 'history' ? 'active' : ''}
          @click=${() => this._select('history')}
        ><wa-icon library="lucide" name="history" label="History"></wa-icon></wa-button>

        <wa-button
          appearance="plain"
          class=${this._active === 'files' ? 'active' : ''}
          @click=${() => this._select('files')}
        ><wa-icon library="lucide" name="file-text" label="Files"></wa-icon></wa-button>
      </div>

      <!-- bottom: templates, help, settings -->
      <div class="bottom">
        <wa-button
          appearance="plain"
          class=${this._active === 'templates' ? 'active' : ''}
          @click=${() => this._select('templates')}
        ><wa-icon library="lucide" name="box" label="Templates"></wa-icon></wa-button>

        <wa-button
          appearance="plain"
          class=${this._active === 'help' ? 'active' : ''}
          @click=${() => this._select('help')}
        ><wa-icon library="lucide" name="circle-help" label="Help"></wa-icon></wa-button>

        <wa-button
          appearance="plain"
          class=${this._active === 'settings' ? 'active' : ''}
          @click=${() => this._select('settings')}
        ><wa-icon library="lucide" name="settings" label="Settings"></wa-icon></wa-button>
      </div>
    `;
  }

  // ── 2. State, Properties ──
  @property({ type: String }) active: MenuItem | null = 'code';

  @state() private _active: MenuItem | null = 'code';

  // ── 3. Lifecycle ──
  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('active'))
    {
      this._active = this.active;
    }
  }

  // ── 4. Behaviour & Methods ──
  private _select(item: MenuItem)
  {
    this._active = this._active === item ? null : item;
    this.dispatchEvent(new CustomEvent('menu-select', {
      detail: this._active,
      bubbles: true,
      composed: true,
    }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 48px;
      padding-right: 8px;
      padding-left: 8px;
      padding-top: var(--space-sm);
      padding-bottom: var(--space-sm);
      flex-shrink: 0;
      background: var(--color-bg-elevated);
      border-right: 1px solid var(--color-border);
      align-items: center;
      gap: var(--space-1, 4px);
    }

    .sections {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-1, 4px);
      flex: 1;
      margin-top: var(--space-sm, 8px);
    }

    .bottom {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-1, 4px);
      margin-top: auto;
    }

    wa-button.active::part(base) {
      background-color: var(--color-primary-subtle, color-mix(in srgb, var(--color-primary) 15%, transparent));
      color: var(--color-primary);
    }


  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-side-menu': SideMenu;
  }
}
