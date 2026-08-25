/**
 *  png-grey.ts
 *
 *  Re-encode an RGB(A) PNG as an 8-bit GREYSCALE PNG.
 *
 *  Material textures are tint masks (see MONO in generate-textures.ts): glTF multiplies
 *  them by baseColorFactor, so all three channels carry identical data. Storing them as
 *  RGB wastes two thirds of every file — across ~74 textures that is most of a hundred
 *  megabytes shipped in @archiyou/core and base64'd into every exported GLB.
 *
 *  Hand-rolled on node:zlib rather than pulling in sharp/jimp: this runs at build time on
 *  images we generated ourselves, so it only needs the one path the image model emits
 *  (8-bit, non-interlaced, colour type 2 or 6).
 */

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 (PNG chunk checksum). */
const CRC_TABLE = (() =>
{
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++)
    {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf: Buffer): number
{
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer
{
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

/** Paeth predictor (PNG filter type 4). */
function paeth(a: number, b: number, c: number): number
{
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

/** Reverse PNG scanline filtering in place, returning the raw pixel rows. */
function unfilter(raw: Buffer, width: number, height: number, bpp: number): Buffer
{
    const stride = width * bpp;
    const out = Buffer.alloc(stride * height);
    let pos = 0;

    for (let y = 0; y < height; y++)
    {
        const filter = raw[pos++];
        const line = raw.subarray(pos, pos + stride);
        pos += stride;
        const cur = out.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

        for (let x = 0; x < stride; x++)
        {
            const a = x >= bpp ? cur[x - bpp] : 0;
            const b = prev ? prev[x] : 0;
            const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
            let v = line[x];
            switch (filter)
            {
                case 0: break;
                case 1: v += a; break;
                case 2: v += b; break;
                case 3: v += (a + b) >> 1; break;
                case 4: v += paeth(a, b, c); break;
                default: throw new Error(`unsupported PNG filter ${filter}`);
            }
            cur[x] = v & 0xff;
        }
    }
    return out;
}

/**
 * Convert an RGB(A) PNG buffer to 8-bit greyscale. Returns the input unchanged when the
 * image is not a PNG shape we handle — the caller keeps whatever it already had.
 */
export interface GreyImage { width: number; height: number; pixels: Uint8Array }

/**
 * Decode a PNG to single-channel greyscale. Handles the colour types we deal with:
 * 2/6 (RGB/RGBA, what the image model emits) and 0 (greyscale, our own output, so the
 * textures can be re-processed without regenerating them). Null when unsupported.
 */
export function decodeGrey(buf: Buffer): GreyImage | null
{
    if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return null;

    let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    const idat: Buffer[] = [];

    let p = 8;
    while (p + 8 <= buf.length)
    {
        const len = buf.readUInt32BE(p);
        const type = buf.toString('ascii', p + 4, p + 8);
        const data = buf.subarray(p + 8, p + 8 + len);

        if (type === 'IHDR')
        {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        }
        else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;

        p += 12 + len; // length + type + data + crc
    }

    if (bitDepth !== 8 || interlace !== 0) return null;
    if (![0, 2, 6].includes(colorType)) return null;
    if (!idat.length || !width || !height) return null;

    const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
    const raw = unfilter(inflateSync(Buffer.concat(idat)), width, height, bpp);

    const pixels = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++)
    {
        if (bpp === 1) pixels[i] = raw[i];
        // Rec. 709 luma. The masks are already neutral, but deriving luminance rather
        // than taking red keeps this correct if a texture carries a slight tint.
        else pixels[i] = Math.round(
            0.2126 * raw[i * bpp] + 0.7152 * raw[i * bpp + 1] + 0.0722 * raw[i * bpp + 2]);
    }
    return { width, height, pixels };
}

/** Encode single-channel greyscale as an 8-bit colour-type-0 PNG. */
export function encodeGrey(img: GreyImage): Buffer
{
    const { width, height, pixels } = img;
    const out = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y++)
    {
        out[y * (width + 1)] = 0; // filter: None — the rows are already near-flat
        for (let x = 0; x < width; x++) out[y * (width + 1) + 1 + x] = pixels[y * width + x];
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 0;   // colour type 0 = greyscale
    ihdr[10] = 0;  // compression
    ihdr[11] = 0;  // filter
    ihdr[12] = 0;  // interlace

    return Buffer.concat([
        PNG_MAGIC,
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(out, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * Strengthen a tint mask until its linework reads clearly.
 *
 * The image model's sense of "contrast" varies wildly per material — across the set the
 * 2nd-percentile tone ranged from 0.13 to 0.98, so some textures read as strong drawings
 * and others as blank paper. This stretches each image's deviation from white until its
 * darkest tones reach `targetDark`.
 *
 * It only ever STRENGTHENS (scale >= 1): levelling everything to an identical range would
 * mean flattening the materials that are legitimately high-contrast — terracotta and
 * stone are genuinely bolder than cement, and that difference is worth keeping.
 *
 * Anchored at white because these are multiplied by the material colour: white must stay
 * white or every material shifts off its declared hue.
 */
export function autoContrast(img: GreyImage, targetDark = 0.35, maxScale = 4): GreyImage
{
    const { pixels } = img;

    // 2nd percentile via histogram — robust to a few stray black pixels.
    const hist = new Uint32Array(256);
    for (let i = 0; i < pixels.length; i++) hist[pixels[i]]++;
    const cutoff = pixels.length * 0.02;
    let acc = 0, p2 = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= cutoff) { p2 = v / 255; break; } }

    const scale = Math.max(1, Math.min(maxScale, (1 - targetDark) / Math.max(1 - p2, 1e-3)));
    if (Math.abs(scale - 1) < 0.02) return img; // already at strength

    // 256-entry LUT: out = 1 - (1 - v) * scale, clamped.
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++)
        lut[v] = Math.max(0, Math.min(255, Math.round(255 - (255 - v) * scale)));

    const out = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) out[i] = lut[pixels[i]];
    return { width: img.width, height: img.height, pixels: out };
}

/**
 * Convert an RGB(A) PNG buffer to 8-bit greyscale, auto-levelled. Returns the input
 * unchanged when the image is not a PNG shape we handle.
 */
export function toGreyscalePNG(buf: Buffer): Buffer
{
    const img = decodeGrey(buf);
    return img ? encodeGrey(autoContrast(img)) : buf;
}
