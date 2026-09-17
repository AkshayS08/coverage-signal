/**
 * SESSION 22 — ONE CLOCK FOR THE BOOK.
 *
 * The PRODUCT is already single-clock: app/page.tsx pins `asOfDate` once at
 * the start of a run and passes it everywhere (Session 21, Stage 5). Nothing
 * here changes that, and nothing here is imported by the product.
 *
 * The HARNESSES were not. Every review and measurement script declared its
 * own as-of, and by the end of Session 21 they disagreed — 2026-09-04,
 * 2026-09-06 and 2026-09-07 all live in the tree at once. A month count
 * measured on one and compared against a sheet produced on another is the
 * two-clocks defect wearing a third disguise, and it is the reason the same
 * tranche could read "17 months out" in one artifact and "15" in the next
 * with neither being wrong.
 *
 * So: one constant, and every live harness reads it.
 *
 * WHAT DELIBERATELY DOES NOT READ IT. A Session 21 artifact that RECORDS a
 * past measurement keeps the date it was actually taken on — s21sheets,
 * s21checksheet, s21repro3's attestation date. Re-pointing those at today
 * would restate history rather than re-measure it, and an attestation whose
 * date moves is not an attestation. Golden files likewise pin their own
 * as-of: a golden is pinned to the clock it was signed at, and Rule 30 says
 * a moved input is re-signed, never edited.
 */

/**
 * The demo book's pinned as-of.
 *
 * Moved to 2026-09-09 when Tenet's 2026-09-08 pricing 8-K landed mid-session.
 * That filing announces the intended takeout of the exact 5.125% 2027 tranche
 * the demo opens on, and the tool holds it as an intention rather than a
 * retirement — so the book is re-pinned forward to include it rather than
 * demoed against a corpus that predates its own best example.
 */
export const PINNED_AS_OF = new Date("2026-09-09T00:00:00Z");

/** The same date as the ISO day string the sheets and labels print. */
export const PINNED_AS_OF_DAY = PINNED_AS_OF.toISOString().slice(0, 10);
