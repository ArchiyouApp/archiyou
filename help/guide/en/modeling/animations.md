---
title: "Animations: the model in motion"
order: 312
---
An **animation** shows your model over time: its parts flying in from a pile of stock, a door swinging open, the camera circling round. It is saved with the model, in the GLB file, so it plays in the Archiyou viewer, in an embedded configurator, in Blender and in most other glTF viewers.

An animation never changes your model. It says where the parts *are* at each moment, and the finished model is always where it ends up or starts from.

## A standard animation

Most models need no animation code at all. Ask for one of the standard animations by name:

```js
animator.preset('flyin');
```

| Name | What it shows |
|---|---|
| `flyin` | the parts lie in stacks of stock in front of the model and fly to where the model has them, lowest first |
| `build` | the parts appear one after another, lowest first, each dropping into place |
| `exploded` | the model comes apart along its explode directions |
| `layout` | every shape laid flat in a row |
| `turntable` | the camera circles the model |
| `assembly` | the first instructable of your script, played step by step |

Tune one with options, or with more calls after it: those win.

```js
animator.preset('flyin', { duration: 6, stagger: 0.2, turntable: 90 });
animator.preset('turntable', { degrees: 180, duration: 5 });
animator.preset('flyin', { name: 'flyin-slow' }).duration(10);
```

### Written out in full

When you add a standard animation in the editor's Animation tool (see below), it is written into your script in full instead: the keys of every shape, the camera key by key, all worked out from the model, so they follow its parameters. Change any of it. The turntable, for example:

```js
turntable = animator.create('turntable').loop('loop');
{
    const seconds = 8;
    const model = all().bbox();
    const centre = model.center();
    const distance = 2.5 * Math.max(model.width(), model.depth(), model.height());
    const up = toRad(35);  // how high it looks from
    turntable.duration(seconds);
    Array.from({ length: 37 }, (_, i) => i * 10).forEach(degrees =>  // a key every 10 degrees
    {
        const round = toRad(degrees - 135);  // from the front left, as an iso view
        turntable.camera(seconds * degrees / 360, [
            centre.x + distance * Math.cos(up) * Math.cos(round),
            centre.y + distance * Math.cos(up) * Math.sin(round),
            centre.z + distance * Math.sin(up),
        ], centre, 'linear');
    });
}
```

The fly-in asks where each shape lies in the stacks of stock with `animator.layout('partstack')`, and keys it from there to its place:

```js
flyin = animator.create('flyin').duration(3);
animator.layout('partstack').forEach((stock, i, stacks) =>
{
    const leave = 1.8 * i / Math.max(1, stacks.length - 1);
    const lying = { position: stock.position, rotation: stock.rotation };
    flyin.key(0, stock.shape, lying);
    flyin.key(leave, stock.shape, lying);
    flyin.key(leave + 1.2, stock.shape, {}, 'easeOut');
});
```

`animator.layout()` takes `'partstack'`, `'row'` (laid flat in a row) or `'exploded'`, and gives each shape with its `position` and `rotation` in that layout: a pose for `key()`. It lays the model out every time the script runs, so use it in the code of an animation.

## Your own animation

```js
door = box(800, 40, 2000).name('door');
handle = cylinder(15, 120).rotateX(90).moveTo(700, -60, 1000);

swing = animator.create('swing').duration(2).loop('pingpong');
swing.key(0, door, {});                                          // as modelled
swing.key(2, door, { rotation: [0, 0, -95], pivot: [0, 0, 0] }, 'easeInOut');
swing.key(0, handle, {});
swing.key(2, handle, { rotation: [0, 0, -95], pivot: [0, 0, 0] }, 'easeInOut');
```

A **key** is a pose of a part at a time, in seconds. Between two keys the part travels with the easing of the second one: `linear`, `easeIn`, `easeOut`, `easeInOut` (the default) or `spring`. Before its first key a part holds that key's pose, so start with `key(0, part, {})` to start from the model as it is.

A pose can have:

* `move: [x, y, z]`: how far the part moves from where the model has it
* `position: [x, y, z]`: where its centre goes
* `rotation: [x, y, z]`: degrees about each axis (or a quaternion `[x, y, z, w]`)
* `pivot`: what it turns about, a point or a shape. Without one it turns about its own centre
* `scale`: a factor, or one per axis

A part can be a shape, a collection, a part label like `'A'` or `'A#2'` (as an instructable labels them) or the name of a layer.

### Show, hide, colour and fade

```js
swing.hide('A', 0).show('A', 1);               // hidden until 1 s
swing.fade('frame', 0, 1, [0, 1]);             // from invisible to as modelled
swing.highlight(door, 0.5, 1.5, 'orange');     // orange for a second, then back
swing.color(handle, 1, '#2060c0');             // a colour key
swing.opacity(handle, 2, 0.3);                 // an opacity key
```

Colour and opacity are written with the glTF extension `KHR_animation_pointer`. Viewers that do not read it still play the motion; the parts then keep their own colour.

### Start or end laid out

```js
animator.create('stock').from('partstack').duration(4).order('bottomUp').stagger(0.1);
animator.create('apart').to('exploded').duration(2).loop('pingpong');
```

`from()` starts laid out and ends as modelled; `to()` does the reverse. The layouts are `partstack` (the parts as stacks of stock, the way a cut list has them), `row` and `exploded`. `order()` says which part leaves first (`bottomUp`, `topDown`, `scene` or `stack`) and `stagger()` how many seconds lie between one part and the next, or with `{ last: 0.6 }` when the last part leaves, as a part of the whole. `only()` lays out a few parts and leaves the rest.

```js
animator.create('assemble').build().duration(5);   // parts appear one by one, dropping into place
```

