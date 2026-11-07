/**
 *  core-sheet.gs — the bound script of URBUILD_DATABASE_CORE (Extensions → Apps Script). It only
 *  calls the library URBUILD (common.gs, core.gs, builder.gs; install: see common.gs). A button
 *  (Insert → Drawing → Assign script) takes one of the function names below.
 */

function onOpen()
{
  URBUILD.onOpenCore();
}

/** Bouwerssheet aanmaken: a copy of URBUILD_BOUWER_BASE for a new builder, with the core's data. */
function bouwerssheetAanmaken()
{
  URBUILD.createBuilderSheet();
}

/** Naar de offerte publiceren: the builders' prices of the tabs bouwersprijzen and bouwers to the offer. */
function naarOffertePubliceren()
{
  URBUILD.publishToOffer();
}
