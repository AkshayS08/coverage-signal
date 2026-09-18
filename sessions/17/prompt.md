# Session 17 (rescoped) — renderer, language, card format

Starting state: commit `5bbb9d0` live. A full RM review of both books produced 18 items. Seven are dissolved by the Session 18 rebuild rather than patched and have been moved there. One (seniority on cards) is dropped and arrives free in Session 18. Ten remain here.

**Read this first:** items moved to Session 18 are 2, 6, 7, 8, 9, 10, 15. Do not fix them here. If you find yourself wanting to, stop and report instead.

## Scope

**Out of scope:** `eventTiming.ts`, `factGuard.ts`, the extraction prompt, the taxonomy, corpus selection, the position layer, anything in Session 18. `eligibility.ts` only for item 5, which is a restriction (sends more to the table, never creates a card).

**Determinism non-negotiable.** One warm-up run first, then Book A ×3 and Book B ×3, byte-identical, local **and** live. The warm-up matters: the wording cache never caches a failure, so the first run after a wording change can legitimately differ from runs 2 and 3.

**Baseline diff required.** Capture current live output for both books before any change. After, report every changed line, including unintended ones. If a fix changes a line not on this list, stop and report.

---

## ITEM 0 — Split promptVersion (do this first)

`promptVersion.ts` is one constant folded into every answer and wording key. Several items below change the narration prompt, which would bump that constant and invalidate the answer cache, forcing a full re-extraction and making the baseline diff meaningless.

Split it:

- `extractionPromptVersion` → answer cache key only.
- `wordingPromptVersion` → wording cache key only.

Bump `wordingPromptVersion` once, at the end of this session, after all narration changes are in. Do not touch `extractionPromptVersion`.

**Acceptance:** after the split and the wording bump, a run produces new card text and byte-identical table lines against the baseline. If any table line changes, the split is wrong.

---

## BLOCKERS

**1. Annotation leak — five distinct instances rendering live.**
`A1 FIX — WAS DUPLICATING NEW DEBT` (HCA, Cigna) · `A2 — THIN FACT, REPORT ONLY` (Cigna) · `B1 FIX` (Quest) · `B4 FIX` (Molina) · `B2 — STALE, REPORT ONLY` (UHS, Encompass) · `FIX C — NO DATE VERIFIABLE, BARE "ANNOUNCED"` (UHS).

**Diagnose before fixing.** Determine whether these markers are renderer string literals or were persisted into cached wording. If persisted, a render-time strip leaves the store dirty and they return. Report which it is.

Then strip the whole pattern (`[A-Z]\d+ FIX`, `— REPORT ONLY`, `FIX [A-Z] —`) from all rendered output. Add an assertion that scans the **HTTP response body of an actual run of both books**, not a fixture. Session 16's E1 searched for one literal string against a fixture and passed while five markers rendered live.

**3. Source links are no longer clickable.** Regression from Session 15b — they render as grey plain text. Multi-source rendering (`10-Q 2026-07-28 | 10-Q 2026-04-29`) is correct; restore the links.

**4. Cards omit filings their narration draws on.**
Quest's card cites only `10-Q 2026-07-23` while `WHY NOW` asserts the May 2026 pricing of the 2036 notes (an 8-K). UHS's card cites `10-Q 2026-08-07` while claiming an August 11 event — a filing dated the 7th cannot describe the 11th.

Two changes, both assertable:

- A card's citation set is the **union of citations across every fact in its cluster**.
- **Every date and every figure appearing in card text must appear in at least one cited filing.** Add this as an assertion.

Note: item 5 deletes UHS's card, so Quest is the only live case left to verify this on.

**5. [LOGIC] Bare-year maturities must not card.**
UHS's "1.650% Senior Secured Notes due 2026" carded via the Dec-31 window convention. Dec 31 is safe for *excluding* (if the latest possible date is outside the window, it is definitely outside) but never for *including*.

Fix: `dateGranularity: "year"` → table, never card. Show the year and let the RM check.

**Change the card decision only.** Do not touch `windowDate` or the sorting convention, or exclusion behaviour changes with it.

**Expected consequence, accepted:** UHS's card disappears; Book A drops to one card.

---

## LANGUAGE AND FORMATTING

**11.** `standing` is internal vocabulary leaking to users. Replace with plain English or omit — the sentence usually already reads as recurring.

**12.** Date redundancy: "On February 2, 2026, the Company signed… — announced Feb 2, 2026." Suppress the status date when it already appears in the line.

**13.** Ellipsis still leaking: DaVita's first New debt line ends "on May 23, 2025…".

**14.** Multi-period not collapsed: DaVita capex renders both 2026 and 2025 periods. Rule 3 says most recent only.

**16.** Quest's card says "now inside the 15-month refi window." The 18-month rule is our internal threshold, not market convention. Say "15 months out."

---

## CARD FORMAT

**17. Replace `OPEN WITH` with `KEY POINTS`.**

```
REFI · DEBT MATURITY                    Tenet Healthcare Corp

CALL ABOUT   Refinancing the $1.5B 5.125% notes due November 2027
             — 15 months out.

KEY POINTS   · $1.5B due Nov 2027; 9 more tranches run to 2033
             · Priced $1.5B + $750M of new notes Nov 2025 to
               redeem an earlier maturity
             · Cash $2.17B at Jun 30, down from $2.88B at Dec 31

SOURCE       10-Q 2026-07-29 ↗ · 8-K 2025-11-18 ↗
```

Rules:

- **The first bullet must be the fact that triggered the card** (the maturity, the announced deal, the proceeds). Supporting facts follow.
- 2 to 4 bullets. One fact + its figure each, in the same plain register the portfolio table uses.
- **No bullet may assert a relationship between two facts.** No "which gives them a window to…", no "so the same approach can be…". State facts; the RM draws the connection.
- `WHY NOW` stays, unchanged.

This structurally eliminates two observed defects: Tenet's `OPEN WITH` claimed "a clean run before the next wall of maturities hits in 2028" while `CALL ABOUT` said Nov 2027 was next (contradiction), and UHS's claimed the August pricing "gives it a natural window to roll the 2026 maturity" (unverified causal claim).

---

## Acceptance

1. `extractionPromptVersion` untouched; every table line byte-identical to baseline.
2. Determinism: warm-up run, then both books ×3, byte-identical, local and live.
3. Baseline diff — every changed line accounted for.
4. Item-by-item confirmation of all 10 (0, 1, 3, 4, 5, 11, 12, 13, 14, 16, 17): fixed, or diagnosed and why not.
5. Zero regressions in prior invariants: no bare lines, no missing sources, `CALL ABOUT` names a figure or date, no unnormalized figures, no blank statuses, **no annotation markers**.
6. Full live output for both books.
7. Test counts, live vs synthetic, reported separately.

Do not push until local determinism passes.
