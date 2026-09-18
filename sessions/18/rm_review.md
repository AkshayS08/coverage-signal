# RM review — Session 18 output, both books

Full read of all 10 companies. Three stages: diagnose, then fix, then decide. **Nothing in stage 1 changes code.**

Everything below is a rule over the data. Company names are worked examples showing the shape, never the target.

---

## STAGE 1 — Diagnose first, no code, free against the v16 cache

### 1.1 The drop rate is the load-bearing unknown

CHS 15 of 31 dropped, Molina 7 of 16, Cigna 6 of 44, DaVita 3 of 29, Quest 2 of 36. Check 1's failures are largely a consequence: dropped rows cannot sum to a subtotal that includes them.

The report currently gives one blended reason — "failed sourceLine verification, wrong period column, or indeterminate amount scale". That is three different problems in one string.

**Report, per company, per dropped entry:** the reason, the raw entry as extracted, and the specific text that failed. Then group by cause across the whole book and give the count per cause.

This determines whether the book is one bug from reconciling or five. Everything else in stage 2 is smaller than this.

### 1.2 Molina reports RECONCILES on a ladder missing 44% of its rows

Green badge, both checks tie, no completeness flag, 7 of 16 rows dropped. The walk found a subtotal covering only the rows it kept.

That is the failure mode the checksum exists to prevent, and the verdict is silent about it. **Diagnose how a subtotal reconciled against a partial row set** — is the subtotal itself one of the survivors, or is it being matched loosely?

### 1.3 Does the position layer apply 8-Ks dated after the base filing?

Two companies show a stale base with newer activity sitting beside it:

- A ladder sourced from a February 10-K, with an August offering rendered in New debt.
- A ladder whose first row is a March 2026 maturity, rendered as live, from a base filing dated February 2026 — the date has since passed.

**Report whether post-base-filing 8-K issuances and redemptions are applied to the ladder at all, and what happens to a row whose maturity date is now in the past.**

### 1.4 Where has month precision gone?

A tranche renders `year only` and is gated to the table, while an earlier session's card for the same tranche named the month. Another company's rows carry full dates and card correctly.

**Report, book-wide: how many rows are `year only`, and for each, whether the month appears anywhere in that company's corpus** — the instrument description, the balance-sheet caption, an 8-K naming the same tranche. Month recovery was implemented for one company's shape; report whether it generalises.

---

## STAGE 2 — Fixes, after stage 1 is reported

Each is a rule. Apply across all 10 companies.

### 2.1 The verdict must carry the drop count

`RECONCILES` on a ladder with dropped rows is a false all-clear. A ladder with any dropped entries cannot be `pass`; at best it is `pass-partial`, and the badge states the drop count. Completeness and reconciliation are different questions and the badge currently answers only one.

### 2.2 Check 2 must match category, not proximity

The balance-sheet anchor picks the numerically nearest subtotal. Where the captions being summed include short-term borrowings, the nearest subtotal may be long-term only, producing a gap exactly equal to the short-term subtotal.

Rule: the anchor compares against the subtotal whose category matches the captions being summed. Report the categories on both sides when it fails.

### 2.3 The "aggregate disclosure" label is inferred from the wrong signal

Several companies render "aggregate disclosure — N lines reported as category totals, no individual tranche maturities stated in this filing" directly above a table of individual tranches with rates and maturity years. The label is being derived from date granularity.

Rule: base it on whether rows carry per-tranche instrument identity (a named instrument with its own rate), not on date precision. A ladder of rate-identified tranches is not an aggregate disclosure regardless of whether the filing prints months.

### 2.4 Cards must narrate the outstanding balance

The ladder holds both: the instrument label carries the original issue size, the amount column carries what is outstanding. Narration is using the label. Rule: cards state the outstanding amount; the original issue size may appear only if labelled as such.

### 2.5 One refi conversation per company

Multiple debt-maturity rows for one company collapse into a single refi card naming the nearest tranche, with the others as KEY POINTS. A maturity plus a non-refi event stays two cards — the per-company cap was removed deliberately for that case and must not return.

### 2.6 A card cannot cite a filing that predates the facts it states

Cards state period-end figures later than their newest cited filing's date, and reference events not in any cited filing. The citation union was fixed for ladder facts and does not cover facts drawn from elsewhere.

Rule: the citation set is the union across every fact the card text draws on, ladder or not. **Assert: no card states a period-end date later than its newest cited filing's date.** That assertion is mechanical and catches the whole class.

### 2.7 Money rendering, one function at the display layer

Currently rendering: `$ 1,500 millions`, `$ 2,750,000 thousands`, `$699,887 thousand`, `$600,000,000`, `$ 788.4 million`.

Rule: one formatter. Billions above $1B with one decimal, millions below, no "thousands", no plural "millions", no raw digit strings. Applies to cards, ladder rows, adjustment lines and bucket lines alike.

### 2.8 Truncation must cut at a sentence boundary

Mid-word truncation has returned on multiple companies ("...Medical Center) to", "effective Janua"). The character cap was sized against the corpus and the corpus moved. Rule: cut at a sentence boundary or do not cut. A cap tuned to a measurement will keep breaking.

### 2.9 A fact appears in exactly one bucket

The same facility renders in both New debt and Hedging on one company. Rule: dedup by fact, not by bucket. Where a fact is genuinely relevant to two buckets, it belongs to its primary bucket and is cross-referenced, never duplicated.

### 2.10 WHY NOW states facts and their relation; it does not advise

Strip judgment phrasing — "ample liquidity to prefund or opportunistically refinance", "well-positioned to address this maturity". The relation between two filed facts is allowed; a recommendation is not.

### 2.11 Bucket corrections, all rule-shaped

- **Purchase consideration for an acquisition is not new debt.** Cash plus non-controlling-interest valuation renders under New debt on one company.
- **Multi-period comparisons collapse to the most recent period.** A capex line renders both the current and prior six-month figures. This is the item 14 rule regressing on a different trigger.
- **Hedging is rate, FX or commodity exposure.** Pharmacy cost exposure is rendering there. Report whether that is renderer-fixable or taxonomy-level; do not edit the taxonomy.
- **Routine period spend is not a project.** Capex with an amount and no named project renders under New debt with no period-spend label.

### 2.12 Timing and status must not contradict the row

One row shows maturity `2026-03-01` and timing `date not verifiable` simultaneously. Another shows a held-for-sale balance as of June 30, 2026 tagged `announced Dec 2025`. Rule: the status date and the row's own date come from the same fact, or the status is omitted.

---

## STAGE 3 — Decisions for me, not fixes

Report and stop.

- **The standing gate above D2.** A named building with a stated completion date fires as `standing`, so the capex exemption is never reached. Extraction-layer, needs a version bump, my call after stage 1.
- **Rows whose maturity has passed.** A ladder from an older base filing can carry a tranche that has since matured. Whether that renders as matured, is dropped, or forces a re-fetch is a design decision.

---

## Constraints

- Stage 1 is diagnosis only. No code, no version bump.
- One substantive change per paid run still holds. Group stage 2 into code-only fixes (no bump, validated free against the v16 cache) and anything needing extraction changes (bump, separate run).
- Persist line-level output this session so the next diff has a baseline.
- Rules first, never instances. Every fix above is asserted across all 10 companies.
- Never suppress. A line that cannot be rendered correctly renders with its problem stated.
