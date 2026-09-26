# Mobile-first frontend: configurator, browser, editor

| | |
|---|---|
| Dates | 2026-09-26 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code in plan mode (visual analysis with chrome-devtools emulation), then as agent |
| Human | Mark van der Net: wrote the prompts, chose the configurator bottom sheet and the editor "view & tweak" scope, reviewed plan and code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)
## Mobile-first frontend: configurator, browser, editor

### Context

None of the frontend adapts to screen size. Checked on a 390×844 touch emulation against the running dev server:

- **Configurator** (`/configurators/archiyou/strawwall:0.2`):
  - It is a fixed horizontal `wa-split-panel` at 33%, which leaves about 120px of sidebar, so parameter labels disappear.
  - The viewer toolbar is hidden behind the attribution pill.
  - The metric bar is 80px tall, can only be scrolled with its chevrons, and has no swipe.
  - The download menu is 26rem wide, wider than the phone.
  - `100vh` hides the Download bar behind the mobile browser toolbar.
- **Browser** (`/browser`): the 200px sidebar takes half the screen, and the header and cards overflow horizontally.
- **Editor** (`/editor`):
  - The two 48px rails and a split with `--min: 300px` on each side need at least 700px, so the viewer ends up as a grey sliver.
  - Tool panels are fixed 30–40% slices of that.
- **Shared problems:**
  - Tap targets are under 44px everywhere (20px step buttons, 16px checkbox, 21px unit switch, 9px chip ×).
  - Inputs under 16px trigger iOS auto-zoom.
  - Some controls only appear on hover, so they're unreachable on touch.
  - The overlay menus are `40vw`, about 150px on a phone.

The code has no hooks for any of this yet: no breakpoint or touch tokens, and no media or container queries. The exceptions are `modules-menu.ts` and `help-tool.ts`.

**Goal:** the configurator becomes a first-class phone experience. The browser works cleanly. The editor becomes usable for viewing and tweaking. The approach is simple: CSS first, one breakpoint, two adaptive tokens, and one new reusable component (a bottom sheet). Desktop stays as it is.

**Decisions made with the user:**
- Configurator: full-screen viewer with parameters in a bottom sheet.
- Editor: "view & tweak". The viewer sits on top with params and code below, the rails become horizontal bars, and tools open in a sheet.

### Principles

1. **One breakpoint, "compact" = width < 48rem (768px).**
   - Export it from `apps/editor/src/styles/design-tokens.ts` as `BREAKPOINT_COMPACT = '48rem'`. It is used in Lit `css` through `unsafeCSS`, because CSS variables can't be used inside queries.
   - The configurator and browser use **container queries** on their own host. That way the same code adapts in the published page, in iframe embeds and in the editor's preview dialog.
   - The editor needs JavaScript for the split orientation. It uses a single `compactLayout` signal, built on `matchMedia`, which goes in `apps/editor/src/state/editor.ts` next to the existing collapse signals.
2. **Two adaptive tokens instead of per-component touch rules.**
   - `--hit-min`: 24px by default, 44px on `(pointer: coarse)`.
   - `--input-font-size`: 14px by default, 16px on coarse pointers, so iOS doesn't zoom on focus.
   - They go into the existing `applyDesignTokens()` as one small adopted stylesheet with the media query. The inline `:root` styles can't express media queries, which is why a stylesheet is needed.
   - Components opt in with `min-height/min-width: var(--hit-min)` and `font-size: var(--input-font-size)`.
3. **Hover-only controls** become visible under `@media (hover: none)`. This is one rule per file, and the markup doesn't change.
4. **Viewport:**
   - `100vh` becomes `100dvh`.
   - Add `viewport-fit=cover` in `apps/editor/index.html`.
   - Bottom bars get `env(safe-area-inset-bottom)` padding.
5. **Keep heavy elements alive.** The configurator's layout switch is CSS only, so `model-viewer` and its Three.js scene are never recreated when the breakpoint is crossed.

### Phase 0: foundations (small, touches many files)

