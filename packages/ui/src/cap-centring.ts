/**
 *  cap-centring.ts
 *
 *  How far a line of text has to move so that its CAP BAND — baseline to cap height — sits in
 *  the middle of the box holding it, rather than its line box.
 *
 *  ## Why this is measured and not a constant
 *
 *  Centring text in a badge is the same problem in every renderer: what you can centre is a
 *  line box (CSS) or a baseline keyword (SVG), and both of those include descender room the
 *  glyphs of 'A' or '3' never use. So a circled letter comes out sitting high or low, by
 *  roughly a tenth of an em — a whole pixel on a 23px badge, which is exactly the sort of
 *  thing the eye picks up and cannot name.
 *
 *  The drawing side fixes this with a constant, because there it CAN: `svgTextLabel()` places
 *  the baseline itself, at half a cap height below the middle (see CAP_HEIGHT_EM in
 *  core/annotator/svgPrimitives.ts), and SVG scales geometrically so one number holds at every
 *  size.
 *
 *  In the browser it does not hold. Chrome rounds a font's ascent and descent to whole DEVICE
 *  pixels before laying the line box out, so where the baseline lands inside that box is not a
 *  fixed fraction of the font size:
 *
 *      12px:  ascent 1.000em  descent 0.250em
 *      200px: ascent 1.035em  descent 0.225em
 *
 *  A nudge calibrated at one size is therefore wrong at another — and wrong again at a
 *  different zoom level, which changes the device-pixel grid under the same CSS size. Hence
 *  measuring: ask the layout where the baseline actually is, and put the cap band on the
 *  middle from there.
 *
 *      shift = lineBoxCentre − (baseline − capHeight / 2)
 *
 *  which is the same equation the SVG writer solves, just with both terms measured.
 */

/** Cap height as a fraction of the font size, when the platform will not say. Matches
 *  CAP_HEIGHT_EM in core — the fallback, not the answer; every browser that matters reports
 *  the real figure through TextMetrics. */
const CAP_HEIGHT_EM = 0.7

/** One measurement per font, size, weight and device-pixel grid — all four move the answer. */
const cache = new Map<string, number>()

/*  A webfont arriving after the first paint changes every metric here, and a zoom changes the
    pixel grid the metrics are rounded to. Both invalidate the lot; both are rare. */
if (typeof document !== 'undefined')
{
  document.fonts?.addEventListener?.('loadingdone', () => cache.clear())
}

/** The shift, in CSS pixels, that puts the cap band of `reference`'s text on the centre of its
 *  box. Positive moves the text DOWN.
 *
 *  Pass any element rendered in the font being centred; only its computed font matters, and
 *  the measurement is cached per font so this is cheap to call on every render.
 */
export function capCentreShiftPx(reference: HTMLElement): number
{
  const style = getComputedStyle(reference)
  const key = [
    style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle,
    style.lineHeight, window.devicePixelRatio,
  ].join('|')

  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const shift = measure(reference, style)
  cache.set(key, shift)
  return shift
}

function measure(reference: HTMLElement, style: CSSStyleDeclaration): number
{
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;top:0;left:0';
  probe.style.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`

  /*  An inline-block of zero height sitting on the baseline: its bottom edge IS the baseline,
      and it is the only way to ask the layout engine where it put one. */
  const strut = document.createElement('i')
  strut.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
  probe.append(strut, document.createTextNode('H'))

  // into the same tree, so the same stylesheets and font loading apply
  const host = reference.parentElement ?? document.body
  host.appendChild(probe)

  const line = probe.getBoundingClientRect()
  const baseline = strut.getBoundingClientRect().bottom
  probe.remove()

  if (!line.height) return 0

  const cap = capHeightPx(style)
  return (line.y + line.height / 2) - (baseline - cap / 2)
}

/** The real cap height of the font, in CSS pixels. 'H' rather than 'A': a flat top rasterizes
 *  to the true cap line, where a pointed apex comes back a fraction short. */
function capHeightPx(style: CSSStyleDeclaration): number
{
  const size = parseFloat(style.fontSize) || 0

  try
  {
    const context = document.createElement('canvas').getContext('2d')
    if (context)
    {
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const ascent = context.measureText('H').actualBoundingBoxAscent
      if (ascent > 0) return ascent
    }
  }
  catch { /* no canvas (a headless test, a locked-down context) — fall through */ }

  return size * CAP_HEIGHT_EM
}
