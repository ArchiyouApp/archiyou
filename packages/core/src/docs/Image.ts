import { Container } from './Container'
import type { ContainerData, ContainerContent, ContainerAlignment, ImageOptionsFit, ImageOptions, PageSVGContext } from './types'
import { isContainerAlignment, isImageOptionsFit } from './typeguards'
import { arrayBufferToBase64, stripOuterSVGTags, stripXMLDeclaration, getPreserveAspectRatio } from './utils'
import { assetProxyUrlFor } from '../utils'


/** Image bytes by URL, shared by every Image container in this context.
 *
 *  A doc render is asked for more than once per execution — the editor requests both
 *  `docs/*​/svg` and `docs/*​/svg-pages`, and each render builds its own per-render
 *  cache — so without this the SAME url is downloaded once per output, per page. With
 *  a remote logo in a titleblock (the default) that turned a 200ms document into a
 *  6s one, and worse through the server proxy in the browser.
 *
 *  Keyed on the URL and holding the in-flight promise, so concurrent containers share
 *  one request. Entries are the fetched data; a URL that fails is remembered only
 *  briefly (FAILED_TTL_MS) so a dead host stops stalling every render without making
 *  the failure permanent for the lifetime of the worker. */
const IMAGE_DATA_CACHE = new Map<string, Promise<any>>();
const IMAGE_FAILED_AT = new Map<string, number>();
const FAILED_TTL_MS = 60_000;
/** Cap on a single image request, so an unresponsive host degrades the document
 *  (image skipped) instead of hanging the whole export. */
const IMAGE_FETCH_TIMEOUT_MS = 8_000;

export class Image extends Container
{
    DEFAULT_FIT:ImageOptionsFit = 'contain';
    DEFAULT_ALIGN:ContainerAlignment = ['left','top'];
    DEFAULT_BRIGHTNESS = 100;
    DEFAULT_CONTRAST = 100;
    DEFAULT_SATURATION = 1;
    DEFAULT_GRAYSCALE = 0;

    _url:string;
    _options:ImageOptions = {}

    constructor(url:string, options:ImageOptions)
    {
        super();
        this._type = 'image';
        this._url = url;
        this.setName(this.urlToName(url)); 
        this.setOptions(options);
    }

    urlToName(url:string):string
    {
        const urlElems = url.split('/');
        return urlElems[urlElems.length-1].split('.')[0]
    }

    /** Set options and defaults */
    setOptions(options:ImageOptions)
    {
        this._options.fit = isImageOptionsFit(options?.fit) ? options.fit : this.DEFAULT_FIT;
        
        // set in both options and on main container _contentAlign

        this._options.align = isContainerAlignment(options?.align) ? options.align : this.DEFAULT_ALIGN;
        this._contentAlign = this._options.align;

        this._options.brightness = (typeof options?.brightness === 'number') ? options.brightness : this.DEFAULT_BRIGHTNESS;
        this._options.contrast = (typeof options?.brightness === 'number') ? options.contrast : this.DEFAULT_CONTRAST;
        this._options.saturation = (typeof options?.brightness === 'number') ? options.contrast : this.DEFAULT_SATURATION;
        this._options.grayscale = (typeof options?.grayscale === 'number') ? options.grayscale : this.DEFAULT_GRAYSCALE;   
    }

    //// OUTPUT ////

    async toData(cache?:Record<string,any>|undefined):Promise<ContainerData> 
    {
        const format = this.getImageFormat();

        let data;
        if(format)
        {  
            data = await this.loadImageData(cache);
        }

        const containerData = {
            ...this._toContainerData(),
            content: { 
                source: this._url,
                format: format,
                data: data, 
                settings: this._options } as ContainerContent,
        }

        return containerData;
    }

