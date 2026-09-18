# Session 18 — the refi rebuild and the cash test

Starting state: Session 17 shipped. Determinism holds, renderer and language clean, `promptVersion` split into extraction and wording versions.

This session changes the extraction shape. It is the expensive one. Read the whole prompt before writing code.

## What this session fixes

**Refi.** HCA and Cigna render `no signal found` under Refi while both hold real maturities. The cause is structural: `debt-maturity` returns one answer per company, HCA has ten tranches, and the model fills the one slot with whichever tranche a newly issued bond had attached. No prompt wording lifts a one-slot limit.

**Wrong bucketing.** Five triggers fire on topic rather than cash: a pharmacy launch, a JV formation, a held-for-sale classification, and routine capex on four companies.

---

## Scope

**In scope:** the extraction prompt and schema, a new `position.ts`, a new checksum guard, `eligibility.ts` for the three new restrictions, the table and card renderers, `extractionPromptVersion`.

**Out of scope:** the taxonomy (report anything that would need it, do not edit), corpus selection, the card test itself (18 months, dated, not bare-year — unchanged), treasury depth, Item 3 market risk, the verification strip beyond item 9 below.

**Re-extraction:** all 10 names. One shape everywhere, no mixed old and new. Expect a long cold session and real API spend.

---

## PART A — Extraction schema

**A1. `debt-maturity` returns a schedule, not a fact.**

```
debtSchedule: [
  { instrument, rate, seniority, amount, maturityDate, dateGranularity, sourceLine }
]
reconcilingLines: [ { label, amount } ]
statedTotal: "$13.3 billion"
```

Prompt instruction is transcription, not judgment: copy every row of the long-term debt table. Do not select, rank, or summarize. `seniority` comes from the debt note's own section header ("Senior secured first lien notes:" / "Senior unsecured notes:"). Where the filing states no seniority, null — never guessed. `reconcilingLines` are the lines below the table: unamortized discount, issuance costs, finance leases, current portion.

Existing extraction rules still hold per row: copy dates never compute, bare year stays bare, money keeps its unit.

**A2. `new-debt-issuance` gains `redeems`.**

Verbatim description of the notes named as being redeemed or repaid, or null. Copied, never inferred. Tenet's November 2025 8-K names exactly what it redeems and is the validated test case.

**A3. The stated-amount test.**

```
cashAmount:   the amount the filing states for this event, or null
projectName:  the discrete project the filing names, or null
```

`cashAmount` is the amount the filing itself states. A classification, an announcement, or a launch with no stated amount is null. Do not extract direction — the trigger's bucket already carries it, and a second source of truth can disagree with the first.

**A4. Coverage rule.** Every filing in the corpus must produce an answer: this event, or none. Assert `filings read = filings answered` per company per run.

---

## PART B — Position assembly (new `position.ts`)

Pure code. No model calls. Reads cached answers only, so rebuilding a position is free.

1. Base ladder = newest 10-Q or 10-K `debtSchedule`.
2. Apply every 8-K dated after that filing, newest last. An issuance whose `redeems` names a tranche removes that row and adds its own.
3. Newest filing wins per tranche. **Match on instrument description + rate + maturity together, never on amount alone.** Tenet holds two $1.5B 2027 tranches distinguished only by lien.
4. Mark each row `live` · `retired` · `unconfirmed` (no longer listed, no filing explains it).
5. Sort by maturity date.

The gate reads the position, not raw trigger answers.

**Delete on the way out:** the condenser's tranche-clause picker, the `(+N more tranches to YYYY)` suffix, and the same-citation refi/new-debt dedup. All three are approximations of what the position now knows. If any of them is still called after this session, the layer is not wired correctly.

---

## PART C — The checksum guard

Sum `debtSchedule` amounts, add `reconcilingLines`, compare to `statedTotal` within a stated tolerance.

- **Ties:** the refi bucket header states completeness — `ladder complete — 10 tranches, $43.1B, ties to 10-Q ✓`.
- **Does not tie:** render the ladder anyway with `does not tie — $X unaccounted`. **Never suppress.** Suppression is the A1 mistake: deleting a line asserts something false.
- Report the tie rate across all 10 companies. That number is the session's headline result. Expected first-attempt failure causes, in order: reconciling lines missed, current-portion split, finance leases outside the note.

What it proves: completeness only. A row with the right amount and the wrong maturity year still sums. Field accuracy stays the fact guard's job.

---

## PART D — Gate restrictions (all three are restrictions, none creates a card)

**D1.** A tranche cards only if the position marks it `live`. `unconfirmed` and `retired` never card.
**D2.** `cashAmount: null` never cards, any trigger.
**D3.** A completed event older than 12 months sorts to the bottom of its bucket and renders its age (`Mar 2025 · 17 months ago`). Never suppressed.

The card test itself does not change. 18 months, dated, not bare-year. What changes is what the gate is allowed to look at.

---

## PART E — The seven carried items, resolved as consequences

Confirm each, do not patch individually:

**2.** HCA and Cigna Refi shows the real ladder, not `no signal found`.
**6.** Cigna's HCSC sale (March 2025) sorts to the bottom of Treasury with its age shown.
**7.** Cigna's Evernorth EnGuide launch → `cashAmount: null` → table.
**8.** Quest's Corewell JV → `cashAmount: null` unless a contribution amount is stated → table.
**9.** Centene's `$293M held for sale` → a classification, `cashAmount: null` → table.
**10.** Routine capex (HCA $2.35B, Quest $252M, Tenet $348M, DaVita $271.8M) → amount present, `projectName` null → New debt table line labelled period spend. **Keep the line.** Deleting it implies zero capex.
**15.** Encompass's tranche-count phrasing disappears with the `+N` suffix.
**18.** Seniority reaches the card, free, as a row field.