- **`apps/editor/src/styles/design-tokens.ts`:** add `BREAKPOINT_COMPACT`, plus the adaptive `--hit-min` and `--input-font-size` stylesheet in `applyDesignTokens()`.
- **`apps/editor/index.html`:** add `viewport-fit=cover`.
- **Replace `100vh` with `100dvh`:**
  - `apps/editor/src/apps/workspace/app-shell.ts:50`
  - `apps/editor/src/pages/published-configurator.ts:138,160`
  - the `calc(100vh - …)` in `share-script-menu.ts`, `publish-script-menu.ts` and `params/param-define-menu.ts`
- **`apps/editor/src/settings.ts`:** change `OVERLAY_MENU_WIDTH` to `clamp(min(28rem, 100vw - 2rem), 40vw, 100vw - 2rem)`, and do the same for the height with `dvh`. That one change fixes all six hand-rolled overlay dialogs.
- **Hover-only controls, add `@media (hover: none) { … opacity: 1 }` in:**
  - `file-info.ts`
  - `param-item.ts`
  - `param-menu.ts`
  - `presets-menu.ts`
  - `scene-explorer.ts`
  - `script-manager-item.ts`
  - `param-item-object-list.ts`
- **`viewer-handles-overlay.ts`:** add a `pointercancel` handler that ends the drag the same way `pointerup` does. Without it, a system gesture can leave OrbitControls disabled.

### Phase 1: configurator (priority)

#### New: `packages/ui/src/bottom-sheet.ts` (`<ay-bottom-sheet>`)

A generic component, reused by the editor's tool panels. It is roughly 150 lines, in the AGENTS.md component order.

- **Props:**
  - `detents`: for example `"peek half full"` or `"half full"`.
  - `detent`: the current value, reflected.
  - `docked`: a boolean. When true, the sheet renders as a plain block with no handle and no positioning, which is the desktop sidebar mode.
- **Structure:**
  - The handle bar is a `<button>` with `aria-expanded`. Tap cycles peek → half → full. The Enter key does the same.
  - `slot="header"` holds the peek-row content.
  - The default slot is the scrolling body.
- **Drag:**
  - `pointerdown` on the handle or header calls `setPointerCapture`. `pointermove` sets `--sheet-height`.
  - `pointerup` or `pointercancel` snaps to the nearest detent, taking a flick into account (velocity over the last ~100ms).
  - Height animates with `transition: height 200ms`, which is turned off while dragging. It uses `height` rather than `transform` so the inner scroll area always matches the visible part.
- **Styling:** absolutely positioned at the bottom, with a radius on the top corners, a grab bar, `touch-action: none` on the handle only, and design tokens throughout.
- **Event:** it emits `ay-sheet-change` with `{ detent }`.

#### `packages/ui/src/configurator/configurator.ts`

- Replace the `wa-split-panel` with a CSS grid. One DOM serves both layouts:
  ```
  :host (container-type: inline-size; container-name: configurator)
   ├ .stage   (grid)
   │  ├ ay-bottom-sheet.sidebar  [docked on wide] → configurator-header (slot=header), configurator-controls
   │  └ .viewer-pane → model-viewer, viewer-actions, attribution
   └ configurator-metric-bar
  ```
  - **Wide:** `grid-template-columns: clamp(300px, 33%, 420px) 1fr`. The sheet is `docked`.
  - **Compact (`@container configurator (width < 48rem)`):** the viewer pane fills the stage, with `inset-block-end: var(--sheet-peek)` so the model centres above the peek row. The sheet is absolutely positioned with detents `peek half full` and a default of `peek`. `full` leaves 48px of viewer visible so the user keeps some context.
  - `docked` is set from a single `ResizeObserver` width check on the host. This is the only JavaScript in the switch. Crossing the breakpoint changes a CSS attribute and nothing is re-rendered.
  - **Trade-off:** the desktop sidebar loses its drag-to-resize divider and gets a sensible clamped width instead. Tell me if you want to keep it.
