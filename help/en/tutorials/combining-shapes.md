---
title: Combining shapes
description: Subtract, union and intersect shapes to make new ones
tags: beginner, modeling
thumbnail: combining-shapes.webp
order: 2
---

Complex parts are often simple shapes combined: a plate minus a few holes, two blocks
joined into one. This is called constructive solid geometry. Each step here starts
fresh, so you can compare the results.

## Two shapes

A cube and a sphere that overlap.

```js run
cube = box(200, 200, 200).color('orange')
ball = sphere(130).color('blue')
```

## Subtract

`subtract` cuts the second shape out of the first. The sphere is used up by the cut.

```js run
cube = box(200, 200, 200).color('orange')
cube.subtract(sphere(130))
```

## Union

`union` joins shapes into one.

```js run
cube = box(200, 200, 200).color('orange')
cube.union(sphere(130))
```

## Intersect

`intersect` keeps only the part the two shapes share.

```js run
cube = box(200, 200, 200).color('orange')
cube.intersect(sphere(130))
```

## A plate with holes

A practical case: a plate with two holes. A cylinder that is taller than the plate cuts
straight through it.

```js run
plate = box(300, 200, 20).color('grey')
hole = cylinder(15, 40)
plate.subtract(hole.copy().move(-100, 0, 0))
plate.subtract(hole.copy().move(100, 0, 0))
hole.hide()
```

## Done

`subtract`, `union` and `intersect` are the three ways to combine shapes. Try making
the holes bigger, or cut a slot with a long thin box.
