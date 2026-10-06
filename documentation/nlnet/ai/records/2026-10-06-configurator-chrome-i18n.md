# Configurator chrome in eleven languages: @lit/localize set up, buttons and labels translated

| | |
|---|---|
| Dates | 2026-10-06 → 2026-10-06 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: the scope was chosen from three options the agent offered) |
| Human | Mark van der Net: asked for translations of the standard buttons and labels, chose the configurator as the scope, had it committed |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-06 22:15 +0200  Can you create translations for all standard buttons/labels etc.
2026-10-06 23:22 +0200  yes commit
```
The scope came from a question the agent asked, with three options; the human chose
"Configurator only (Recommended)".

## Plan (agent output, scope chosen by the human)

The configurator's content (title, params, presets, metrics) is machine-translated into
ten languages at publish time, but its own chrome (Download, Presets, Parameters, Embed,
Show more, Metric/Imperial…) was hard-coded English. The app's `@lit/localize` setup had
never been finished: a config at the repository root pointing at paths that do not exist,
nine hand-written Dutch strings with made-up ids, no locale modules built, and no
component re-rendering on a locale change.

Scope offered: configurator only (chosen), configurator plus a Dutch editor, or
everything in all eleven languages. The editor stays English.

1. `lit-localize.json` moves into `apps/editor` (where its scripts already run), with the
   ten target locales of `TRANSLATION_LOCALES`; the root scripts delegate to it.
2. The configurator's chrome strings go through `msg()`; its components get
   `@localized()` so they re-render when the locale module arrives.
3. The chrome locale follows the configurator's language picker (`configuratorLocale`),
   on the published page and in the editor's Configurator Preview, and returns to
   English when the configurator closes. The editor no longer switches its own locale
   from the browser language.
4. Translations written by the agent into the XLIFF files, built into locale modules.
5. A test that keeps the chrome locales in step with the content locales.

## Work (agent output)

- `apps/editor/lit-localize.json` (moved from the root, ten target locales); the root
  `localize:*` scripts delegate to the editor; the stale `en.xlf` and the nine Dutch
  strings with made-up ids are gone (extract drops ids that match no `msg()`).
- `i18n/locale-config.ts`: locale modules through `import.meta.glob`, `chromeLocaleFor()`
  and `setChromeLocale()`. `<app-shell>` no longer sets a locale from the browser.
- `<page-configurator>` follows `configuratorLocale` and resets to English on disconnect;
  the published page uses the visitor's language for its loading and error states.
- `msg()` and `@localized()` in the configurator's components, the param controls it
  shows, the unit switch, the bottom sheet, the viewer menu (visitor buttons only) and the
  download errors in `services/fulfillment.ts`: 95 strings. Four existing `msg(variable)`
  calls in the nav bar and toolbar, which made `lit-localize extract` fail, now pass the
  text as is.
- Translations of the 95 strings into the ten languages, written by the agent into the
  XLIFF files (formal register, except informal Dutch and Spanish), built into
  `translations/<locale>.ts`. The editor's 232 other strings stay untranslated and fall
  back to English.
- `tests/i18n.test.ts`: chrome locales equal `TRANSLATION_LOCALES`, fallback of
  `chromeLocaleFor`, every language translates the same strings.

## Verification (agent)

- Editor tests 63 (3 new), UI 228; editor and UI typecheck against their dependencies;
  production build with a 14–17 kB chunk per language (about 7.5 kB gzipped), loaded
  only when a configurator is shown in it.
- In the dev configurator (strawwall:0.2): German, Japanese, Arabic and French through the
  picker, including the download menu, embed panel, feedback form and view-style flyout;
  the not-found page in Spanish; back to English after leaving the configurator.
- Not done: right-to-left layout for Arabic. `configuratorRTL` exists but nothing applies
  it, so mixed Arabic/Latin sentences read out of order.
- Not checked by the agent: the editor's Configurator Preview in a browser.

## Review and decisions by the human

- Chose the configurator as the scope; the editor stays English.
- Did not review the translations themselves before the commit; the agent advised a check
  by native speakers, Hindi, Arabic, Chinese and Japanese first.
- Left right-to-left layout for Arabic open.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | see the git log | 22:15, committed after 23:22 |
