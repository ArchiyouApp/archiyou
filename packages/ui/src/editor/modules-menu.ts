import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

import { moduleCatalog, ensureModuleCatalog } from '@archiyou/editor/src/services/module-service';

/**
 * <editor-modules-menu> — what extra capabilities this account can use in scripts.
 *
 * Opened from the main file menu. Lists every module installed on the backend,
 * unlocked ones first. LOCKED modules are shown rather than hidden: a user needs
 * to be able to see that a capability exists before they can ask for it, and
 * hiding them would also make the error a script gets ("not available on your
 * account") come out of nowhere.
 *
 * Controlled by its `open` property, like the other editor modals.
 *
 * Emits:
 *   modules-menu-cancel  CustomEvent<void>  — the user closed it
 */
@customElement('editor-modules-menu')
export class ModulesMenu extends SignalWatcher(LitElement)
{
  @property({ type: Boolean, reflect: true }) open = false;

  /** True while the first catalog fetch of this session is in flight. */
  @state() private _loading = false;

  static override styles = css`
    :host { display: contents; }

    /* wa-dialog paints itself with --wa-color-surface-raised, which the theme
       sets to the grey #d9d9d9. Point it at the DEFAULT surface instead of
       hardcoding #fff: that is white in the light theme and the dark base in
       the dark one, so this stays readable when the theme flips. */
    wa-dialog { --wa-color-surface-raised: var(--wa-color-surface-default, #fff); }

    wa-dialog::part(title) {
      font-size: var(--text-base, 1rem);
      line-height: var(--text-base, 1rem);
    }

    /* Sizes come off the shared scale (xs .75 / sm .875 / base 1) rather than
       ad-hoc ems, so "one step smaller" stays one step at every zoom level. */

    .intro {
      margin: 0 0 1rem;
      font-size: var(--text-sm, 0.875rem);
      color: var(--color-text-quiet, #666);
    }

    .list { display: flex; flex-direction: column; gap: 0.75rem; }

    .module {
      display: flex; gap: 0.75rem; align-items: flex-start;
      padding: 0.75rem;
      border: 1px solid var(--color-border, #e0e0e0);
      border-radius: 0.5rem;
    }
    .module.locked { opacity: 0.65; }

    .icon { flex: 0 0 auto; margin-top: 0.15rem; }
    .body { flex: 1 1 auto; min-width: 0; }

    /* The row header is the id you actually type in a script, so it is set in
       the code face — there is no separate display title to distinguish it from. */
    .name {
      display: block;
      font-family: var(--wa-font-family-code, monospace);
      font-size: var(--text-sm, 0.875rem);
      font-weight: 600;
    }
    .description { margin: 0.25rem 0 0; font-size: var(--text-xs, 0.75rem); color: var(--color-text-quiet, #666); }

    .use { margin: 0.4rem 0 0; font-size: var(--text-xs, 0.75rem); }
    .use code {
      font-family: var(--wa-font-family-code, monospace);
      background: var(--color-surface-sunken, rgba(0, 0, 0, 0.06));
      padding: 0.1rem 0.35rem;
      border-radius: 0.25rem;
    }

    .empty {
      display: flex; gap: 0.5rem; align-items: center;
      font-size: var(--text-sm, 0.875rem);
      color: var(--color-text-quiet, #666);
    }
  `;

  /** Fetch on open, not on construction: the catalog is per signed-in user, and
   *  a user who never opens this menu should not cost a request. */
  override updated(changed: Map<string, unknown>)
  {
    if (changed.has('open') && this.open && moduleCatalog.get().length === 0)
    {
      this._loading = true;
      void ensureModuleCatalog().finally(() => { this._loading = false; });
    }
  }

  override render()
  {
    const modules = moduleCatalog.get();
    const unlocked = modules.filter(m => m.entitled).length;

    // The dialog stays in the tree and is driven by `?open`. Creating it
    // already-open instead would skip wa-dialog's show transition.
    return html`
      <wa-dialog
        label=${msg('modules')}
        style="--width: 32rem"
        ?open=${this.open}
        @wa-after-hide=${this._cancel}
      >
        ${modules.length === 0
          ? this._renderEmpty()
          : html`
            <p class="intro">
              ${unlocked === 0
                ? msg('None of these are enabled on your account yet.')
                : msg('These add extra capabilities to your scripts.')}
            </p>
            <div class="list">
              ${[...modules]
                // Unlocked first: what you can use now is the more useful information.
                // Then by the label actually shown, so the order matches the eye.
                .sort((a, b) => Number(b.entitled) - Number(a.entitled) || a.global.localeCompare(b.global))
                .map(m => this._renderModule(m))}
            </div>`}
      </wa-dialog>
    `;
  }

  /** No modules at all. Distinguishes "still asking" from "this server has none",
   *  because both otherwise look like an empty box. */
  private _renderEmpty()
  {
    return this._loading
      ? html`<p class="empty"><wa-spinner></wa-spinner>${msg('Loading modules…')}</p>`
      : html`<p class="empty">${msg('No modules are installed on this server.')}</p>`;
  }

  private _renderModule(m: ReturnType<typeof moduleCatalog.get>[number])
  {
    return html`
      <div class="module ${m.entitled ? '' : 'locked'}">
        <!-- With the status pill gone this icon carries the state on its own, so
             its label is the only thing a screen reader has to go on. -->
        <wa-icon
          class="icon"
          library="lucide"
          name=${m.entitled ? 'circle-check' : 'lock'}
          label=${m.entitled ? msg('Enabled') : msg('Locked')}
        ></wa-icon>
        <div class="body">
          <span class="name">${m.global}</span>
          ${m.description ? html`<p class="description">${m.description}</p>` : ''}
          ${m.entitled
            // The one thing a user needs to know to actually use it: nothing
            // loads unless the script declares it.
            ? html`<p class="use">${msg('Use it with')} <code>$module('${m.id}')</code></p>`
            : ''}
          ${m.docsUrl
            ? html`<a class="description" href=${m.docsUrl} target="_blank" rel="noopener noreferrer">
                ${msg('Documentation')}
              </a>`
            : ''}
        </div>
      </div>
    `;
  }

  private _cancel()
  {
    this.dispatchEvent(new CustomEvent('modules-menu-cancel', { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'editor-modules-menu': ModulesMenu;
  }
}