    /** We want to load the raw data of the image in the ContainerContent for easy access later (in HTML and PDF exporter) */
    async loadImageData(cache?:Record<string,any>|undefined):Promise<any>
    {
        if(cache && cache[this._url]) // get from this render's cache
        {
            return cache[this._url];
        }

        // Shared across renders: one request per URL, however many outputs/pages use it.
        let pending = IMAGE_DATA_CACHE.get(this._url);
        if(!pending)
        {
            const failedAt = IMAGE_FAILED_AT.get(this._url);
            if(failedAt && (Date.now() - failedAt) < FAILED_TTL_MS)
            {
                // Recently unreachable — skip it rather than stalling this render too.
                return undefined;
            }

            pending = this._fetchImageData();
            IMAGE_DATA_CACHE.set(this._url, pending);
        }

        const data = await pending;

        if(data === undefined)
        {
            // Don't keep a failure around: remember it briefly, then allow a retry.
            IMAGE_DATA_CACHE.delete(this._url);
            IMAGE_FAILED_AT.set(this._url, Date.now());
        }
        else if(cache)
        {
            cache[this._url] = data;
        }

        return data;
    }

    /** Where to actually fetch this image from — or undefined when it cannot be fetched
     *  in this environment (the image is then simply left out of the document).
     *
     *  Only a CROSS-ORIGIN http(s) url needs the asset proxy. Same-origin and relative
     *  urls must go out directly: they raise no CORS question and satisfy the strictest
     *  `connect-src 'self'`, and the proxy would reject a relative one outright ("Only
     *  http(s) URLs are allowed") — so proxying everything would break exactly the urls
     *  that need no help. A relative url does need an origin to resolve against, which
     *  a browser has and node does not.
     *
     *  Resolution is explicit rather than left to fetch(): a Web Worker created from a
     *  blob: url has a blob: base, against which '/img/logo.png' does not resolve to the
     *  page's own origin. Node has no origin at all, so it uses the run's appBaseUrl
     *  (the server fills that from FRONTEND_URL). */
    private _resolveFetchUrl():string|undefined
    {
        const url = this._url;

        if(url.startsWith('data:')) return url; // already carries its bytes

        const isAbsolute = /^https?:\/\//i.test(url);
        const origin = (typeof globalThis !== 'undefined')
                            ? (globalThis as any)?.location?.origin
                            : undefined;

        // The page's own origin is authoritative where there is one; a node-side run
        // falls back to the origin the run was told the app is served from.
        const base = (typeof origin === 'string' && origin && origin !== 'null')
                        ? origin
                        : this._page._docs?.getAppBaseUrl?.();

        if(!isAbsolute)
        {
            if(!base)
            {
                console.warn(`DocPageContainerImage::loadImageData(): Cannot resolve the relative image url "${url}" — this run has no origin to resolve it against. Set appBaseUrl on the execution request (the server fills it from FRONTEND_URL), or use an absolute url for this image.`);
                return undefined;
            }
            try { return new URL(url, base).href; }
            catch(e)
            {
                console.warn(`DocPageContainerImage::loadImageData(): Could not resolve "${url}" against base "${base}": ${e}`);
                return undefined;
            }
        }

        // Same-origin absolute url: no proxy needed, and one hop less.
        if(base && url.startsWith(`${base}/`)) return url;

        // Base url of the asset proxy: from Doc settings, else from the running request.
        // '' is valid (root-relative /proxy), so test for undefined, not falsiness.
        const proxyBase = this._page._docs?.getAssetProxyUrl?.();
        if(typeof proxyBase !== 'string')
        {
            console.warn(`DocPageContainerImage::loadImageData(): No asset proxy configured. Fetching "${url}" directly — this works in node, but is blocked by CORS/CSP in the browser.`);
            return url;
        }

        // Same contract as $import(): GET ${base}/proxy?url=<encoded>.
        return assetProxyUrlFor(url, proxyBase);
    }

