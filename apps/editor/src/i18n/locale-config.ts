/**
 * @lit/localize runtime configuration: the app's own CHROME strings (buttons, labels,
 * hints), as opposed to the content a configurator's author wrote (state/locale.ts).
 *
 * Only the configurator is translated so far. It sets the chrome locale from its
 * language picker while it is on screen (setChromeLocale) and hands back the source
 * locale when it closes, so the editor around the Configurator Preview stays English.
 *
 * The strings live in translations/<locale>.xlf; `pnpm localize:extract` adds new
 * msg() strings there and `pnpm localize:build` turns the files into the locale
 * modules loaded below. Components that call msg() need @localized() to re-render
 * once a locale module has arrived.
 */

import { configureLocalization, type LocaleModule } from '@lit/localize';

import { baseLocale } from '@archiyou/core/src/i18n/locales';

import { sourceLocale, targetLocales, allLocales } from './locale-codes.js';

/** Built by `lit-localize build`, one module per target locale, loaded on first use. */
const LOCALE_MODULES = import.meta.glob<LocaleModule>('./translations/*.ts');

export const { getLocale, setLocale } = configureLocalization({
  sourceLocale,
  targetLocales,
  loadLocale: (locale: string) => LOCALE_MODULES[`./translations/${locale}.ts`](),
});

/** The chrome locale for a content locale: itself when the chrome is translated into
 *  it, the source locale otherwise (a script may be written in any language). */
export function chromeLocaleFor(locale: string): string
{
  const base = baseLocale(locale);
  return (allLocales as readonly string[]).includes(base) ? base : sourceLocale;
}

/** Show the chrome in `locale`, or the closest the chrome has. Never rejects: a locale
 *  module that fails to load leaves the chrome in the language it was in. */
export async function setChromeLocale(locale: string): Promise<void>
{
  // No early return on getLocale(): while another locale is still loading that is the
  // old one. setLocale() itself returns at once for the locale in force or on its way.
  const next = chromeLocaleFor(locale);
  try
  {
    await setLocale(next);
  }
  catch (err)
  {
    console.warn(`Chrome locale '${next}' could not be loaded:`, err);
  }
}
