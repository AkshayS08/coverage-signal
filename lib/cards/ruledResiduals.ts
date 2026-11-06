/**
 * RULED RESIDUALS (Oct 22, 2026). A failure Akshay has ruled on stays in the
 * suite as an EXPECTED failure: it is reported, not counted, and only while
 * it fails exactly as ruled. If it stops failing, fails more than once, or its
 * amount moves, it is counted again, loudly, because the ruling was about
 * that failure and no other. Never deleted: a ruling that no longer applies is
 * marked retired, with why, and is never applied.
 *
 * (Moved from acceptance.test.ts, Nov 4, so the rulings test can read them.) Each records the anchor it was ruled on
 * (form and filing date); on a new anchor the plain check governs (Akshay, Nov 4).
 */
export type Anchor = { form: string; filingDate: string };
export type Ruled = { id: string; cik: string; failure: RegExp; amount: string; ruling: string; anchor?: Anchor; retired?: string };

export const RULED: Ruled[] = [
  {
    id: "5.8",
    cik: "0000927066",
    failure: /^not on a move card: \$65MM in "Significant sources of cash during the period included the incurrence/,
    amount: "$65MM",
    anchor: { form: "10-Q", filingDate: "2026-08-04" }, // DaVita's Q2 10-Q, the anchor it was ruled on
    ruling: "Akshay's ruling, Session 26 (\"DaVita's ruled residuals\", sessions/26/prompt_card_review_2.md), re-confirmed Oct 22, 2026: the $65MM of revolver draws DaVita's 10-Q states as a source of cash is not shown on a move card",
    retired: "Nov 6, 2026 (Akshay): replaced by a rule over the class. Routine draws and repayments on a revolving facility stated only as period totals are covered by the facility's drawn balance on the card, where it ties to the anchor; they are not move cards (acceptance 5.8).",
  },
];

export function applyRuled(id: string, cik: string, anchor: Anchor | null, fails: string[], rules: Ruled[] = RULED): { counted: string[]; ruled: string[] } {
  const r = rules.find((x) => x.id === id && x.cik === cik && !x.retired);
  if (!r) return { counted: fails, ruled: [] };
  // Nov 4: a ruling binds to the anchor it was ruled on (form and filing date). On another anchor, or with none
  // recorded, the plain check governs.
  if (!r.anchor || !anchor || r.anchor.form !== anchor.form || r.anchor.filingDate !== anchor.filingDate) return { counted: fails, ruled: [] };
  const hits = fails.filter((x) => r.failure.test(x));
  const counted = fails.filter((x) => !r.failure.test(x));
  if (hits.length !== 1) counted.push(`RULED RESIDUAL ${hits.length === 0 ? "NO LONGER FAILS AS RULED" : `FAILS ${hits.length} TIMES`}: ${id} expected exactly one ${r.amount} failure (${r.ruling}). ${hits.length === 0 ? "It now passes, or its amount moved: the ruling must be revisited before this is green." : ""}`);
  return { counted, ruled: hits.length === 1 ? hits.map((h) => `${id} ${h} — ${r.ruling}`) : [] };
}
