/**
 * animation-recorder.ts
 *
 * An animation as a video (MP4) or an animated GIF, made from the viewer frame by frame at a
 * fixed step (ModelViewer.renderAnimationFrames): the file has the view style, the edges, the
 * fades and the camera the viewer shows, and it is the same on a slow laptop as on a fast one,
 * which a recording of the live canvas never is.
 *
 *   - MP4: H.264 from the browser's own encoder (WebCodecs), put in an MP4 by mediabunny
 *     (MPL-2.0). A browser without an H.264 encoder gets VP9 or AV1 in the MP4 instead.
 *   - GIF: gifenc (MIT). One palette for the whole GIF, from a few frames spread over it, so
 *     the colours do not flicker from frame to frame.
 *
 * Both are loaded the first time something is recorded (a dynamic import): the editor does not
 * carry them until then.
 */

/// <reference path="./gifenc.d.ts" />

import type { AnimationFrameSource, AnimationLoopMode } from '@archiyou/editor/src/state/viewer';

export type RecordFormat = 'mp4' | 'gif';

export type RecordSizeId = 'landscape' | 'square' | 'story' | 'viewer';

export interface RecordOptions
{
  format: RecordFormat;
  width: number;
  height: number;
  /** Seconds the clip lasts. */
  duration: number;
  /** Once (the recording ends on the last frame), a loop (it ends where the first frame comes
   *  next), or back and forth (there and back again). */
  loop: AnimationLoopMode;
  /** As the player plays it: 0.5 is a recording twice as long. Default 1. */
  speed?: number;
  /** Look through the animation's own camera, when it has one. */
  follow?: boolean;
  /** Default RECORD_FPS. */
  fps?: number;
}

export interface Recording
{
  blob: Blob;
  frames: number;
  /** The video codec in the MP4: 'avc' (H.264), or what the browser had instead. */
  codec?: string;
}

/** Frames per second: smooth for a video, fewer for a GIF, which gets big fast. */
export const RECORD_FPS: Record<RecordFormat, number> = { mp4: 30, gif: 15 };

/** The sizes to choose from, in pixels; 'viewer' has the shape of the view on screen, as long
 *  as the longest side of a landscape one. */
export const RECORD_SIZES: Record<RecordFormat, Record<Exclude<RecordSizeId, 'viewer'>, [number, number]>> = {
  mp4: { landscape: [1920, 1080], square: [1080, 1080], story: [1080, 1920] },
  gif: { landscape: [800, 450], square: [600, 600], story: [450, 800] },
};

/** The size of a recording; 'viewer' from the view's width over height. Even, as H.264 has it. */
export function recordSize(format: RecordFormat, size: RecordSizeId, aspect: number): { width: number, height: number }
{
  const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));
  if (size !== 'viewer')
  {
    const [width, height] = RECORD_SIZES[format][size];
    return { width, height };
  }
  const longest = RECORD_SIZES[format].landscape[0];
  return (aspect >= 1)
    ? { width: longest, height: even(longest / aspect) }
    : { width: even(longest * aspect), height: longest };
}

/** The times in the clip (seconds) of the frames of a recording. */
export function recordTimes(duration: number, loop: AnimationLoopMode, fps: number, speed = 1): number[]
{
  if (!(duration > 0)) return [0];
  const step = speed / fps;
  if (loop === 'pingpong')
  {
    const count = Math.max(2, Math.round(2 * duration / step));
    return Array.from({ length: count }, (_, i) =>
    {
      const t = (i * 2 * duration) / count;
      return (t <= duration) ? t : 2 * duration - t;
    });
  }
  if (loop === 'loop')
  {
    const count = Math.max(1, Math.round(duration / step));
    return Array.from({ length: count }, (_, i) => (i * duration) / count);
  }
  const count = Math.max(1, Math.round(duration / step));
  return Array.from({ length: count + 1 }, (_, i) => (i * duration) / count);
}

/**
 * Record an animation of the model the viewer shows. `progress(done, total)` after every
 * frame; abort `signal` to stop, which rejects with its reason and writes nothing.
 */
