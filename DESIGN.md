# Design System — Warm Minimalism & High-Tech Utility

This document is the single source of truth for Archiyou's visual system.
Every component, every panel, every page MUST use these tokens.

## Architecture

```
src/styles/design-tokens.ts   <- Single source of truth
  |- --color-*, --text-*, --space-*, --radius-*   (custom tokens on :root)
  |- --wa-color-*, --wa-font-*, --wa-border-*     (Web Awesome mapping)
  '- --form-label-*                                (shared form tokens)

src/styles/dark-theme.ts       <- Overrides ALL tokens + WA vars for dark
```

Tokens are set as CSS custom properties on `:root` via `applyDesignTokens()`.
Dark mode overrides those same properties plus all `--wa-*` vars via `applyDarkTheme()`.

## Colors

### Philosophy
- Warm grays, no cold slates
- Never pure `#000000` — use `--color-text` (`#2f312e`)
- Tonal layering instead of borders (background color shifts for structure)

## Dark Mode

### How it works
1. `applyDarkTheme()` overrides ALL `--color-*` and `--wa-*` tokens
2. `data-theme="dark"` attribute on `<html>` for CSS selectors
3. Components that use Three.js must watch `data-theme` mutations

### Rules for new tokens
- Every new `--color-*` token MUST also get a dark override in `dark-theme.ts`
- Every new `--wa-*` mapping MUST also be in `darkWaOverrides`
- Always test both modes after a change

## Rules

### Required
- **Always tokens** — never hardcoded hex/rgb values in component styles
- **Always `var(--token)`** — with a fallback only if it is a new token that is not yet available everywhere
- **Form labels via `--form-label-*`** — never separate font-size/weight on labels
- **WA `::part()` override** — in every component that contains `wa-input`/`wa-textarea`
- **Dark override** — for every new color token

### Forbidden
- Inline `style="..."` in Lit templates
- Hardcoded colors (`#fff`, `#333`, `rgb(...)`)
- Pure `#000000` for text
- `1px solid` borders for layout structure (use surface shifts)
- Standard drop shadows with 0px blur