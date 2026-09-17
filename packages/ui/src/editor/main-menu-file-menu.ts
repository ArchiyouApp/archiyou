import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import { msg } from '@lit/localize';
import { Router } from '@vaadin/router';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import '@awesome.me/webawesome/dist/components/divider/divider.js';

import { editorScript, isReadOnly } from '@archiyou/editor/src/state/workspace';

@customElement('editor-main-menu-file-menu')
export class MainMenuFileMenu extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    // A foreign (read-only) script is not in our collection, so there is
    // nothing of ours to delete — and neither is an empty editor.
    const canDelete = !!editorScript.get() && !isReadOnly.get();

    return html`
      <wa-dropdown placement="bottom-start" @wa-select=${this._handleSelect}>

        <!-- hamburger button -->
        <wa-button slot="trigger" appearance="plain" class="trigger">
            <wa-icon library="lucide" name="menu" label="Menu"></wa-icon>
        </wa-button>

        <wa-dropdown-item value="back">
          <wa-icon slot="icon" library="lucide" name="arrow-left"></wa-icon>
          ${msg('Back to file browser')}
        </wa-dropdown-item>

        <wa-divider></wa-divider>
        <wa-dropdown-item value="new">
          <wa-icon slot="icon" library="lucide" name="file-plus-2"></wa-icon>
          ${msg('New')}
        </wa-dropdown-item>
        <wa-dropdown-item value="open-script">
          <wa-icon slot="icon" library="lucide" name="folder-open"></wa-icon>
          ${msg('Open script')}
        </wa-dropdown-item>
        <wa-dropdown-item value="save">
          <wa-icon slot="icon" library="lucide" name="save"></wa-icon>
          ${msg('Save')}
        </wa-dropdown-item>
        <wa-dropdown-item value="delete-script" variant="danger" ?disabled=${!canDelete}>
          <wa-icon slot="icon" library="lucide" name="trash-2"></wa-icon>
          ${msg('Delete script')}
        </wa-dropdown-item>

        <wa-divider></wa-divider>

        <wa-dropdown-item value="import-data">
          <wa-icon slot="icon" library="lucide" name="file-input"></wa-icon>
          ${msg('Import Script Data')}
        </wa-dropdown-item>
        <wa-dropdown-item value="export">
          <wa-icon slot="icon" library="lucide" name="file-output"></wa-icon>
          ${msg('Export to...')}
          <wa-dropdown-item slot="submenu" value="export-glb">
            <wa-icon slot="icon" library="lucide" name="boxes"></wa-icon>
            GLB 3D
          </wa-dropdown-item>
          <wa-dropdown-item slot="submenu" value="export-stl">
            <wa-icon slot="icon" library="lucide" name="scan-search"></wa-icon>
            STL 3D
          </wa-dropdown-item>
          <wa-dropdown-item slot="submenu" value="export-amf">
            <wa-icon slot="icon" library="lucide" name="package"></wa-icon>
            AMF 3D
          </wa-dropdown-item>
          <wa-dropdown-item slot="submenu" value="export-dae">
            <wa-icon slot="icon" library="lucide" name="box"></wa-icon>
            DAE 3D
          </wa-dropdown-item>
          <wa-dropdown-item slot="submenu" value="export-svg">
            <wa-icon slot="icon" library="lucide" name="spline"></wa-icon>
            SVG 2D
          </wa-dropdown-item>
          <wa-dropdown-item slot="submenu" value="export-dxf">
            <wa-icon slot="icon" library="lucide" name="pen-tool"></wa-icon>
            DXF 2D
          </wa-dropdown-item>
          <wa-dropdown-item slot="submenu" value="export-fcstd">
            <wa-icon slot="icon" library="lucide" name="cog"></wa-icon>
            FreeCAD
          </wa-dropdown-item>
          <wa-dropdown-item slot="submenu" value="export-ifc">
            <wa-icon slot="icon" library="lucide" name="building-2"></wa-icon>
            IFC (BIM)
          </wa-dropdown-item>
          <wa-dropdown-item slot="submenu" value="export-scad">
            <wa-icon slot="icon" library="lucide" name="code"></wa-icon>
            OpenSCAD
          </wa-dropdown-item>
          <wa-dropdown-item slot="submenu" value="export-script-data">
            <wa-icon slot="icon" library="lucide" name="file-code"></wa-icon>
            Script JS
          </wa-dropdown-item>
        </wa-dropdown-item>

        <wa-dropdown-item value="share">
          <wa-icon slot="icon" library="lucide" name="share-2"></wa-icon>
          ${msg('Share script')}
        </wa-dropdown-item>
        <wa-dropdown-item value="publish">
          <wa-icon slot="icon" library="lucide" name="rocket"></wa-icon>
          ${msg('Publish as configurator')}
        </wa-dropdown-item>
        <wa-dropdown-item value="manage-configurators">
          <wa-icon slot="icon" library="lucide" name="layout-grid"></wa-icon>
          ${msg('Manage configurators')}
        </wa-dropdown-item>

        <wa-divider></wa-divider>

        <wa-dropdown-item value="modules">
          <wa-icon slot="icon" library="lucide" name="puzzle"></wa-icon>
          ${msg('Modules')}
        </wa-dropdown-item>

        <wa-divider></wa-divider>

        <wa-dropdown-item value="changelog">
          <wa-icon slot="icon" library="lucide" name="layers"></wa-icon>
          ${msg('Changelog')}
        </wa-dropdown-item>

        <wa-dropdown-item value="support">
          <wa-icon slot="icon" library="lucide" name="circle-help"></wa-icon>
          ${msg('Support')}
        </wa-dropdown-item>

        <wa-dropdown-item value="api">
          <wa-icon slot="icon" library="lucide" name="box"></wa-icon>
          ${msg('API')}
        </wa-dropdown-item>
      </wa-dropdown>
    `;
  }

  // ── 4. Behaviour & Methods ──
  private _handleSelect(e: CustomEvent)
  {
    const value = (e.detail.item as { value: string }).value;

    if (value === 'back')
    {
      Router.go('/browser');
      return;
    }

    this.dispatchEvent(new CustomEvent('menu-action', {
      detail: value,
      bubbles: true,
      composed: true,
    }));
  }

  // ── 5. Styles ──
  static override styles = css`
    :host {
      display: contents;
    }

    wa-dropdown {
      --wa-color-surface-raised: var(--color-secondary, #180c2d);
      --wa-color-surface-border: color-mix(in srgb, var(--color-secondary, #180c2d) 60%, white);
      --wa-color-text-normal: var(--color-white, #ffffff);
      --wa-color-text-quiet: color-mix(in srgb, white 60%, transparent);
      --wa-color-neutral-fill-normal: color-mix(in srgb, var(--color-secondary, #180c2d) 70%, white);
      --wa-color-neutral-on-quiet: var(--color-white, #ffffff);
      --wa-font-size-m: var(--text-sm, 0.875rem);
    }

    wa-dropdown::part(menu) {
      background-color: var(--color-secondary, #180c2d);
      border-color: color-mix(in srgb, var(--color-secondary, #180c2d) 60%, white);
    }

    wa-button.trigger {
      --wa-color-text-normal: var(--color-primary, #004be3) !important;
      --wa-font-size-m: var(--text-base, 1rem);
    }

    wa-button.trigger::part(base) {
      color: var(--color-primary, #004be3);
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'editor-main-menu-file-menu': MainMenuFileMenu;
  }
}
