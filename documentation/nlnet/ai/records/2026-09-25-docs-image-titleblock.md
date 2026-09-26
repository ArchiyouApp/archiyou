# Documents: image sizing, doc autocomplete, titleblock variables, viewer dimension labels

| | |
|---|---|
| Dates | 2026-09-25 → 2026-09-26 |
| Model | Claude Opus 5.5 (claude-opus-5-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: each change was asked for in the session, the agent explained the cause or proposed the change, the human approved it) |
| Human | Mark van der Net: wrote the prompts, found the problems by writing document scripts in the editor, chose to fix image sizing in the library rather than in the script, chose where the viewer tweaks are recorded, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

A group of small improvements to documents and their editor support, done one request at a time
in one session: images size themselves from their aspect ratio, `doc` chains get CodeMirror
autocompletion, the titleblock texts are named variables, and dimension labels in the 3D viewer
lose their units and get rounded corners. The same session then moved on to projections, which
has its own record (2026-09-25-projection-api).

## Prompts (verbatim, local time)

```
2026-09-25 15:01 +0200  Can you check why the image is not showing after it set pivot (0.5,0) ? 
                        
                        <pasted_content id="539b">
                        doc
                          .create('project')
                          .page('cover')
                          .image('https://cms.shopxyz.nl/uploads/URBUILD_63f105cc33.svg')
                          .width(0.5)
                          .pivot(0.5,0)
                          .position(0.5, 0.5)
                        </pasted_content id="539b">
2026-09-25 15:04 +0200  Yes implement auto size height or width for images
2026-09-25 15:14 +0200  Can you add code mirror autosuggestions to docs?
2026-09-25 15:33 +0200  Can you add named var to the docs titleblock (so 'title' should get titleblock:title, titleblock:designer etc
2026-09-25 15:40 +0200  Small UI tweak: Can you remove the units with the dimension lines? rect().autoDim(); ==> shows the dimension lines, but i dont want the mm in the viewer
2026-09-25 15:45 +0200  In the viewer can you add rounded corners (full rounded) to the dimension line labels?
2026-09-25 15:46 +0200  Where is the text size set for these labels?
2026-09-25 15:4x +0200  <pasted_content id="539b">
                        doc
                          .create('project')
                          .page('cover')
                          .image('https://cms.shopxyz.nl/uploads/URBUILD_63f105cc33.svg')
                          .width(0.3)
                          .pivot(0.5,0.5)
                          .position(0.5, 0.5)
                          .text('URHOUSE')
                          .pivot(0.5)
                          .width(0.5)
                          .position(0.5,0.35)
                        </pasted_content id="539b">

                         I try to center the text on the pivot. Is there already something like that in docs?
2026-09-25 15:51 +0200  Im trying to set the titleblock variable. Whats wrong? 
                        
                        <pasted_content id="539b">
                        doc
                          .create('project')
                          .page('cover')
                          .image('https://cms.shopxyz.nl/uploads/URBUILD_63f105cc33.svg')
                          .width(0.3)
                          .pivot(0.5,0.5)
                          .position(0.5, 0.5)
                          .text('URHOUSE', { size: '15mm' })
                          .pivot(0.5)
                          .contentAlign('center')
                          .position(0.5,0.35)
                          .text('preview', { size: '10mm' })
                          .pivot(0.5)
                          .contentAlign('center')
                          .position(0.5,0.25)
                          .text(`width: ${WIDTH}`, { size: '7mm' })
                          .pivot(0.5)
                          .contentAlign('center')
                          .position(0.5, 0.16)
                          .text(`depth: ${DEPTH}`, { size: '7mm' })
                          .pivot(0.5)
                          .contentAlign('center')
                          .position(0.5, 0.12)
                          .text(`roof height: ${ROOF_HEIGHT}`, { size: '7mm' })
                          .pivot(0.5)
                          .contentAlign('center')
                          .position(0.5, 0.08)
                          .text(`wall height: ${WALL_HEIGHT}`, { size: '7mm' })
                          .pivot(0.5)
                          .contentAlign('center')
                          .position(0.5, 0.04)
                          // walls
                          .page('components')
                          .text('COMPONENTS', { size: '15mm' })
                            .pivot(0.5,0.5).position(0.5,0.5)
                            .contentAlign('center')
                          // floor component
                          // TODO
                          // wall components
                          .merge(wallFrontComponentDocs.set('titleblock:title', 'TEST'))
                        </pasted_content id="539b">
                        
                         ===> ERROR at line 102: "wallFrontComponentDocs.set is not a function"
2026-09-25 20:30 +0200  For the AI disclosure grouping. Group the Doc/ImageContainer improvement, the projection/elevations improvements
2026-09-25 20:31 +0200  Base directory for this skill: /home/mvdnet/archiyou/archiyou/.claude/skills/ai-disclosure
                        
2026-09-25 22:42 +0200  Review should be: "Reviewed by author in editor with a variety of images"
2026-09-25 22:43 +0200  ok finalize the commit
2026-09-26 15:53 +0200  yes commit this
2026-09-26 16:09 +0200  yes
2026-09-26 16:21 +0200  yes commit and close the records
```