### The camera

```js
swing.turntable(90);                          // turn a quarter round while it plays
swing.camera(0, 'front').camera(2, [-1, -1, 1]);  // or keys: a side, a direction or a point
```

The file then carries a camera that follows the animation.

### An instructable as an animation

```js
manual = docs.instruct('assembly');
// … its steps …
animator.create('assembly-movie').steps('assembly');
```

Its steps become chapters, and parts stay hidden until the step that brings them in.

## Play it in the editor

Open the **Animation** tool (the clapperboard on the right) to manage the animations of your model.

* **Add** one: pick a standard animation, or *New animation* for keys of your own, and press *Add*. Its code goes at the end of your script, written out in full, and it plays as soon as the script has run. Change the code, and the animation follows.
* The list holds every animation of the script, the ones you added and the ones you wrote. **Rename** one with the pencil, **delete** one and its code with the bin. Both change your script; *Ctrl+Z* in the code editor takes it back.
* Click one to select it. Play, pause and drag the slider to go through it; the icons next to it play it once, over and over, or back and forth, and the gauge sets the speed.
* An animation with a camera of its own (a `turntable()`, or `camera()` keys) is seen *through its camera*; switch that off to look round yourself.
* The steps of an instructable show as chapters; click one to go there.
* A parameter sweep (see below) shows *Make it*: the editor runs the script once per frame, merges the frames into one model and plays it. *Stop* goes back to your model; play again until the script runs again.
* *Show code* shows the lines of the script that make the selected animation.
* The icons at the top: the cube saves the model with its animations as a GLB (the sweep while one is shown); the video file and the moving picture record the selected animation as an MP4 video or an animated GIF (see below). *Export to… ▸ GLB* in the main menu includes the animations of the script too.

The editor makes the animations only while the tool is open, so with the tool closed it runs your script as fast as without them.

## Record a video or a GIF

The Animation tool records the selected animation as the viewer shows it: in the view style you picked, with its edges, fades, grid and shadows, and through its own camera when you look through it, or from your view when you don't. Pick the video file icon for an MP4 video, or the moving picture for an animated GIF, and a size:

| Size | MP4 | GIF |
|---|---|---|
| Landscape | 1920 × 1080 | 800 × 450 |
| Square | 1080 × 1080 | 600 × 600 |
| Story | 1080 × 1920 | 450 × 800 |
| As the viewer | the shape of the viewer, 1920 on its longest side | 800 on its longest side |

It records as it plays: once, as a loop that runs on seamlessly, or there and back, at the speed you set (at 0.5× the video is twice as long). It does not record in real time but frame by frame, 30 a second for a video and 15 for a GIF, so it comes out the same on a slow computer as on a fast one, usually faster than it plays. The viewer shows the frames as they are made, and *Cancel* stops it. When a picture has another shape than the viewer, it shows at least what the viewer shows; dimension labels and handles are not in it.

A video is H.264, which phones, social media and video editors take. A GIF takes one palette of at most 256 colours for the whole clip, and gets big quickly: keep it short and small.

## In a configurator

A published configurator offers the animations of its model in the viewer menu. Its link can play one as soon as the model is shown, through its own camera when it has one:

```
/configurators/you/shelf:1.0?ui.animation=flyin&ui.loop=1
```

`ui.animation` names one the script declares, or a standard one (`flyin`, `build`, `exploded`, `layout`, `turntable`, `assembly`); `ui.loop` is `1` (over and over), `0` (once) or `pingpong` (back and forth), and without it the animation plays as it says. The page a configurator is embedded in can play one with a command, and stop it with `name: null`:

```js
frame.contentWindow.postMessage({ source: 'archiyou-host', version: 1, type: 'animate', name: 'turntable', loop: 'loop' }, '*');
```

A configurator makes only the animations it is asked for. The one its link names is made with the model; one a command asks for later takes a run to make the first time, and plays at once after that.

## Export an animation

Animations are made only when you ask for them, so a script with animations runs as fast as one without. Ask for them on the model's GLB:

| Output | Animations in it |
|---|---|
| `default/model/glb` | none |
| `default/model/glb?animations=flyin,swing` | those, declared or standard |
| `default/model/glb?animations=declared` | every animation the script declares |
| `default/model/glb?animations=*` | those and every standard one |

An animation that cannot be made, for example a key after its end or an `assembly` without an instructable, is said in the console and left out. The rest of the model exports as usual.

## Parameters over time

```js
$PARAMS.define('WIDTH', 'number', { default: 600, minimum: 300, maximum: 1200 });
board = box($WIDTH, 250, 18).moveTo(0, 0, 300).name('board');
left = box(18, 250, 300).moveTo(-$WIDTH / 2, 0, 150).name('side');
right = box(18, 250, 300).moveTo($WIDTH / 2, 0, 150).name('side');

animator.create('widths').param('WIDTH', { from: 300, to: 1200, frames: 6 }).duration(3).loop('pingpong');
```

An animation can also sweep a parameter: the model with each of its values in turn. Every frame is a run of the whole script with that frame's values, so an ordinary run only declares it. Make it in the Animation tool: select it and press *Make it*. Or on the command line: `archiyou animate shelf.js --out shelf.glb`.

The frames are merged into one GLB, part by part:

* a part that keeps its mesh and only changes size (the board) grows smoothly from frame to frame;
* a part that only moves (the sides) glides from place to place;
* a part whose mesh changes (a box that becomes a sphere) switches at each frame, like a flipbook.

Give `param()` a list of values, or `{ from, to, frames }`; several `param()` calls change together, frame by frame. A sweep has at most 48 frames, 12 when you do not say: every frame is a run of the whole script.
