/**
 *  builder-sheet.gs — the bound script of URBUILD_BOUWER_BASE, and so of every builder sheet copied
 *  from it (Extensions → Apps Script). It only calls the library URBUILD (common.gs, core.gs,
 *  builder.gs; install: see common.gs). A button (Insert → Drawing → Assign script) takes one of the
 *  function names below: the tab update has the first, publiceer prijzen the second.
 */

function onOpen()
{
  URBUILD.onOpenBuilder();
}

/** Componenten bijwerken: the core's material, reference prices and new components. */
function componentenBijwerken()
{
  URBUILD.updateComponents();
}

/** Prijzen publiceren: this sheet's prices to the URBUILD core sheet. */
function prijzenPubliceren()
{
  URBUILD.publishPrices();
}
