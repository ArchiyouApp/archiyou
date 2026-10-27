import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { setActionLoop, bounceAtEnd } from '../src/viewer/animation-playback.js';

/**
 *  Back and forth as the viewer plays it: `action.time` is where the clip is, both ways, so
 *  the player's time, a seek and a change of mode all mean what they say.
 */

/** A part that moves 10 a second over a 3 second clip, played back and forth. */
function playing()
{
  const part = new THREE.Object3D();
  part.name = 'part';
  const clip = new THREE.AnimationClip('widths', 3, [new THREE.VectorKeyframeTrack('part.position', [0, 3], [0, 0, 0, 30, 0, 0])]);
  const mixer = new THREE.AnimationMixer(part);
  const action = mixer.clipAction(clip);
  mixer.addEventListener('finished', e => bounceAtEnd(e.action as THREE.AnimationAction));
  setActionLoop(action, 'pingpong');
  action.play();
  return { part, mixer, action };
}

/** Step the mixer, and where the part is against where the time says it is. */
function steps(play: ReturnType<typeof playing>, count: number, dt = 0.25)
{
  return Array.from({ length: count }, () =>
  {
    play.mixer.update(dt);
    return { time: play.action.time, x: play.part.position.x };
  });
}

describe('back and forth', () =>
{
  it('goes there and back, its time the time in the clip both ways', () =>
  {
    const play = playing();
    const trace = steps(play, 32);   // 8 s: there, back, and there again for 2 s
    trace.forEach(s => expect(s.x).toBeCloseTo(10 * s.time, 5));
    expect(Math.max(...trace.map(s => s.x))).toBeCloseTo(30, 5);   // the whole way
    expect(trace[23].time).toBeCloseTo(0, 5);                         // and back at 6 s
    // never a jump: a quarter of a second moves it 2.5 at most
    trace.slice(1).forEach((s, i) => expect(Math.abs(s.x - trace[i].x)).toBeLessThanOrEqual(2.5 + 1e-6));
  });

  it('a change of mode on the way back carries on from where it is', () =>
  {
    const play = playing();
    steps(play, 16);                                   // 4 s: on the way back, at 2 s in the clip
    const at = play.part.position.x;
    expect(at).toBeCloseTo(20, 5);
    setActionLoop(play.action, 'loop');
    const [next] = steps(play, 1);
    expect(next.x).toBeCloseTo(at + 2.5, 5);           // forward from there, no jump to the mirror
  });

  it('a seek on the way back shows that time', () =>
  {
    const play = playing();
    steps(play, 16);
    play.action.time = 0.5;
    play.mixer.update(0);
    expect(play.part.position.x).toBeCloseTo(5, 5);
  });
});