export async function recordAnimation(
  viewer: AnimationFrameSource,
  name: string,
  options: RecordOptions,
  progress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Recording>
{
  const fps = options.fps ?? RECORD_FPS[options.format];
  const times = recordTimes(options.duration, options.loop, fps, options.speed ?? 1);
  return (options.format === 'gif')
    ? recordGif(viewer, name, options, fps, times, progress, signal)
    : recordMp4(viewer, name, options, fps, times, progress, signal);
}

async function recordMp4(
  viewer: AnimationFrameSource, name: string, options: RecordOptions, fps: number, times: number[],
  progress?: (done: number, total: number) => void, signal?: AbortSignal,
): Promise<Recording>
{
  const { Output, Mp4OutputFormat, BufferTarget, VideoSampleSource, VideoSample, QUALITY_HIGH, getFirstEncodableVideoCodec } = await import('mediabunny');
  const { width, height } = options;

  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width, height, quality: QUALITY_HIGH, frameRate: fps });
  if (!codec) throw new Error('This browser cannot encode video. Chrome, Edge, Safari and Firefox can.');

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const source = new VideoSampleSource({ codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  try
  {
    const yielded = yielder();
    const made = await viewer.renderAnimationFrames(name, { width, height, times, follow: options.follow ?? false }, async (canvas, i) =>
    {
      // taken from the canvas now, before the next paint clears it
      const sample = new VideoSample(canvas, { timestamp: i / fps, duration: 1 / fps });
      try { await source.add(sample); }
      finally { sample.close(); }
      progress?.(i + 1, times.length);
      await yielded();
    }, signal);
    if (!made) throw new Error(`The model on screen has no animation ${name}`);

    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) throw new Error('The video came out empty');
    return { blob: new Blob([buffer], { type: 'video/mp4' }), frames: times.length, codec };
  }
  catch (e)
  {
    if (output.state !== 'finalized') await output.cancel();
    throw e;
  }
}

/** How many frames, spread over the GIF, its palette is made from. */
const PALETTE_FRAMES = 6;

async function recordGif(
  viewer: AnimationFrameSource, name: string, options: RecordOptions, fps: number, times: number[],
  progress?: (done: number, total: number) => void, signal?: AbortSignal,
): Promise<Recording>
{
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const { width, height } = options;

  // the palette's frames first, then every frame with it
  const sampled = Math.min(PALETTE_FRAMES, times.length);
  const spread = Array.from({ length: sampled }, (_, i) => times[Math.floor((i * times.length) / sampled)]);
  const pixels = new Uint8ClampedArray(sampled * width * height * 4);
  let palette: number[][] = [];

  const copy = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
  const gif = GIFEncoder();
  const yielded = yielder();

  const made = await viewer.renderAnimationFrames(name, { width, height, times: [...spread, ...times], follow: options.follow ?? false }, async (canvas, i) =>
  {
    copy.drawImage(canvas, 0, 0);
    const { data } = copy.getImageData(0, 0, width, height);

    if (i < sampled)
    {
      pixels.set(data, i * data.length);
      if (i === sampled - 1) palette = quantize(pixels, 256);
      return;
    }

    const frame = i - sampled;
    gif.writeFrame(applyPalette(data, palette), width, height, {
      ...(frame === 0 ? { palette } : {}),
      // in hundredths of a second, rounded so that the frames add up to the right length
      delay: 10 * (Math.round(((frame + 1) * 100) / fps) - Math.round((frame * 100) / fps)),
    });
    progress?.(frame + 1, times.length);
    await yielded();
  }, signal);
  if (!made) throw new Error(`The model on screen has no animation ${name}`);

  gif.finish();
  return { blob: new Blob([gif.bytes() as BlobPart], { type: 'image/gif' }), frames: times.length };
}

/** A pause for the browser now and then, so the page paints the progress while it records. */
function yielder(every = 40): () => Promise<void>
{
  let last = performance.now();
  return async () =>
  {
    if (performance.now() - last < every) return;
    await new Promise(resolve => setTimeout(resolve, 0));
    last = performance.now();
  };
}
