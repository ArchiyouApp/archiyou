# Save as project from a configurator, and Projects merged into develop

| | |
|---|---|
| Dates | 2026-10-29 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: wrote the prompts, chose to merge Projects into develop in a worktree, reviewed the flow and the buttons, chose the commit split and how develop is updated |
| Branch | `projects-merge` (worktree), into `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-10-29 14:28 +0100  I want to add some things to the configurator: "Save as project" button (next to "View source" and "Embed" - it should go to archiyou login page (if not already logged in) (save script values in background, also for registration) - when user is logged in it should navigate to new project with the configurator and param values tied to the project. Then have users follow the existing logic (client info etc). In the configurator showing a "save as project" should be an option (default: on).
2026-10-29 15:08 +0100  It becomes a bit crowded with these button on the top right. Can you make the button behave like this: just circles with the icons in it, when you mouse over the button width animates and the text is shown. Do that for all these buttons. If not already make these button consistent by making it one component
2026-10-29 17:58 +0100  Can you merge the projects worktree into develop
```

## Plan (agent output, reviewed by the human before implementation)

No plan mode; the agent asked and the human decided:

1. **Projects first.** "Save as project" needs the Projects work (branch `projects`, record
   [2026-10-05-projects](./2026-10-05-projects.md)), which was not on develop. The human chose to merge
   `projects` into develop, and, because another session was committing in the develop checkout, to do
   that in a separate worktree (`archiyou-projects`, branch `projects-merge`).
2. **Merge resolutions.** Both sides kept in `schema.ts`, `plugin.ts` and the AI README; develop's side of
   `config.ts` (develop removed backups); merged imports and handlers in `editor.ts`,
   `published-configurator.ts`, `configurator-url.ts` (re-exports the core codec, keeps
   `deliveryTokenFromUrl`) and `configurator-metric-bar.ts`. Develop's `0001_links` migration kept,
   `0002_projects` regenerated with drizzle-kit (same SQL). `delivery` added to the reserved query keys
   in core's `ScriptParam.ts`.
3. **Save as project.** A link, not a call from the frame: inside another site's page the frame's
   storage is partitioned, so the design (configurator `author/name:version` plus its query) travels to
   the editor's `/projects/new`, which keeps it in the editor's own localStorage
   (`archiyou:save-project`, a week at most). Anonymous → `/login?next=/projects/new&for=project`
   (sign in or register; `nextPath` accepts only a same-origin path); address not confirmed → the page
   waits and continues on focus, on the design's storage event, or from the confirmation page; then one
   project (Web Locks across tabs) with the published script, its defaults plus the link's values and
   the language, and the project page opens, where the existing client and delivery flow goes on.
   Display option `ui.project=0` hides the button (default shown).
4. **Round viewer buttons.** One component, `<configurator-action-button>`: an icon in a circle whose
   width opens to the label on hover (pointer devices only) or keyboard focus; `active` (Embed while its
   panel shows) and `expanded` (Publish as configurator) keep it open; the label stays the accessible
   name; reduced motion respected; 44 px targets on touch.

## Review and decisions by the human

- Chose merging Projects into develop, then a worktree when the develop checkout turned out to be in use.
- Tested sign-up, sign-in and already signed-in paths in Chrome with the agent; a duplicate project
  (two tabs continuing at once) was found and fixed with Web Locks and a storage-key filter.
- Asked for the round, widening buttons as one component.
- Chose the commit split, and that develop is fast-forwarded only once the other session's checkout is clean.

## Commits
(filled when the unit closes)
