---
name: archiyou
description: Model in Archiyou, parametric CAD scripts in JavaScript. Use when asked to model, design or change an object (furniture, a part, a building element) as an Archiyou script, including from sketches or photos, and to check such a script by running it.
---

# Modelling with Archiyou

An Archiyou model is a plain JavaScript file (`<name>.js`) that builds geometry with Archiyou's
functions. You check it with the `archiyou` CLI. **How the CLI is called here is in `AGENTS.md`**
(for example `npx @archiyou/cli`; in the Archiyou repo itself `pnpm -s archiyou`). Below it is written
as `archiyou`.

## 1. Conventions the API reference does not tell you

```js
// chair.js
units('mm');                                   // model unit; millimetres unless you say otherwise
$PARAMS.define('WIDTH', 'number', { min: 400, max: 800, step: 10, default: 600, label: 'Width' });
$PARAMS.define('ARMS', 'boolean', { default: true });

LEG = 40;                                      // implicit globals: no let/const/var needed
layer('frame');                                // shapes made after this go in the layer 'frame'
legFL = box(LEG, LEG, 450).moveZ(225).name('legFrontL').color('#8a6a4a');
seat = boxBetween([0, 0, 450], [$WIDTH, 500, 470]).name('seat');   // from one corner to the other
print('seat area', seat.area());               // shows in the run summary
```

- No `import`, no `await`: the script runs top to bottom in Archiyou's scope.
- Parameters: `$PARAMS.define(NAME, type, options)`, then use `$NAME`. Types: `number`, `boolean`,
  `options` (`{ options: [...] }`), `text`, `list`. Give every number a `min`, `max` and `default`
  (`min`/`max`/`step` are short for `minimum`/`maximum`/`multipleOf`; both work).
- **Name every part** with `.name()`. A shape assigned to a variable is named after it; shapes made in
  a loop or `.map()` show up as `Mesh[3]`, and the summary, the clash report and the inventory check
  refer to parts by name.
- Where shapes start: `box()` is centred on the origin; `cylinder(radius, height)` is centred in x and
  y but **stands on z = 0** (its API text says centred: it is not); `boxBetween(a, b)` spans two corners.
  When in doubt, run and read the part's size and the `min` in the summary.
- Helper functions: pass what they need as arguments. Variables from outside are locked in when the
  function is defined (the run warns about this).
- `.hide()` construction geometry (helper lines, guides): it stays out of the views, the size and the
  checks.
- **Place parts against each other with `moveUntil(other, direction, gap = 0)`**: it moves a part
  ('up', 'down', 'left', 'right', 'front', 'back' or a vector) until it touches the true shape of
  `other`, so a bar under a tilted seat or behind a leaning board needs no angles worked out:
  `crossbar(...).moveUntil(seat, 'up')`, `topBar.moveUntil(back, 'front')`. Prefer it over
  computing positions with sin/cos; it throws when the part would never touch `other`.
- Shapes you only cut or merge with stay in the model: `a.subtract(b)` and `a.union(b)` change `a` and
  leave `b`. Make `b` with `.tmp()`, as in
  `plate.subtract(cylinder(5, 40).move(15, 15, -10).tmp())` (a hole through a 20 mm plate at z 0–20).
- The mesh kernel is the default. A few primitives (spiral, helix, cone, basePlane) need `--kernel brep`.
- **Axis convention** (the checks assume it): x is width, y is depth with the front at y = 0 and the
  back positive, z is up, the floor is z = 0.

## 2. The loop

1. Write or change `<name>.js`.
2. `archiyou run <name>.js` and **read the summary first**: does the size match what was asked, are the
   parts there with sensible sizes and volumes, any `print:` values off?
3. Open `views.png` (the path is in the summary) **once** per round and look for what numbers cannot
   show: wrong shapes, parts in the wrong place. Do not loop on images.
   When the request gives a size, add `--expect WxDxH` (e.g. `--expect 200x120x20`): the summary then
   says which axis is off. `print()` the values that matter (a volume, an angle) to check them too.
4. Fix and run again. Test a variant with `-p NAME=value`.
5. Before you finish: `archiyou sweep <name>.js --clash` must say `sweep clean`. It runs the defaults
   and every parameter at its minimum and maximum. When parameters work together (an opening and its
   sill, a seat height and the arm height), add `--corners`: every combination of the extremes. Read
   the `print` column too: clean is not the same as sensible (a 28° seat builds fine and is still
   wrong). Parts that only touch do not count as a clash.

A failed run prints `ERROR line N: message` with the lines around it, and exits 1.

## 3. From sketches and photos

Photos carry no scale, show the object in perspective, and hide parts. The most common failure is
modelling what an object of that kind usually looks like instead of what the photos show. So:

**First, a brief, confirmed by the user before any script:**
- *Within reach?* Straight members, boards and simple slopes model well. Curved or organic shapes and
  upholstery will be an approximation: say so.
- *Coverage:* which sides the photos show (front, side, ¾, top, back) and which are missing. With fewer
  than three sides, ask for more photos.
- *Scale:* one known dimension, from the user, a published size, or a standard (dining seat 450, lounge
  seat 330–380, arm about seat + 220, table 740, counter 900). State which.