- **Peek row:** the existing `configurator-header` in a condensed form, with thumbnail, title and version pill (description hidden), plus a chevron. The title therefore sits on the sheet instead of on a separate top bar, which gives the viewer the whole screen.

#### Configurator children (each gets `@container configurator (width < 48rem)` rules, or `--hit-min`)

- **`configurator-header.ts`:** condensed row; the description is hidden when compact.
- **`configurator-viewer-actions.ts`:**
  - Pill buttons become icon-only buttons when compact, with `aria-label`s, sized to `--hit-min`.
  - The embed panel width becomes `min(420px, 100cqw - 16px)`.
- **`configurator.ts` styles:** when compact, the attribution moves top-left so it no longer collides with the viewer menu.
- **`configurator-metric-bar.ts`:**
  - `.scroll-area` gets `overflow-x: auto` with `scroll-snap-type: x mandatory` and a hidden scrollbar.
  - The chevrons show only under `(hover: hover)`.
  - When compact, the bar is 56px tall plus the safe-area inset, and cards shrink to a 112px minimum.
  - The Download popover becomes `--max-width: min(26rem, 100vw - 16px)`.
- **`configurator-download-menu.ts`:**
  - Width becomes `min(26rem, 100%)`.
  - Row descriptions and "Not available yet" become a visible secondary line instead of `title`-only text. This helps on desktop too.
- **`configurator-controls.ts`:** make the unit help icon focusable (`tabindex=0`) so tapping it opens the tooltip.
- **`configurator-presets.ts`, `unit-switch.ts`, `configurator-locale-select.ts`:** controls get `min-height: var(--hit-min)`, and the select uses `--input-font-size`.
- **Params, presentation mode:**
  - **`param-item-number.ts`:**
    - Step buttons and the range thumb use `--hit-min`, with the thumb styled through `::-webkit-slider-thumb` / `::-moz-range-thumb`.
    - Add `inputmode="decimal"`.
    - The number box uses `--input-font-size`.
    - Only `mousedown` is stopped now; stop `pointerdown` as well.
  - **`param-item-boolean.ts`:** the label row gets `min-height: var(--hit-min)`.
  - **`param-item-options.ts` and `param-item-text.ts`:** use `--input-font-size`.
  - **`param-item-list.ts` and `param-item-object-list.ts`:** remove, add and duplicate buttons use `--hit-min`.
  - **`param-object-form.ts`:** the 80px label column becomes `minmax(5rem, 35%)`.
- **Viewer menu:**
  - Add `@property({ type: Boolean }) presentation` to `packages/ui/src/viewer/viewer-menu.ts`, which hides the editor-only tools (grid, gizmo, projection and the disabled Render). That brings it down to about 5 buttons, roughly 180px.
  - Thread it through `model-viewer` as a `presentation` property, which `page-configurator` sets. This also cleans up the desktop configurator.

#### Editor preview dialog (`packages/ui/src/editor/main-menu.ts`)

Add a small Desktop / Phone toggle to the Preview Configurator dialog. Phone sets the `page-configurator` to `width: 390px; margin-inline: auto`. Because the layout uses container queries, authors see the phone layout with no extra code. It also serves as a quick verification tool.

### Phase 2: browser

- **`apps/editor/src/pages/browser.ts`:**
  - Set `container-type: inline-size` on the host.
  - When compact, `.sidebar { display: none }`. Nothing is lost: the tabs duplicate the sections, and "Admin panel" is also in the nav-bar account menu (`nav-bar.ts:108`).
- **`packages/ui/src/browser/browser-header.ts`:** `flex-wrap: wrap`. When compact, search becomes `flex: 1 1 100%` on its own row, replacing the fixed 240px.
- **`browser-asset-grid.ts`:** `.grid` becomes `display: grid; grid-template-columns: repeat(auto-fill, minmax(min(13.75rem, 100%), 1fr))`, and `minmax(10rem, 1fr)` when compact (two columns on a phone).
- **`browser-asset-card.ts` and `browser-asset-new.ts`:** fixed `width: 220px` becomes `width: 100%`. The inner 160px buttons also become `width: 100%`.

