# Configurator translations: params, options and metrics, language codes, server-owned sets; boolean switches

| | |
|---|---|
| Dates | 2026-10-06 → 2026-10-06 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a series of requests while testing the configurator in the dev editor) |
| Human | Mark van der Net: asked how the translations work and had the Gemini key tested, chose which configurators to translate on production, found the untranslated labels in the Configurator Preview, chose option 2 for where the preview's translations come from, asked for the switches, had it committed |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below (the skill texts loaded during the session are left out) |

## Prompts (verbatim, local time)
```
2026-10-06 18:20 +0200  ok nice. Another improvement on the configurator. We implemented some kind of internationalization right? Where is that? How is it working?
2026-10-06 18:34 +0200  Can you test the Gemini key for me first?
2026-10-06 18:51 +0200  Yes can you translate the last configurator version in one go?
2026-10-06 19:18 +0200  Im testing in my locale dev editor. In Configurator Preview I switch languages, but for example the parameter names dont change, the metric names too Also can you dont add full language but the codes Nederlands => NL, Francais => FR
2026-10-06 19:31 +0200  please run translations again for the metrics
2026-10-06 20:18 +0200  yes do 2
2026-10-06 20:27 +0200  Can you use the Webawesome switch for boolean params (in param menu of editor and in configurator) instead of the checkbox? See WA switch: https://webawesome.com/docs/components/switch/
2026-10-06 21:44 +0200  Can you commit all the configurator work (translations, param switches etc)
```

## Work (agent output; no separate plan)

- **How it works (18:20).** Explained the two layers: content translation (`packages/core/src/i18n`, the server's Gemini job in `apps/server/src/translation`, `published.translations`, `apps/editor/src/state/locale.ts`) and the app's own strings (`@lit/localize`, 9 strings, never built). Found that none of the 8 configurators on next.archiyou.com had translations.
- **Gemini key (18:34).** Tested the local key without printing it: model list, one generation, the server's `Translator` (detection and ten locales). The production server's own key could not be checked from here.
- **`pnpm admin:translations` (18:51).** A new admin command (`apps/server/src/admin/translations.admin.ts`): `--list` shows each configurator's latest version and whether its translations are current; `--translate` runs the translation job directly, without Redis. Run against the production database through the developer's tunnel, with the local key, for the four configurators the human chose.
- **Labels in the configurator (19:18).** Number params draw their own label row and never got the translator (`param-item-number`); option dropdowns did not get it either (`configurator-params`). The language picker shows codes (NL, FR) with the native name as tooltip.
- **Metric names.** Not translated anywhere: metrics only exist once the script runs. `extract.ts` now reads the names (or a written-out `label`) of `metric(…)` calls from the code (`metricLabelsInCode`, `metricKey`), and the metric card translates them. Names built at run time stay as written. Params hidden by default are translated too, since a behaviour can show them.
- **Re-translation (19:31).** The three configurators with metrics translated again on production.
- **Server-owned translations (20:18, option 2 of two offered).** The preview read translations from the working copy, which held a stale copy. Now the server drops translations sent with a save, a publish or an in-place edit (`withoutServerState`, like `validated`), keeps the stored set through an in-place edit, and the job writes through `setTranslations()`, which does not touch `updated`. The editor's Configurator Preview fetches the latest published version's translations each time it opens (`refreshPreviewTranslations`).
- **Switches (20:27).** Boolean params use the Web Awesome switch (`param-item-boolean`): small with "true"/"false" in the editor, medium without text in the configurator, larger on touch screens.

## Verification (agent)

- Core i18n tests 30 (the hidden-param test changed to the new rule, 4 for metrics), server 273 (4 for server-owned translations), editor 60, UI 228; server, editor and UI typecheck against their dependencies.
- On the dev configurator page in German: translated param, option and metric labels, the DE code, and the switch, which first sat in the middle of its row (fixed) and toggles the link's `OVERHANGS_SAME`.
- Not checked by the agent: the editor's param menu and its Configurator Preview in a browser.

## Data operations on production

- After the 18:51 prompt: translations for archiyou/example_solids:0.4, pubtest2:0.7, strawwall:0.2 and ur_house_sketch:0.2, ten locales each, `gemini-2.5-flash`.
- After the 19:31 prompt: pubtest2, strawwall and ur_house_sketch again, for the metric names and hidden params.

## Review and decisions by the human

- Translated his own four configurators on production, not the four `test/*` ones.
- Tested in his dev editor and reported that param and metric names did not change; asked for language codes instead of names.
- Chose the published version's translations for the preview, with translations owned by the server, over copying the new set onto the working copy.
- Asked for the Web Awesome switch for boolean params.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | see the git log | the prompts above, 18:20 to 20:27 |