The prompt at 15:4x was not picked up by `prompts.py` (it starts with pasted content); it is
reproduced from the session.

## Plan (agent output, reviewed by the human before implementation)

No plan was written up front; each change followed a question.

### Image sizing

The image did not show after `.pivot(0.5, 0)` because an image container took the default
height of the whole content area, and the image sat at the top of that box (default content
align `['left','top']`): with the pivot at the bottom and the box a page tall, the image landed
above the page. Proposed fix, approved: when only one of width and height is given, the other
follows from the image's own aspect ratio (SVG `viewBox` or width/height attributes, PNG IHDR,
JPEG start-of-frame), so `pivot()` places the image itself. Both or neither set keeps the old
fitting. Found on the way and left alone: sizes in mm resolve against the page but are applied
to the content area, so `'20mm'` renders at about 18 mm.

### Doc autocomplete

Generate completion data for `Docs` (the `doc` global) and `Document` (what `doc.create()` and
its chain return) from the source, and resolve the type of a `doc` chain by walking it
backwards, across lines. Member completions also carry their JSDoc as info. The docs of
`pivot()` and `contentAlign()` were rewritten, since they now show in the editor (the old
`pivot()` doc said it was relative to the page content area).

### Titleblock variables

The titleblock's containers are named variables (`titleblock:title`, `titleblock:designer`,
`titleblock:designLicense`, `titleblock:manualLicense`, `titleblock:logoUrl`,
`titleblock:version`, `titleblock:metrics`, `titleblock:params`). A variable can hold several
containers, so one `set()` updates the titleblock on every page, and `merge()` combines them.
`labelblock()` takes a `vars` option, and an image container supports `set()` (its url).

### Viewer dimension labels

Metric dimension labels in the viewer show a bare number, as the drawings already did
(`showUnits: true` brings the unit back; imperial keeps its feet and inches). The labels are
fully rounded pills, from the `--wa-border-radius-pill` design token.

## Review and decisions by the human

- Chose the library fix for image sizing over the script workaround (`height()` or
  `contentAlign('bottom')`).
- Asked for the titleblock variables and then used them across a component merge; the error
  (`set` on the array `docs()` returns) was a script issue, answered in the session.
- Asked for the viewer tweaks and where the label text size is set (answered, not changed).
- Decided the grouping of this work for disclosure: documents and the viewer tweaks in this
  record, projections in their own.
- Chose the summary lines of the three commits from the agent's proposals (the viewer one
  reworded to "no units on dimension labels, rounded label corners"), and wrote the review line
  of the first: reviewed in the editor with a variety of images.
- Ordered the commits so the regenerated completion data, which also carries the projection
  API, lands after the projection commits.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| 8c9e804 | Docs: images size from their aspect ratio, titleblock texts as variables | 15:04 "Yes implement auto size height or width for images", 15:33 titleblock variables |
| 1b5b342 | Viewer: no units on dimension labels, rounded label corners | 15:40 units, 15:45 rounded corners |
| 917baa2 | Editor: autocomplete for doc chains | 15:14 "Can you add code mirror autosuggestions to docs?" |
| (this commit) | close the record | 20:30 grouping, 16:21 "yes commit and close the records" |
