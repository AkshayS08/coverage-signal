# RM review — Session 18 stage 2 output, both books

Full read of all ten companies. Rules over the data. Company names show the shape, never the target.

**The pattern underneath most of this:** every fix landed on the surface it targeted and was verified there alone. The money formatter reached ladder rows but not bucket lines or movement deltas. The aggregate label reached the header but not the rows below it. The multi-period collapse reached some triggers but not capex. Each rule below must be asserted on **every surface that renders that kind of value** — card body, card footer, ladder row, movement delta, adjustments line, bucket bullet, header, badge — and the report must state which surfaces each rule now reaches.

---

## BLOCKING — must be settled before anything else

### 0. Is this artifact the product, or a review run sheet?

The screen currently carries internal machinery: `WAS THREE BEFORE E5`, `exactly the case E4 exists for`, `card created by D1 — the whole of 2027 falls inside the window`, `RE-EXTRACTED UNDER THE NEW LOCATOR`, `the fraction-glyph coupons that made this table invisible to the old locator`, `All 7 of its drops are prior-period entries... the conflation that made this ladder look 44% incomplete`, and a per-card API cost (`2 calls, $0.0452`).

If this is a review artifact, say so and it's fine. If any of it renders in the product, none of it can stay — an RM does not know what E5 or D1 are, and a card that explains its own rule numbering is not a call sheet.

Answer this first. Several items below depend on it.

### 1. The card citation assertion is not firing

E6 was reported as "zero gaps across the book on the mechanical check." It is not holding: a card cites a filing dated February and states a cash balance as of June 30 of the same year. A filing cannot report a period that ends after it was filed.

The assertion as specified — no card states a period-end date later than its newest cited filing's date — would catch this. Diagnose why it passed, then fix. A guard reported as passing while the defect it exists for is on screen is worse than no guard.

---

## THE FORMATTER — one function, every surface

### 2. Money rendering

Currently on screen across companies: `$2,350 million`, `$3,890 million`, `$1,435,000 thousand`, `$2,000,000 thousand`, `$2,357,910 thousand`, `$488,435 thousand`, `$600,000,000`, `$500,000,000`, `$271,836 thousand`, `10,847,516` (no unit at all), alongside correctly formatted `$2.8B` and `$699.9M` in the same block.

One formatter. Billions above $1B with one decimal, millions below, no "thousands", no plural "millions", no raw digit strings, no unit-less integers. Applies to card body, card footer, ladder rows, movement deltas, adjustments lines, bucket bullets and completeness notes alike.

### 3. Movement deltas are unformatted and probably wrong

Rendering `up $700,000 from $787.7M`, `up $300,000 from $393.8M`, `up $1M from $499M` — raw dollars beside millions on the same line.

The formatting is the small half. The larger question: a fixed-rate note nobody touched does not move by $700K. These are almost certainly unamortized discount amortizing, which means those rows carry **carrying value** while other rows carry **face value** — two different measures in one column.

Diagnose before formatting. Report which measure each row carries and whether the movement is a real principal change or an accounting accretion. A delta that invites an RM to ask about something that did not happen is worse than no delta.

### 4. Tranche counts contradict the body

Header says N tranches; body shows 3 plus "M more" where 3 + M ≠ N, on four of ten companies. One company's line "includes 6 repaid (nil balance) and 1 matured" suggests the header counts live rows while the collapsed count includes all statuses.

State the rule, apply it consistently, and make the two numbers agree on every company. If the header means live tranches, say live.

---

## THE LADDER

### 5. The aggregate label contradicts the rows beneath it

One company renders "aggregate disclosure — N lines reported as category totals, **no individual tranche maturities stated in this filing**" directly above three individually named tranches with rates and maturity years.

E3 relabelled the header and left the rows. The label and the rows must derive from the same test.

### 6. An aggregate rollup and its own priced tranches both render

Where a company discloses debt as category rollups, its aggregate line cannot be matched against individually priced tranches from an 8-K, so both render and the tranches sit inside the aggregate that already contains them. One company shows this as "4 more tranches, 2095" — four tranches all maturing in a single far-future year, which is not a real instrument.

This is the dedup rule's known gap. State how an aggregate row and a priced tranche relate, render one or the other, and never a count that implies four bonds maturing in 2095.

### 7. Adjustments lines carry no context

Rendering as bare label-and-number: `($66.5M) Discount, premium and deferred financing costs · ($117.2M) Less current portion`, `($85M) Unamortized issue costs and note discounts`, `($192M) Less: Unamortized deferred debt issuance costs · ($26M) Less: Current maturities`.

