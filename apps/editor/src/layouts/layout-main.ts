/**
 * <layout-main> — authenticated application shell layout.
 *
 * Renders the top navigation bar above a <slot> for child page content.
 * This component is the parent route component for all guarded routes.
 *
 * Also where the CAD kernel warmup starts. It used to live in <app-shell>, which runs
 * before the router resolves and so paid ~26MB of kernel download on every page — a
 * published configurator included, even one that executes server-side and never needs
 * a kernel at all. This layout wraps exactly the pages that do need one (/editor,
 * /browser); the configurator route is top-level and outside it.
 */

import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

import '@archiyou/ui/nav-bar.js';
import '../components/verify-email-banner.js';

import { warmupWorker, setServerExecutionTarget } from '../services/execution-service';

@customElement('layout-main')
export class LayoutMain extends LitElement
{
  // ── 1. Render ──
  override render()
  {
    return html`
      <nav-bar></nav-bar>
      <verify-email-banner></verify-email-banner>
      <div class="content">
        <slot></slot>
      </div>
    `;
  }

  // ── 3. Lifecycle ──
  override firstUpdated()
  {
    // Kicked off as early as the route allows so the editor's first execution does
    // not wait on the WASM load. Best-effort: a failure here surfaces properly on
    // the first actual run.
    // Every page under this layout executes locally, so a server target left over
    // from a configurator visited earlier in this SPA session would be wrong here —
    // and would make the warmup below a silent no-op. Clearing it first makes the
    // teardown order of the previous route irrelevant.
    setServerExecutionTarget(null);

    warmupWorker().catch(err =>
    {
      console.warn('LayoutMain::firstUpdated(): worker warmup failed:', err);
    });
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    nav-bar {
      flex-shrink: 0;
    }

    verify-email-banner {
      flex-shrink: 0;
    }

    .content {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'layout-main': LayoutMain;
  }
}
