/**
 * page-admin — the operator screen, at /admin/:section inside the main layout.
 *
 * The route action already redirects a non-operator (apps/workspace/router.ts), so
 * reaching this component normally means `userState.isAdmin`. It is re-checked here
 * anyway for the case the router cannot cover: signing out, or having admin revoked,
 * while the page is open. Neither check is a control — every request a section makes
 * is gated server-side by requireAdmin.
 *
 * The screen is split into sections, one tab each, and every section has its own URL
 * (/admin/configurators) so it can be linked to and survives a reload. /admin, or an
 * unknown section, shows the first one. Adding a section is one entry in _sections().
 */

import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg } from '@lit/localize';
import { Router, type RouterLocation } from '@vaadin/router';

import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@archiyou/ui/admin/admin-configurators.js';
import '@archiyou/ui/admin/admin-feedback.js';

import { userState } from '../state/workspace';

interface AdminSection
{
  /** URL segment: /admin/{id}. */
  id: string;
  /** Lucide icon name for the tab. */
  icon: string;
  label: string;
  /** One or two sentences above the section's content. */
  lede: string;
  render: () => TemplateResult;
}

@customElement('page-admin')
export class PageAdmin extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    if (!userState.get().isAdmin)
    {
      return html`
        <div class="center">
          <wa-icon library="lucide" name="shield-off"></wa-icon>
          <p>${msg('This page is for operator accounts.')}</p>
        </div>`;
    }

    const sections = this._sections();
    const section = this._activeSection(sections);

    return html`
      <header class="head">
        <h1>${msg('Admin')}</h1>
        <wa-tab-group active=${section.id} @wa-tab-show=${this._onTabShow}>
          ${sections.map(s => html`
            <wa-tab slot="nav" panel=${s.id}>
              <wa-icon library="lucide" name=${s.icon}></wa-icon>
              ${s.label}
            </wa-tab>`)}
        </wa-tab-group>
      </header>

      <section class="section">
        <p class="lede">${section.lede}</p>
        ${section.render()}
      </section>
    `;
  }

  // ── 2. State, Properties ──
  /** Set by the router. */
  @property({ attribute: false }) location?: RouterLocation;

  // ── 4. Behaviour & Methods ──
  /** Every admin section, in tab order. Built per render so the labels follow the locale. */
  private _sections(): AdminSection[]
  {
    return [
      {
        id: 'configurators',
        icon: 'shield-check',
        label: msg('Verify configurators'),
        lede: msg('Validating a configurator lets that exact version run on the server instead of in the visitor’s browser. Read its code before you do.'),
        render: () => html`<admin-configurators></admin-configurators>`,
      },
      {
        id: 'feedback',
        icon: 'message-square',
        label: msg('Feedback'),
        lede: msg('What visitors sent with the feedback button on a configurator. Star what is worth keeping.'),
        render: () => html`<admin-feedback></admin-feedback>`,
      },
    ];
  }

  private _activeSection(sections: AdminSection[]): AdminSection
  {
    const id = (this.location?.params as Record<string, string> | undefined)?.section;
    return sections.find(s => s.id === id) ?? sections[0];
  }

  private _onTabShow(e: CustomEvent<{ name: string }>)
  {
    const id = e.detail.name;
    if (id === this._activeSection(this._sections()).id) return;
    Router.go(`/admin/${id}`);
  }

  // ── 5. Styles ──
  static override styles = css`
    :host
    {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      box-sizing: border-box;
      font-family: var(--font-sans);
      color: var(--color-text);
    }

    *,
    *::before,
    *::after
    {
      box-sizing: inherit;
    }

    .head
    {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      padding-top: var(--space-lg);
    }

    h1
    {
      margin: 0;
      padding: 0 var(--space-lg);
      font-family: var(--font-display, var(--font-sans));
      font-size: var(--text-xl);
    }

    /* Navigation only, no panels: the tab track runs the full width under the header.
       The active tab is marked with an inset shadow rather than the group's indicator
       border, which the browser rounds down to one device pixel below 100% zoom. */
    wa-tab-group
    {
      --track-color: var(--color-divider);
      --track-width: 1px;
      --indicator-color: transparent;
    }

    wa-tab[active]::part(base)
    {
      box-shadow: inset 0 -2px 0 var(--color-primary);
    }

    wa-tab-group::part(body) { display: none; }
    wa-tab-group::part(tabs) { padding: 0 var(--space-lg); }

    wa-tab::part(base)
    {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      font-size: var(--text-sm);
    }

    .lede
    {
      margin: 0;
      padding: var(--space-lg) var(--space-lg) 0;
      max-width: calc(60ch + 2 * var(--space-lg));
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }

    .center
    {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      flex: 1;
      color: var(--color-text-muted);
    }

    .center wa-icon { font-size: 32px; }
    .center p { margin: 0; font-size: var(--text-sm); }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'page-admin': PageAdmin;
  }
}
