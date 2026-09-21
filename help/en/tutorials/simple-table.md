---
title: A simple table
description: Boxes, moving and aligning, colours and your first parameter
level: beginner
order: 1
---

A table is a top and four legs: five boxes. Each step puts code in the editor and runs
it, so you see the model grow. Change the numbers as you go; **Next** continues from the
tutorial's code.

## Start with a box
<!-- highlight: code -->

The table top is a box of 1200 mm long, 700 mm deep and 30 mm thick. Every size in
Archiyou is in millimetres unless you say otherwise.

```js run
top = box(1200, 700, 30)
```

`top` is a name for the box, so later lines can use it.

## Lift the top
<!-- highlight: viewer -->

A new box sits in the middle of the world, half below the floor. Move it up to table
height with `moveZ`:

```js append
top.moveZ(735)
```

## Add a leg

A leg is a tall, thin box. Instead of calculating where it goes, **align** it: put the
leg's left-front-top corner on the top's left-front-bottom corner.

```js append
leg = box(60, 60, 720).align(top, 'leftfronttop', 'leftfrontbottom')
```

## Colour and names

Give the parts a colour and a name. Names show up in the scene tree, in tables and in
drawings.

```js append
top.color('orange').name('top')
leg.color('grey').name('leg')
```

## Four legs

Copy the leg and align each copy to another corner. A copy keeps the colour and the
name of the original.

```js append
leg.copy().align(top, 'rightfronttop', 'rightfrontbottom')
leg.copy().align(top, 'leftbacktop', 'leftbackbottom')
leg.copy().align(top, 'rightbacktop', 'rightbackbottom')
```

## Make it a parameter
<!-- highlight: params -->

A table should fit the room. Define `LENGTH` as a parameter: a slider appears, and the
code reads its value as `$LENGTH`. Drag the slider and watch the table follow.

```js run
$PARAMS.define('LENGTH', 'number', { label: 'Length', units: 'mm', default: 1200, minimum: 800, maximum: 2400, multipleOf: 10 })

top = box($LENGTH, 700, 30).moveZ(735).color('orange').name('top')
leg = box(60, 60, 720).align(top, 'leftfronttop', 'leftfrontbottom').color('grey').name('leg')
leg.copy().align(top, 'rightfronttop', 'rightfrontbottom')
leg.copy().align(top, 'leftbacktop', 'leftbackbottom')
leg.copy().align(top, 'rightbacktop', 'rightbackbottom')
```

## Done

You built a parametric table with boxes, `align` and one parameter. Try adding a
`WIDTH` parameter the same way, or continue with **Combining shapes**.