An RM has no way to read what these adjust or what they reconcile to. Render the walk instead: tranches sum to face value, less the adjustment, ties to the stated total. That makes the reconciliation visible rather than implied, which is the point of showing it at all.

Note the underlying distinction, which should be stated: tranche rows carry face value, the total carries carrying value, and the adjustment is what bridges them.

### 8. A no-schedule block still renders a ladder

One company's badge reads NO SCHEDULE with "walk: nothing to walk" and "anchor: no comparison", then renders two live tranches immediately below. Those two rows are legitimate — post-period 8-K issuances, correctly labelled — but the block asserts nothing exists and then shows something.

Reconcile the badge with what renders. A block that contradicts itself in the first two lines loses the reader.

---

## BUCKETS AND DEDUP

### 9. Within-bucket duplicates

One company's hedging bucket carries the same fact twice: UK revenue of $1.001 billion in 2025 as its own bullet, and again inside a foreign-currency exposure bullet that restates the same figure. E9 deduped across buckets and not within one.

### 10. Cross-references truncate mid-sentence

`also relevant here; shown under Refi (debt maturity)` renders cut off. E8's sentence-boundary rule and E9's cross-reference collide. Every rendered string goes through the same truncation rule.

### 11. Bucket mappings still wrong

- Acquisition purchase consideration (cash plus non-controlling-interest valuation) renders under New debt on two companies. It is not new debt.
- Pharmacy cost exposure renders under FX / rate hedging. Reported as taxonomy-correct by its own definition; the mapping is still wrong for an RM. Report what a taxonomy change would involve, do not make it.
- Routine period spend renders under New debt with a period-spend label on some companies and without on others. Apply consistently.

### 12. Multi-period comparisons still render both periods

`$2,350 million for the six months ended June 30, 2026 and $1,119 million for Q1 2026` and `$152 million during the six months ended June 30, 2026, compared to $176 million in the prior year period`. The most-recent-period rule reached some triggers and not capex.

---

## CARDS

### 13. Bullets still join facts

A bullet reading "issued X and Y, redeeming Z and partially redeeming W" is four connected facts. It passes because the source filing states it in one sentence, but the rule is one fact per bullet.

State the rule as: a bullet asserts one fact with its figure. A source sentence containing several facts is split, not copied.

### 14. Bullets that do not serve the call

Cards about a 2027 maturity carry bullets on cash balances, buybacks, and dividend increases. Those are portfolio facts, not reasons to make this call. Where a company has a ladder, the ladder shape is the stronger supporting bullet.

Rule: supporting bullets relate to the tranche the card is about, or to the company's capacity to address it. A share repurchase authorization does neither.

### 15. Cards imply precision the filing does not state

A card created because the whole of a year falls inside the window reads "now about 16 months out". Only December of that year is 16 months out; the filing prints no month. Where the month is unknown, the card says the year and does not compute a month count.

### 16. WHY NOW still advises

"showing the same playbook is available to address the December 2027 notes ahead of maturity" and "showing the market is open for exactly this kind of deal" are market judgments, not filed facts. The closed word list does not catch a capability claim phrased as availability.

The structural version: WHY NOW may state facts and their temporal or arithmetic relation. It may not characterise what is possible, advisable, or available.

---

## DATA GAPS — diagnose, report before fixing

### 17. A divestiture is missing

One company's Treasury bucket shows one hospital divestiture; its filing describes two, the second materially larger. Report whether the second was extracted and dropped, or never extracted.

### 18. Debt repurchases described in prose never reach the ladder

The same company's debt note describes a February special call and an April–May tender offer, both funded and both confirmed by the column movement between periods. The ladder shows only ending balances. Report whether any repurchase not carried by an 8-K `redeems` field can reach the ladder at all today.

---

## WHAT READS RIGHT — do not regress these

- A withheld card explaining its own failure, with the ladder beneath it stated as unaffected.
- `card above` linking a ladder row to the card it produced.
- The dedup rule explaining itself on screen: a row carrying the note's amount rather than the 8-K's issue size.
- A ladder stating "includes 6 repaid (nil balance) and 1 matured" rather than hiding them.
- "Nearest maturity is 19 months out, past the window" as the reason for no card.
- The read-failure banner that says the note was located, transcribed, and could not be trusted, and that an older ladder is deliberately not substituted.

These are the lines that make the tool checkable rather than merely confident. Any change above that would weaken one of them is the wrong change.

---

## Constraints

- Report which surfaces each rule reaches after the fix, not just that the rule exists.
- Group into code-only and anything needing a bump; report the split before spending.
- Never suppress. A line that cannot render correctly renders with its problem stated.
- Rules first, never instances.
