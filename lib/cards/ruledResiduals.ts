/**
 * RULED RESIDUALS (Oct 22, 2026). A failure Akshay has ruled on stays in the
 * suite as an EXPECTED failure: it is reported, not counted, and only while
 * it fails exactly as ruled. If it stops failing, fails more than once, or its
 * amount moves, it is counted again, loudly, because the ruling was about
 * that failure and no other. Never deleted.
 *
 * (Moved from acceptance.test.ts, Nov 4, so the rulings test can read them.)
 */
export type Anchor = { form: string; filingDate: string };
export type Ruled = { id: string; cik: string; failure: RegExp; amount: string; ruling: string; anchor?: Anchor };

export const RULED: Ruled[] = [
  {
    id: "5.8",
    cik: "0000927066",
    failure: /^not on a move card: \$65MM in "Significant sources of cash during the period included the incurrence/,
    amount: "$65MM",
    ruling: "Akshay's ruling, Session 26 (\"DaVita's ruled residuals\", sessions/26/prompt_card_review_2.md), re-confirmed Oct 22, 2026: the $65MM of revolver draws DaVita's 10-Q states as a source of cash is not shown on a move card",
  },
];

export function applyRuled(id: string, cik: string, anchor: Anchor | null, fails: string[]): { counted: string[]; ruled: string[] } {
  const r = RULED.find((x) => x.id === id && x.cik === cik);
  if (!r) return { counted: fails, ruled: [] };
  const hits = fails.filter((x) => r.failure.test(x));
  const counted = fails.filter((x) => !r.failure.test(x));
  if (hits.length !== 1) counted.push(`RULED RESIDUAL ${hits.length === 0 ? "NO LONGER FAILS AS RULED" : `FAILS ${hits.length} TIMES`}: ${id} expected exactly one ${r.amount} failure (${r.ruling}). ${hits.length === 0 ? "It now passes, or its amount moved: the ruling must be revisited before this is green." : ""}`);
  return { counted, ruled: hits.length === 1 ? hits.map((h) => `${id} ${h} — ${r.ruling}`) : [] };
}