### Phase 3: editor ("view & tweak")

- **`apps/editor/src/state/editor.ts`:** add `compactLayout`, a signal backed by `matchMedia('(width < 48rem)')`.
- **`apps/editor/src/pages/editor.ts`:**
  - The host reflects a `compact` attribute and uses `flex-direction: column`.
  - The outer `wa-split-panel` gets `orientation=${compact ? 'vertical' : 'horizontal'}`.
  - Swap the slots through bindings so the viewer is on top: `.left-panel slot=${compact ? 'end' : 'start'}`, and the viewer split the reverse. The DOM order stays the same, so `model-viewer` survives.
  - When compact, the position is 45. Replace the `--min/--max: 300px` with `--min: 120px; --max: calc(100% - 120px)`. The grip icon becomes `grip-horizontal`.
  - When compact, the inner `.viewer-tools-split` stays at position 100. `editor-tool-panels` is rendered inside `<ay-bottom-sheet detents="half full">`, which is open whenever `_activeTools.length > 0`. Closing the sheet clears the active tools. Tools get recreated when the breakpoint is crossed; that's acceptable because it's rare and the tools read signals.
- **`packages/ui/src/editor/main-menu.ts` and `toolbar.ts`:**
  - Add a reflected `horizontal` boolean. `:host([horizontal])` gives a row layout, `height: 48px`, `width: 100%` and `overflow-x: auto`.
  - `main-menu` sits on top and `toolbar` at the bottom, with safe-area padding.
- **`codebox.ts`:**
  - The editor font becomes `max(0.72rem, var(--input-font-size))` on coarse pointers, to avoid iOS zoom.
  - The 22–24px title-bar buttons use `--hit-min`.
- **`param-menu.ts`:** measure tab overflow with a `ResizeObserver` instead of only in `updated()`, so it stays correct after rotation.
- **`viewer-menu.ts`:** add `max-width: calc(100% - 16px); overflow-x: auto`, so the full editor toolbar scrolls in a narrow viewer instead of clipping.
- **Out of scope:** reordering params and tabs by touch. HTML5 drag and drop has no touch support, so reordering stays desktop-only.

### Commits and disclosure

- After approval, create the disclosure record with the `ai-disclosure` skill.
- One `pnpm commit:ai` per phase (0–3), each with a human-written summary.

### Verification

- **Type checks:** `pnpm --filter @archiyou/ui lint` and `pnpm --filter @archiyou/editor typecheck` (both are `tsc --noEmit`).
- **Tests:** `pnpm --filter @archiyou/ui test` and `pnpm --filter @archiyou/editor test`.
- **Visual check** with chrome-devtools `emulate` against `localhost:5173`, before and after screenshots in the scratchpad:
  - Viewports: 390×844 mobile+touch, 844×390 landscape, 768×1024 tablet, 1440×900 desktop.
  - Pages: `/configurators/archiyou/strawwall:0.2`, `/browser`, `/browser/configurators`, `/editor`.
- **On every viewport:**
  - `document.documentElement.scrollWidth === innerWidth`, so there is no horizontal scroll.
  - The Download button is visible without scrolling.
- **Configurator sheet:**
  - Drag the handle to each detent. Flick up and down. Tap to cycle. Rotate the viewport across the breakpoint and confirm the model stays loaded (no re-execution in the console).
  - Change a parameter at the `half` detent and see the model update above it.
  - Open the Download menu on a phone and confirm it fits.
- **Editor:**
  - Open a tool and confirm it appears in the sheet, and that closing the sheet clears it.
  - Code is editable. The viewer rotates with one finger.
  - The preview dialog's Phone toggle shows the sheet layout.
- **Desktop regression:** compare 1440×900 screenshots of all four pages with the before set. The only expected difference is the configurator sidebar's fixed-clamp width.

## Review and decisions by the human

- Configurator on phones: full-screen viewer with the parameters in a bottom sheet (chosen over a stacked viewer/params layout).
- Editor on phones: "view & tweak" (chosen over read-only on phones or tablet-only).

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
