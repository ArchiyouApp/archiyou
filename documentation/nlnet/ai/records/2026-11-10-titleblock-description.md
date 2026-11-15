# Titleblock: optional description line

| | |
|---|---|
| Dates | 2026-11-10 → (open) |
| Model | Claude Fable 5.1 (claude-fable-5-1), Claude Code agent |
| Tool | Claude Code in plan mode, then as agent |
| Human | Mark van der Net: asked for the description line and its separator, wrote the prompts, reviewed plan and code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

### Context

`Document.titleblock()` (packages/core/src/docs/Document.ts:761) stacks, from the page bottom up: logo/version/units, the metrics labelblock, the params labelblock, the designer/licenses labelblock, then a thick 2pnt rule with the bold title above it. The user wants an optional `description` directly under the title, separated from the designer/manual line by a thin horizontal rule. When no description is given the titleblock must look exactly as it does today.

### Design

Resulting stack (bottom to top) when `description` is given:

```
designer / design license / manual license   (existing labelblock)
──────────── thin rule (0.5pnt)              (new)
description text, 3mm, wraps to 2 lines      (new, var 'titleblock:description')
━━━━━━━━━━━━ thick rule (2pnt)               (existing, moved up)
TITLE (8mm bold)                             (existing, moved up)
```

Without `description`: nothing is inserted and the thick rule + title stay where they are now.

### Changes

1. **`packages/core/src/docs/types.ts`** – add `description?: string` to `TitleBlockInput`. Mirror it in the duplicate `TitleBlockInput` in `packages/core/src/modeler/brep/types.ts:807` (unused copy, kept in sync).

2. **`packages/core/src/docs/Document.ts` `titleblock()`**
   - After `const designBlock = this.lastBlock()`, compute `let topRel = designBlock.bbox[3] + BLOCK_MARGIN*2` (the y the thick rule and title currently use).
   - `if(settings.description)`:
     - `this.hline({ thickness: '0.5pnt', color: 'black', length: TITLEBLOCK_WIDTH }).position(1, topRel).pivot(1, 0.5)` – the thin separator.
     - `this.textarea(settings.description, { size: '3mm' }).width(TITLEBLOCK_WIDTH).height(descriptionHeightRel).pivot(1,0).position(1, topRel + BLOCK_MARGIN)._varAdd('titleblock:description')`, with `descriptionHeightRel = this._activePage._resolveValueWithUnitsStringToRel('7mm', 'height')` (two 3mm lines). `textarea` is used instead of `text` so a longer description wraps instead of running out of the 60mm block.
     - `topRel += BLOCK_MARGIN + descriptionHeightRel + BLOCK_MARGIN`.
   - Thick `hline` and title `text` use `topRel` instead of `designBlock.bbox[3] + BLOCK_MARGIN*2`.
   - Doc comment: add `description` to the `@param data` list and `'titleblock:description'` to the variables list (note it only exists when a description was given). Also fix the error message at line 776 (`design` → `designer`) while there.

3. **`packages/ui/src/editor/completions-data.generated.ts`** – regenerate with `pnpm generate:completions` in `packages/core` so autocomplete shows the new option (the generator reads the Document.ts doc comments).

4. **Tests** – `packages/core/tests/unit/docs/titleblock.test.ts` (reuse its `makeDocs()` / inline data-URL logo pattern):
   - with `description: 'A sturdy bench'` the SVG contains the text and `titleblock:description` can be `set()`;
   - without a description the SVG does not contain `titleblock:description` as a variable (`set()` throws) and the title is still there.

5. **AI disclosure** – follow `.claude/skills/ai-disclosure/SKILL.md`: create a record in `documentation/nlnet/ai/records/` on approval, commit with `pnpm commit:ai`.

### Verification

- `cd packages/core && pnpm vitest run tests/unit/docs` – titleblock and Docs suites green.
- `pnpm -s archiyou run` a small script with `.titleblock({ title: 'Bench', designer: 'Me', description: 'A garden bench for two' })` and one without, export SVG, and eyeball that the description sits under the thick rule with a thin rule under it, and that the no-description titleblock is unchanged.
- `npx tsc --noEmit -p packages/core` for type errors.

## Review and decisions by the human
(filled as you go)

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