    /** Fetch the image bytes (through the asset proxy when one is configured). Resolves
     *  to undefined when the image cannot be loaded — never rejects, so one unreachable
     *  image degrades to a missing picture instead of failing the whole document.
     *
     *  The proxy is not optional in the browser: a remote image is a cross-origin GET, so
     *  it dies on CORS, and on a deployment with a strict CSP (`connect-src 'self'`) the
     *  request is refused before it is even sent — which is what made the default titleblock
     *  logo silently vanish in production while it rendered fine on a localhost dev server
     *  with no CSP. The proxy is same-origin, so it survives both. */
    private async _fetchImageData():Promise<any>
    {
        let data;

        const fetchUrl = this._resolveFetchUrl();
        if(!fetchUrl) return undefined; // unfetchable here — _resolveFetchUrl() said why

        // Bound the request: an unresponsive host used to stall the export for as long
        // as it took to time out (or forever), once per output.
        const fetchSettings = {
            method: 'GET',
            signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
        };

        // Do fetch
        const t0 = Date.now();
        try
        {
            const r = await fetch(fetchUrl, fetchSettings);

            if(r.status !== 200)
            {
                console.error(`DocPageContainerImage::loadImageData(): Could not get image "${this._url}" (HTTP ${r.status}) from "${fetchUrl}". Check that it exists and that the asset proxy is reachable.`)
            }
            else {
                data = (this.getImageFormat() === 'svg') ? await r.text() : this._exportImageDataBase64(await r.arrayBuffer());
                console.info(`DocPageContainerImage::loadImageData: Got data for image "${this._url}" with size ${data.length} in ${Date.now()-t0}ms`)
            }
        }
        catch(e)
        {
            console.warn(`DocPageContainerImage::loadImageData(): Could not load image at "${this._url}" (fetched from "${fetchUrl}") after ${Date.now()-t0}ms:  ERROR: "${e}".`);
        }

        return data;
    }

    /** Export image data as DataUrl base64 string */
    _exportImageDataBase64(data:ArrayBuffer):string
    {
        return `data:image/${this.getImageFormat()};base64,${arrayBufferToBase64(data)}`
    }

    //// OUTPUT: SVG ////

    async _toSVGContent(ctx: PageSVGContext, wMm: number, hMm: number): Promise<string>
    {
        const fmt    = (n: number) => +n.toFixed(4);
        const format = this.getImageFormat();
        const data   = await this.loadImageData(ctx.cache);
        const par    = getPreserveAspectRatio(this._contentAlign, this._options?.fit);

        if (!data)
        {
            console.warn(`Image::_toSVGContent(): No image data in container "${this.name}". Skipped.`);
            return '';
        }

        if (format === 'svg')
        {
            const cleaned      = stripXMLDeclaration(data as string);
            const viewBoxMatch = cleaned.match(/viewBox\s*=\s*["']([^"']+)["']/);
            const viewBox      = viewBoxMatch ? viewBoxMatch[1] : '';
            const inner        = stripOuterSVGTags(cleaned);
            const vbAttr       = viewBox ? ` viewBox="${viewBox}"` : '';
            return `<svg x="0" y="0" width="${fmt(wMm)}" height="${fmt(hMm)}"${vbAttr} preserveAspectRatio="${par}">${inner}</svg>`;
        }

        // Raster image (jpg/png) — data should be a base64 data-URI
        const href = (typeof data === 'string' && data.startsWith('data:'))
            ? data
            : `data:image/${format ?? 'png'};base64,${data}`;

        return `<image x="0" y="0" width="${fmt(wMm)}" height="${fmt(hMm)}" href="${href}" preserveAspectRatio="${par}"/>`;
    }

    getImageFormat():'jpg'|'png'|'svg'
    {
        const urlElems = this._url.split('/');
        const file = urlElems[urlElems.length-1]
        const m = file.match(/(?<=\.)jpg|png|svg/)
        return (m) ? m[0] as 'jpg'|'png'|'svg': null;
    }

}
