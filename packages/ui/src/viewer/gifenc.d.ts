/*  The part of gifenc (https://github.com/mattdesl/gifenc, MIT) the animation recorder uses:
    the package ships no types of its own. */
declare module 'gifenc'
{
  export type Palette = number[][];

  export interface GIFEncoderInstance
  {
    writeFrame(index: Uint8Array, width: number, height: number, options?: {
      palette?: Palette;
      /** Milliseconds, written in hundredths of a second. */
      delay?: number;
      /** -1 once, 0 forever (default), more: that many times. */
      repeat?: number;
      transparent?: boolean;
      transparentIndex?: number;
      first?: boolean;
      dispose?: number;
    }): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GIFEncoderInstance;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}
