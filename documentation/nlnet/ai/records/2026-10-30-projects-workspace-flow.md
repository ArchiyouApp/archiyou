# A fast project page, ordered around designs, and designs from a configurator

| | |
|---|---|
| Dates | 2026-10-30 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: wrote the prompts, reported the slow Create → Project, designed the page order and the configurator picker, chose the rename to Design (labels only) and what the Shared tab lists |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

### Why Create → Project is slow

`layout-main` wraps `/browser`, `/projects/:id` and `/admin`, and calls `warmupWorker()` for
every one of them: the core library plus ~40 MB of CAD kernel (meshup binary, OpenCascade
wasm). The project page is ~0.57 MB of code and needs the kernel only to make a delivery's
files; the project request competes with the download, and on the Vite dev server importing
`@archiyou/core` on the main thread is hundreds of module requests.

Fix: no warmup in the layout (keep its server-target reset). The editor and the configurator
warm the kernel themselves and `RunnerWorker.run()` initialises on first use. The delivery
dialog warms it when it opens.

### Project page order

- Header unchanged (number, title, status, menu).
- Collapsible strips on top, full width: **Client** ("Client: No client [Add client]", or
  name and email; the chevron shows details and form), **Notes**, **Activity** (collapsed,
  with a one-line summary). No side column.
- **Designs** with a **[From configurator]** button; clicking a design selects it
  (`?design=…`, newest by default).
- **Deliveries** of the selected design only; "New delivery" makes one of that design
  (`deliveries.configuration_id` is required, so every delivery has one).

### "From configurator" picker

A dialog with tabs **My configurators**, **Shared with me** (others' published, not public,
visible to me) and **Public**, over the workspace's configurator cards (`browser-asset-grid`,
data from `/scripts/published`). A card opens the configurator with `?project=<id>`: its
"Save as project" becomes **"Add to P-005"**, which goes through `/projects/new` and adds a
design to that project instead of making one, then opens `/projects/<id>`. Sign-in and email
confirmation keep working. A "← Back to P-005" link, the configurator page having no nav bar.

### Configuration → Design

Visible labels only; tables, API and types keep `configuration`, so no migration.

## Review and decisions by the human

- Rename: labels only. Shared tab: others' non-public published configurators I can see.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