**Reverse assertions — required.** Without these you cannot tell discrimination from blanket suppression:

- UHS's Miller Medical Plaza (80,000 sq ft, completion Q4 2026) **still cards**. Amount plus named project.
- A divestiture with stated proceeds **still cards**.
- Tenet's carded 5.125% first lien due Nov 2027 **stays live** after the Nov 2025 redemption is applied. That 8-K retired the 6.250% second lien due Feb 2027, a different tranche. The retirement logic must correctly do nothing here.

**E1. Redemptions must reach the card, as a rule over the data.**

Where a card concerns a tranche on a ladder, and the position layer applied an issuance whose `redeems` field is populated to that same ladder, the card must state the redemption as part of the issuance fact — copied from the field, one filed fact, no relationship asserted between two.

Assert this over **every** card in both books, not one company. For each card: if its company's position has an applied redemption, the card text names it; if not, nothing is added. A fix that satisfies one company's card and leaves the rule unimplemented fails this item.

Worked example, Tenet, for shape only:

```
· On November 18, 2025, Tenet issued $1.5B of 5.500% first lien notes
  due 2032 and $750M of 6.000% senior notes due 2033, redeeming the
  6.250% second lien notes due February 2027.
```

Expect bullet pressure: with the redemption occupying a slot, weaker supporting bullets (buybacks, general cash) should fall out under the 2 to 4 limit. Report which bullets each card dropped.

**E2. Card citation count must equal distinct filings cited.**

Session 17's card-citation union used token matching, and one card reported 6 citations against 4 named filings. Either duplicates are being counted, or filings that merely share vocabulary with the drafted text are being attributed as sources.

Assert across every card: the citation count equals the number of distinct filings, and every cited filing is one whose facts the card text actually uses. Diagnose the Session 17 discrepancy and report the cause before changing anything.

**No vocabulary guards.** No word list for "launch" or "joint venture." A word filter would kill a real proceeds event that happens to mention a launch. Structural tests only: is there a stated amount, is there a named project.

---

## PART F — Render

**F1. Refi bucket, table:**

```
REFI         ladder complete — 10 tranches, $43.1B, ties to 10-Q ✓
  · $2.0B 5.375% senior notes due Feb 2027 — 6mo out   CARD ABOVE
  · $1.5B 4.125% senior notes due Jun 2029 — 34mo out
  · 8 more tranches, 2030 to 2036
                                            10-Q 2026-07-28 ↗
```

Nearest tranches named individually, the tail collapsed. Seniority on every row where the filing states it. Status shown for `unconfirmed` rows.

**F2. Card:** seniority in `CALL ABOUT`; the applied redemption available as a KEY POINT where it explains a live tranche.

**F3. Empty buckets say what was checked.** `no signal — 4 triggers checked, cash flat QoQ`.

**F4 (last, renderer only, after everything else passes).** Verification strip on cards, computed from guard results already in the pipeline:

```
VERIFIED     ✓ 4 figures matched to source  ✓ ladder ties to $13.3B
             ✓ redemption applied — carded tranche outstanding
```

No model. Skip this if anything above is unstable.

---

## Baseline diff — modified for this session

Per-line accounting does not work here. Every refi line across ten companies changes on purpose.

**Category accounting.** Every changed line must belong to one of three categories: refi rebuild, bucketing fix, Session 17 carryover. A line that fits none of the three **stops the session**. A Treasury line changing where no Treasury logic was touched is a stop. A refi line changing is expected and needs no individual explanation.

---

## Acceptance

1. Checksum tie rate across all 10 companies, reported as the headline number.
2. Coverage assertion passes: filings read = filings answered, every company.
3. All seven carried items confirmed as consequences, plus all three reverse assertions passing.
4. E1 (redemptions on cards) and E2 (citation count) asserted across every card in both books, not per company.
5. HCA and Cigna Refi buckets show real ladders.
6. Determinism: warm-up run, then both books ×3, byte-identical, local and live.
7. Category diff: every changed line attributable, nothing unexplained.
8. The condenser's tranche picker, the `+N` suffix, and the same-citation dedup are deleted, not bypassed.
9. Rename the wrong-bucket invariant to what it actually checks — trigger-to-bucket mapping holds. Whether a trigger should have fired is items 6 through 10, verified separately. An invariant that claims more than it tests produces false confidence.
10. Test counts, live vs synthetic, reported separately.
11. Full live output for both books, for RM review.

Do not push until local determinism passes.

---

## Two rules that apply directly to this session

**Fields before responsibility.** Session 10 moved event judgment into code that lacked the fields to judge with, and every test still passed. The new fields and the rules that read them ship in the same change, never one after the other.

**Test the machine you ship.** Assertions read the HTTP response body of an actual run, never a fixture. The golden tests once passed 31/31 against a saved fixture that was itself an answer cache, while the deployed app re-rolled the dice on every click.

**Never fix the instance.** Company names in this prompt are worked examples of a rule, never the target. A change that makes Tenet's card read correctly while the rule behind it stays unimplemented has fixed nothing — the next company with the same shape fails silently, and no test catches it because no test was written about the shape. Every assertion here applies across all 10 companies, both books.
