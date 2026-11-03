/**
 * <layout-main> — authenticated application shell layout.
 *
 * Renders the top navigation bar above a <slot> for child page content.
 * This component is the parent route component for all guarded routes.
 *
 * No CAD kernel is loaded here. This layout also wraps /browser, /projects/:id and
 * /admin, which show lists and records and never run a script on arrival; warming the
 * kernel for them (the core library plus ~40MB of meshup and OpenCascade) made opening a
 * project wait on that download. The pages that run scripts warm it themselves: the
 * editor on mount, the configurator on connect, the share/publish and delivery dialogs
 * when they open, and RunnerWorker.run() initialises on first use regardless.
 */

import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

import '@archiyou/ui/nav-bar.js';
import '../components/verify-email-banner.js';

import { setServerExecutionTarget, setPublishedScript } from '../services/execution-service';

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
    // Every page under this layout executes locally, so a server target left over
    // from a configurator visited earlier in this SPA session would be wrong here.
    // Clearing it first makes the teardown order of the previous route irrelevant.
    setServerExecutionTarget(null);
    setPublishedScript(null);
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