- *Inventory:* every part with its direction and what it rests on or touches. Count in the photo that
  shows most, then check the count in every other photo. Look for cues in the design itself (marked
  ends, repeated members). Show it to the user as a marked photo:
  `archiyou mark <photo> marks.json` with `[{ "at": [x, y], "label": "front leg" }, ...]`
  (x, y as fractions of the photo, 0–1).
- *Parameters:* names and ranges.

**Write the inventory as `<name>.inventory.json`**, with the part names you will use in the script.
For example a bench with four legs, two aprons, a stretcher that hangs between the aprons, and a top:

```json
{
  "count":    { "leg*": 4, "apron*": 2, "stretcher": 1, "top": 1 },
  "axis":     { "leg*": "z", "apron*|stretcher": "x" },
  "floor":    ["leg*"],
  "notFloor": ["stretcher"],
  "relations": [["top", "above", "leg*|apron*"], ["apronFront", "inFront", "apronBack"], ["stretcher", "touches", "apron*"]]
}
```

Globs match part names (`*`, `?`, `|` between alternatives). Relations: `behind`, `inFront`, `above`,
`below`, `leftOf`, `rightOf` (from the bounding boxes), and `touches` (the real shapes, for solids).

**Then model, and check every round against the photos:**
- Find the view that matches each photo. A view is a camera direction `cam:x,y,z`: from the model to
  the camera, z up. The named views are the same directions: `front` = `cam:0,-1,0`,
  `back` = `cam:0,1,0`, `left` = `cam:-1,0,0` (the −x side; on screen the front is then on the right),
  `right` = `cam:1,0,0`, `top` = `cam:0,0,1`, `iso` = `cam:-1,-1,1` (front left, above).
  `archiyou run <name>.js --views around` draws eight directions at 45° steps, 30° up, each labelled
  with its `cam:`; start from the closest and adjust (more x turns the camera to the right side, more z
  raises it). Keep the direction for the session.
- `archiyou run <name>.js --check <name>.inventory.json --overlay <photo>@<view>@x0,y0,x1,y1`
  draws the model over the photo, fitted into the object's rectangle in the photo (fractions or pixels).
  It is fitted on height: a difference in width means the proportions differ, and the summary gives it
  as a percentage. Lines that run past the photo's parts, or parts without lines, are errors. Each
  overlay is also written full size (`overlay-1-<photo>.png`, path in the summary) to read the lines.
- The overlay is orthographic; a photo is not. A photo taken from a distance with a long lens (a side
  view, a product shot) matches well: use it for proportions. In a close-up photo near parts look
  larger than far ones: compare positions there (which part is in front of which, where a post ends),
  not lengths at different depths.
- `--ref <photo>` puts a photo on the sheet as is.
- Fix the mismatches the check lists before anything else.
- Pick one driving part (often the largest board or the frame) and place the others against its
  faces with `moveUntil()`, not at computed coordinates; then they stay attached when parameters
  change.
- Finish with `archiyou sweep <name>.js --clash --check <name>.inventory.json`.

## 4. Where to look things up

| Need | Command |
| --- | --- |
| A function or method: signature, parameters, example | `archiyou api box`, `archiyou api Mesh.rotateAround` |
| Every member of a class | `archiyou api Mesh` |
| The guide and tutorials | `archiyou docs` (list), `archiyou docs csg`, `docs sketching`, `docs topology` |
| A complete parametric script | `archiyou examples programmaticparams`; timber: `examples timberwallopenings` |
| All example scripts | `archiyou examples` |

Guide topics worth knowing: `csg` (booleans), `sketching` (2D to 3D), `topology` (selecting faces and
edges), `model-org` (layers, names, colours), `surface`.

## 5. When something goes wrong

| Symptom | Fix |
| --- | --- |
| `x is not a function` | the run suggests close names; `archiyou api <name>` |
| A `-p` value has no effect | the name must match the `$PARAMS.define` name; the value must be within min/max |
| The size is far off | check `units()` and which axis is which (section 1) |
| A part has zero volume | it is a 2D curve or face, not a solid; extrude it or use a solid primitive |
| Extra parts, or the size too large, after a boolean | the shape you cut with is still there: `.tmp()` it |
| Extra parts after a union | the shape you merged is still there: `.tmp()` it |
| `clashes` lists pairs | parts run through each other: move one against the other's face |
| `check` lists mismatches | the model differs from the inventory: fix the model, or the inventory if the photos say otherwise (ask) |
| A primitive is missing | some exist only in the brep kernel: `--kernel brep` |
| Unnamed parts | `.name()` them |
| `$module('x'): no such module` | the script uses a script module: `--modules <dir>` with the module's directory (or the one that holds it); it must be built (`dist/bundle.js`) |

## 6. Output files

`archiyou run` writes `model.glb` and `views.png` to `--out` (default `<tmp>/archiyou/<name>/`), and each
overlay full size. The sheet shows the photos and overlays first, then the views; front, side and top
views are drawn at one scale so their sizes compare. `--json` prints everything as one object; `--parts`
lists every part of a large model. `mark` writes to `--out` too (default `<tmp>/archiyou/marks/`).
