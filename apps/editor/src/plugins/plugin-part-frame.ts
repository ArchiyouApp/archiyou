/**
 * <plugin-part-frame> — host side of the `archiyou` bridge.
 *
 * Mounts a flattened HTML part (param menu / tool) in a sandboxed srcdoc iframe
 * and talks to it over postMessage. The bridge shim (injected into the part's
 * <head>) exposes `window.archiyou` inside the iframe:
 *   archiyou.onSchema(cb) · archiyou.submit(values) · archiyou.onResult(cb)
 *   archiyou.generate(selectors) → Promise<GeneratedOutput[]> · archiyou.download(name, data)
 *
 * Host → iframe:  schema · result · generate-result
 * iframe → host:  ready · submit · generate · download
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { GeneratedOutput } from './PluginManager';

const BRIDGE_SHIM = `<script>
(function(){
  var P = function(m){ parent.postMessage(Object.assign({__archiyou:true}, m), '*'); };
  var schemaCb=null, resultCb=null, lastSchema=null, lastResult=null, genId=0, pendingGen={};
  window.archiyou = {
    onSchema: function(cb){ schemaCb=cb; if(lastSchema!==null) cb(lastSchema); },
    submit:   function(values){ P({type:'submit', values:values}); },
    onResult: function(cb){ resultCb=cb; if(lastResult!==null) cb(lastResult); },
    generate: function(selectors){
      return new Promise(function(resolve, reject){
        var id = 'g' + (++genId); pendingGen[id] = { resolve:resolve, reject:reject };
        P({type:'generate', id:id, selectors:selectors});
      });
    },
    download: function(filename, data){ P({type:'download', filename:filename, data:data}); },
    // Open/close/toggle a tool panel by its name or id.
    ui: {
      open:   function(tool){ P({type:'ui', action:'open',   tool:tool}); },
      close:  function(tool){ P({type:'ui', action:'close',  tool:tool}); },
      toggle: function(tool){ P({type:'ui', action:'toggle', tool:tool}); },
    },
  };
  window.addEventListener('message', function(e){
    var d=e.data; if(!d||!d.__archiyou) return;
    if(d.type==='schema'){ lastSchema=d.schema; if(schemaCb) schemaCb(d.schema); }
    else if(d.type==='result'){ lastResult=d.result; if(resultCb) resultCb(d.result); }
    else if(d.type==='generate-result'){
      var pg=pendingGen[d.id]; if(pg){ delete pendingGen[d.id];
        d.error ? pg.reject(new Error(d.error)) : pg.resolve(d.outputs); }
    }
  });
  // Announce readiness after the part's own scripts have registered handlers.
  window.addEventListener('load', function(){ P({type:'ready'}); });
})();
</script>`;

@customElement('plugin-part-frame')
export class PluginPartFrame extends LitElement
{
  /** The part's HTML source (self-contained document). */
  @property({ attribute: false }) src = '';
  /** The input schema handed to the part on 'ready'. */
  @property({ attribute: false }) schema: unknown = null;
  /** The current execution result summary handed to the part. */
  @property({ attribute: false }) result: unknown = null;

  /** Callback used to satisfy `archiyou.generate(...)` requests. Set by the host. */
  onGenerate?: (selectors: string[]) => Promise<GeneratedOutput[]>;

  /** Whether the iframe has announced 'ready' (so updates can be pushed). */
  private _ready = false;

  static override styles = css`
    :host { display: block; height: 100%; }
    iframe { width: 100%; height: 100%; border: 0; background: #fff; }
  `;

  private _onMessage = (e: MessageEvent): void =>
  {
    const frame = this.renderRoot.querySelector('iframe');
    if (!frame || e.source !== frame.contentWindow) return;

    const d = e.data;
    if (!d || !d.__archiyou) return;

    switch (d.type)
    {
      case 'ready':
        this._ready = true;
        this._post({ type: 'schema', schema: this.schema });
        if (this.result != null) this._post({ type: 'result', result: this.result });
        break;
      case 'submit':
        this.dispatchEvent(new CustomEvent('plugin-submit', {
          detail: d.values, bubbles: true, composed: true,
        }));
        break;
      case 'generate':
        void this._handleGenerate(d.id, d.selectors);
        break;
      case 'download':
        this._download(d.filename, d.data);
        break;
      case 'ui':
        this.dispatchEvent(new CustomEvent('plugin-ui-command', {
          detail: { action: d.action, tool: d.tool }, bubbles: true, composed: true,
        }));
        break;
    }
  };

  private async _handleGenerate(id: string, selectors: string[]): Promise<void>
  {
    try
    {
      const outputs = (await this.onGenerate?.(selectors)) ?? [];
      this._post({ type: 'generate-result', id, outputs });
    }
    catch (e)
    {
      this._post({ type: 'generate-result', id, error: (e as Error)?.message ?? String(e) });
    }
  }

  /** Perform a download from the host (main-thread) context. */
  private _download(filename: string, data: ArrayBuffer | string): void
  {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private _post(msg: Record<string, unknown>): void
  {
    const frame = this.renderRoot.querySelector('iframe');
    frame?.contentWindow?.postMessage({ __archiyou: true, ...msg }, '*');
  }

  override connectedCallback(): void
  {
    super.connectedCallback();
    window.addEventListener('message', this._onMessage);
  }

  override disconnectedCallback(): void
  {
    window.removeEventListener('message', this._onMessage);
    super.disconnectedCallback();
  }

  override updated(changed: Map<string, unknown>): void
  {
    // If the part re-mounts (src changed), it will re-announce 'ready'.
    if (changed.has('src')) { this._ready = false; return; }
    if (!this._ready) return;
    if (changed.has('schema')) this._post({ type: 'schema', schema: this.schema });
    if (changed.has('result')) this._post({ type: 'result', result: this.result });
  }

  /** Inject the bridge shim so `window.archiyou` exists before the part runs. */
  private _srcdoc(): string
  {
    return this.src.includes('</head>')
      ? this.src.replace('</head>', `${BRIDGE_SHIM}</head>`)
      : BRIDGE_SHIM + this.src;
  }

  override render()
  {
    return html`<iframe sandbox="allow-scripts" .srcdoc=${this._srcdoc()}></iframe>`;
  }
}

declare global
{
  interface HTMLElementTagNameMap { 'plugin-part-frame': PluginPartFrame; }
}
