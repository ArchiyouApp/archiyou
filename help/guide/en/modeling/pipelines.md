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
