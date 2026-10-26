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
* *Show code* shows the lines of the script that make the selected animation.
* The download icon at the top saves the model with its animations as a GLB. *Export to… ▸ GLB* in the main menu includes the animations of the script too.

The editor makes the animations only while the tool is open, so with the tool closed it runs your script as fast as without them.

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
animator.create('widths').param('WIDTH', { from: 400, to: 800, frames: 9 }).duration(3);
```

An animation can also sweep a parameter. Every frame is a run of the whole script with other values, so it is not made by an ordinary run: a single run only declares it. A sweep has at most 48 frames, 12 when you do not say.
