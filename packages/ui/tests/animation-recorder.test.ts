import { describe, it, expect, vi, afterEach } from 'vitest';

import { recordTimes, recordSize, recordAnimation } from '../src/viewer/animation-recorder.js';
import type { AnimationFrameSource } from '@archiyou/editor/src/state/viewer';

/**
 *  The recorder's timing and sizes, and a GIF made from frames of a stand-in viewer: the
 *  encoding itself, without WebGL. MP4 needs the browser's WebCodecs, so it is checked there.
 */

describe('the frames of a recording', () =>
{
  it('once: from the start to the last frame, that included', () =>
  {
    const times = recordTimes(2, 'none', 30);
    expect(times.length).toBe(61);
    expect(times[0]).toBe(0);
    expect(times[60]).toBeCloseTo(2, 9);
    expect(times[1]).toBeCloseTo(1 / 30, 9);
  });

  it('a loop leaves the last frame out: the first one comes after it', () =>
  {
    const times = recordTimes(2, 'loop', 30);
    expect(times.length).toBe(60);
    expect(times[59]).toBeCloseTo(2 - 1 / 30, 9);
  });

  it('back and forth goes there and back again', () =>
  {
    const times = recordTimes(2, 'pingpong', 30);
    expect(times.length).toBe(120);
    expect(times[60]).toBeCloseTo(2, 9);
    expect(times[119]).toBeCloseTo(1 / 30, 9);
    expect(times[30]).toBeCloseTo(times[90], 9);
  });

  it('at half speed it takes twice as many frames', () =>
  {
    expect(recordTimes(2, 'none', 30, 0.5).length).toBe(121);
    expect(recordTimes(2, 'loop', 15, 2).length).toBe(15);
  });

  it('a clip without length is one frame', () =>
  {
    expect(recordTimes(0, 'loop', 30)).toEqual([0]);
  });
});

describe('the size of a recording', () =>
{
  it('has fixed sizes for each format', () =>
  {
    expect(recordSize('mp4', 'landscape', 1)).toEqual({ width: 1920, height: 1080 });
    expect(recordSize('mp4', 'story', 1)).toEqual({ width: 1080, height: 1920 });
    expect(recordSize('gif', 'square', 1)).toEqual({ width: 600, height: 600 });
  });

  it('as the viewer: its shape, as long as a landscape one, in even pixels', () =>
  {
    expect(recordSize('mp4', 'viewer', 1.5)).toEqual({ width: 1920, height: 1280 });
    expect(recordSize('mp4', 'viewer', 0.5)).toEqual({ width: 960, height: 1920 });
    const odd = recordSize('gif', 'viewer', 800 / 451);
    expect(odd.width).toBe(800);
    expect(odd.height % 2).toBe(0);
  });
});

describe('a GIF', () =>
{
  afterEach(() => vi.unstubAllGlobals());

  /** A viewer whose frame at time t is one colour, red over time. */
  function standIn(width: number, height: number)
  {
    const asked: number[][] = [];
    let shown = 0;
    vi.stubGlobal('OffscreenCanvas', class
    {
      getContext()
      {
        return {
          drawImage: () => undefined,
          getImageData: () =>
          {
            const data = new Uint8ClampedArray(width * height * 4);
            Array.from({ length: width * height }, (_, p) => data.set([Math.round(255 * shown), 40, 80, 255], p * 4));
            return { data };
          },
        };
      }
    });
    const source: AnimationFrameSource = {
      aspect: () => width / height,
      renderAnimationFrames: async (_name, options, frame) =>
      {
        asked.push(options.times);
        await options.times.reduce<Promise<void>>(async (previous, t, i) =>
        {
          await previous;
          shown = t / 2;
          await frame({} as HTMLCanvasElement, i);
        }, Promise.resolve());
        return true;
      },
    };
    return { source, asked };
  }

  it('is a GIF89a that loops, a frame per time, its palette from frames spread over it', async () =>
  {
    const { source, asked } = standIn(8, 6);
    const progress: number[] = [];
    const recording = await recordAnimation(source, 'fade', {
      format: 'gif', width: 8, height: 6, duration: 2, loop: 'loop',
    }, done => progress.push(done));

    expect(recording.frames).toBe(30);
    expect(recording.blob.type).toBe('image/gif');
    // the palette's six frames first, then every one
    expect(asked[0].length).toBe(6 + 30);
    expect(progress[progress.length - 1]).toBe(30);

    const bytes = new Uint8Array(await recording.blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
    expect(new TextDecoder().decode(bytes.slice(0, 64))).toContain('NETSCAPE2.0');

    // the graphic control blocks: one per frame, their delays adding up to the 2 seconds
    const delays = Array.from(bytes).flatMap((b, i) =>
      (b === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) ? [bytes[i + 4] | (bytes[i + 5] << 8)] : []);
    expect(delays.length).toBe(30);
    expect(delays.reduce((a, b) => a + b, 0)).toBe(200);
  });

  it('stops when it is cancelled, and makes nothing', async () =>
  {
    const { source } = standIn(4, 4);
    const controller = new AbortController();
    controller.abort();
    const failing: AnimationFrameSource = {
      ...source,
      renderAnimationFrames: async (name, options, frame, signal) =>
      {
        signal?.throwIfAborted();
        return source.renderAnimationFrames(name, options, frame, signal);
      },
    };
    await expect(recordAnimation(failing, 'fade', { format: 'gif', width: 4, height: 4, duration: 1, loop: 'none' }, undefined, controller.signal))
      .rejects.toThrow();
  });

  it('says so when the model does not carry the animation', async () =>
  {
    const source: AnimationFrameSource = { aspect: () => 1, renderAnimationFrames: async () => false };
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return {}; } });
    await expect(recordAnimation(source, 'gone', { format: 'gif', width: 4, height: 4, duration: 1, loop: 'none' }))
      .rejects.toThrow(/no animation gone/);
  });
});
