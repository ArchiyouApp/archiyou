---
title: "Pipelines: drawings and other outputs"
order: 311
---
Your script makes a model. Often you also want something made *from* that model: the drawings of it, a cutting plan of its parts, an offer. A **pipeline** is a named step that runs after the model and makes such an output, kept apart from the model itself.

## Make a pipeline

```js
b = box(1000, 500, 300);

$pipeline('drawings', function()
{
    iso = all().iso();
    front = all().elevation('front').autoDim();
    return { iso, front };
});
```

What the pipeline **returns** is its output: here two layers, `iso` and `front`. A pipeline that returns nothing outputs the shapes it made.

A pipeline reads everything of your script: its shapes, variables and functions. What it makes stays with the pipeline:

* the shapes it makes are not added to the model
* the variables it assigns are its own: two pipelines can both have an `iso`
* the dimensions it adds belong to its output

One thing it cannot undo: changing a shape of the model itself (`b.move(100)`). Make a copy first (`b.copy().move(100)`).

## See and export a pipeline

When your script has pipelines, a chip shows next to the run button. Pick a pipeline there and the viewer shows only its output; a flat output like a drawing is shown straight on, without perspective. Pick *Model* to go back.

*Export to…* in the main menu exports what you picked. So for a drawing pipeline, *Export to… ▸ DXF* gives you the drawings as DXF, with a layer per returned key.

## Pipelines in documents

A document can show what a pipeline makes. Give it the name of the pipeline and refer to the returned keys in its views:

```js
docs.create('spec')
    .pipeline('drawings')
    .page('main')
    .view('iso').shapes('iso')
    .view('front').shapes('front');
```

You can also give the document the function itself. It then becomes a pipeline named after the document (`spec` here), which you can pick and export like any other:

```js
docs.create('spec')
    .pipeline(function(){ return { iso: all().iso() } })
    .page('main')
    .view('iso').shapes('iso');
```

A pipeline only runs when one of its outputs is asked for, or a document that uses it is made, and then only once.

## How drawings look

A drawing writes what each line is as a class: `cut` for what a section cuts through, `visible`, `silhouette` for the outline, `hidden`, `dashed`. It also writes what the shape is: the classes you give it with `addClass()`, and the name and group of its material (`osb`, `wood`). The **styler** draws those classes, in millimeters on paper, so a line has the same weight at 1:20 as at 1:100:

```js
stud = box(38, 184, 2400).addClass('timber');
insulation = box(500, 184, 2400).moveX(300).addClass('insulation');

styler.set('.cut', { weight: 0.5 });                      // every cut line 0.5mm
styler.set('.cut.insulation', { fill: '#eeeeee' });       // cut insulation filled grey
styler.set('.hidden', { visible: false });                // no hidden lines

$pipeline('plan', function()
{
    return { plan: all().section([0, 0, 1000]) };
});

docs.create('plan').pipeline('plan')
    .page('main').view('plan', { scale: '1:20' }).shapes('plan')
    .style({ '.cut.timber': { weight: 0.7 } });           // this view only
```

A rule has `weight`, `color`, `fill`, `dash` (mm on paper, like `[3, 2]`), `opacity` and `visible`. The rule with more classes wins (`.cut.timber` over `.cut`), and between rules with as many classes the later one. A document draws in the styler's ink, not in the colours of the model: say `color: 'model'` in a rule to draw a line in its model colour.

## Pipelines of a component

A component's pipelines are yours to use too: pick one before you take its model or documents.

```js
cutting = $component('./panel').pipeline('cut').model();     // what pipeline 'cut' of the component returns
sheets = $component('./panel').pipeline('cut').docs();       // the documents that use it
```

## Outputs by path

Outside the editor (the API, the publish menu, components) outputs are asked for by path: `pipeline/category/name/format`. The model is the `default` pipeline:

* `default/model/glb`: the model
* `drawings/model/dxf`: the output of pipeline `drawings` as DXF
* `drawings/docs/*/pdf`: the documents that use `drawings`
* `default/docs/*/pdf`: all documents
