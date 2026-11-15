# Document switcher fix and Pipeline.show()

| | |
|---|---|
| Dates | 2026-11-09 → 2026-11-16 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a bug report, then a proposal in the conversation) |
| Human | Mark van der Net: reported the switcher bug on ur_house_detailed, asked how to test a pipeline in the model, approved the proposed `.show()`, wrote the prompts, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-11-09 19:58 +0100  There is a bug in doc switcher (i tried in ur_house_detailed) and selected projectoverview => document is not changed (shows only the project drawings)
2026-11-09 21:13 +0100  is there a way to test a pipeline. For example $pipeline('techdraw').run(); To show the results in main model
2026-11-09 21:15 +0100  ok good idea
```

## Plan (agent output, reviewed by the human before implementation)

### 1. Document switcher

The document viewer listened for `wa-change` on its `wa-select`; WebAwesome 3 never fires it,
so picking another document (projectoverview in ur_house_detailed) did nothing. Listen for
`change` and mark the selected option, as the admin and publish menus already do.

### 2. Pipeline.show()

There is no way in a script to see a pipeline's output in the model; the agent proposed a
debug `.show()` and the human approved it ("ok good idea"):

- `$pipeline('techdraw', fn).show()` marks the pipeline.
- After the script, before the state and outputs are made, the Runner runs the shown
  pipelines (all first, so one does not see another's copies) and puts copies of the shapes
  each made in a model layer `<name> (pipeline)`, with its dimensions. Nodes that only
  reference a model shape it returned are skipped. The pipeline's own output stays whole.
- A console line says it is shown, to take it out when done.
- The detached-copy helper of the Layouter is shared for this.
- Tests in runner.pipeline.test.ts; a section in the pipelines guide.

## Review and decisions by the human
- Reported the switcher bug on ur_house_detailed.
- Asked for a way to see a pipeline's result in the model; approved the proposed `.show()` instead of a `.run()` in the script ("ok good idea").
- Tried `.show()` on ur_house_sketch the next day: it showed nothing there because its pipeline failed on brep, which became the unit 2026-11-10-foldout-view-brep.
- 2026-11-16: had both committed with the other uncommitted work of the tree; the pipeline tests pass.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| a118508 | Document viewer: the document switcher switches again | 19:58 |
| dbfca71 | Pipelines: show() puts what a pipeline makes in the model | 21:13, 21:15 |
