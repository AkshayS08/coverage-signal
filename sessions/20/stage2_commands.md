# Stage 2 — the fixes, from the stage 1 evidence and two hand-reads

Rules over the data. Company names show the shape, never the target. Every assertion applies across all 10.

Grouped by what it costs. Report the split before spending anything.

---

## GROUP A — Verification is too generous. This is the priority.

Three fabricated rows are on the rendered ladder right now and cleared verification. The mechanism is not company-specific and not fraction-specific.

**A1. An amount must be found near its own row, not anywhere in the document.**

Today `amountAppearsIn` scans for any 3+ digit match across the whole filing. In a 183,000-character document, `350`, `400` and `708` all appear somewhere — one of them from the cash flow statement — so a fabricated row passes by borrowing a real instrument caption and a number that exists anywhere.

Rule: an entry's amount must appear within the located note span, and within a bounded distance of the instrument text it is claimed for. Out of range is not corroboration.

**A2. Co-occurrence must not be satisfied by the caption alone.**

The fallback currently accepts a real instrument name plus a loose amount match. That is exactly what a fabricated row looks like. Rule: co-occurrence requires the instrument identity *and* its amount within the same bounded region. Report how many entries book-wide still pass on co-occurrence after A1 and A2.

**A3. A ladder that fails check 1 by more than a stated tolerance does not render its rows as fact.**

One company's walk is off by $6.07B and its rows render normally beside the failure notice. Rule: where check 1 fails by more than a threshold of the stated total, the ladder renders the failure and the source link, and does not present individual rows as verified. Never suppress the fact that a ladder exists — suppress the claim that these particular rows are it.

---

## GROUP B — The locator, and the assertion that should have caught this

**B1. The coupon pattern is blind to fraction glyphs.**

`COUPON_NEAR_YEAR_RE` requires a decimal point, so a table printing `4¾%`, `6⅞%`, `10⅞%` is invisible to the detector. Density then clusters on narrative prose elsewhere in the filing, which does use decimals. Rule: the pattern matches decimal *and* vulgar-fraction coupons.

**B2. Heading-first selection, with density as fallback.**

The debt note announces itself in plain text — a numbered heading whose title contains "debt" — a few hundred characters before its table. Today that heading is used only to audit the chosen span, never to find it.

Rule: locate the heading, take the block that follows it, and fall back to density plus magnitude only where no heading survives stripping. This was raised earlier and deferred on the grounds that density was correct where it mattered; the evidence since shows a company where density selected prose inside the right note and the table was never spliced.

**B3. The heading assertion is too weak — it must assert a table, not a heading.**

A span containing the heading but not the table currently passes. Rule: the located span must contain rows carrying amounts, or the note's own stated total. Report which companies pass under the stricter form.

---

## GROUP C — Verified-drop classes with confirmed mechanisms

**C1. An em-dash amount is a stated zero.**

`$ —` means the balance is zero, which means the tranche was repaid. Two faces, one rule: it resolves to zero rather than indeterminate scale, and the dash must not break literal verification when the model omits the cell while transcribing a two-column row. Those rows render as repaid — a repaid tranche is a fact an RM wants, not a drop.

**C2. Assert that extraction chose the matching column.**

Column binding already keys on the filing's own report date and correctly discards mismatches. Two gaps: nothing asserts per filing that extraction *selected* the right column, only that wrong ones get discarded; and a wrong figure carrying a right column label binds cleanly. Add the per-filing assertion, and report any entry whose amount does not appear in the column it claims.

**C3. Distinguish "wrong column" from "no schedule" in the search-order fallback.**

A filing whose rows were all discarded for period mismatch is currently indistinguishable from a filing with no debt note, so the search walks silently back to an older filing and the ladder renders clean while months stale. Rule: all-rows-discarded-for-period is a read failure, reported loudly, and does not trigger the fallback. Only a genuinely absent schedule does.

---

## GROUP D — Dates and the card gate

**D1. A bare year cards when the whole year falls inside the window.**

The Dec-31 convention is safe for excluding because the latest possible date is outside. The same arithmetic includes: if January 1 and December 31 of that year are both within 18 months of today, every possible date is inside, and the row cards on the year alone. Where only part of the year falls inside, it stays table-only.

Pure arithmetic. No month needed, no inference. This is the general form — it applies to every bare-year row on every ladder, not to any one company.

**D2. Month recovery searches the whole located note, not the row's own line.**

Filings state maturity months in prose around the table — a maturity-range sentence, a redemption discussion. Rule: search the located note text for a month attached to that row's year, and apply it only where exactly one candidate month exists for that year; two or more and it stays year-only.

The earlier finding that year-only rows have no month anywhere searched only row lines and undercounted. Re-report the recoverable count against full note text.

**D3. A maturity date in the past means matured.**

Nothing compares a row's maturity to today, so a ladder from an older base filing renders an already-matured tranche as live. Rule: maturity before today marks the row matured, never live, never cardable. Then check whether any issuance in the corpus refinanced it and state that where found; where nothing states it, say nothing.

**D4. 8-K redemption language must reach the ladder.**

Report whether any 8-K in a company's corpus names a tranche on that company's current ladder, and what the ladder does with it today. Diagnosis first.

---

## GROUP E — Render and card content, from the RM read

**E1. The verdict badge must carry base-ladder drops only.** A drop count summing all four arrays marks a company partial for discarding a prior-period comparison no check ever reads. Count base-ladder drops.

**E2. Check 2 matches category, not proximity.** The anchor picks the numerically nearest subtotal. Where the captions being summed include short-term borrowings and the nearest subtotal is long-term only, the gap equals the short-term subtotal exactly. Compare against the subtotal whose category matches the captions being summed, and report both categories when it fails.

**E3. The "aggregate disclosure" label is derived from the wrong signal.** It currently renders above tables of individually identified tranches, because it is inferred from date granularity. Base it on whether rows carry per-tranche instrument identity — a named instrument with its own rate — not on date precision.

**E4. Cards narrate the outstanding balance, not the original issue size.** The ladder holds both: the instrument label carries the issue size, the amount column carries what is outstanding. Narration is using the label.

**E5. One refi conversation per company.** Multiple debt-maturity rows collapse into a single refi card naming the nearest tranche, others as KEY POINTS. A maturity plus a non-refi event stays two cards — the per-company cap was removed deliberately for that case and must not return.

**E6. A card cannot cite a filing that predates the facts it states.** Assert: no card states a period-end date later than its newest cited filing's date. The citation set is the union across every fact the card draws on, ladder or not.

**E7. One money formatter at the display layer.** Currently rendering `$ 1,500 millions`, `$ 2,750,000 thousands`, `$699,887 thousand`, `$600,000,000`. Billions above $1B with one decimal, millions below, no "thousands", no plurals, no raw digit strings. Cards, ladder rows, adjustments and bucket lines alike.

**E8. Truncation cuts at a sentence boundary or not at all.** Mid-word cuts have returned on multiple companies. A cap tuned to a corpus measurement will keep breaking as the corpus moves.

**E9. A fact appears in exactly one bucket.** The same facility renders in both New debt and Hedging on one company. Dedup by fact; where genuinely relevant to two buckets, it belongs to its primary and is cross-referenced.

**E10. WHY NOW states facts and their relation, and does not advise.** Strip judgment phrasing.

**E11. Bucket corrections.** Purchase consideration for an acquisition is not new debt. Multi-period comparisons collapse to the most recent period. Hedging is rate, FX or commodity exposure. Routine period spend with no named project is not a project — report whether each is renderer-fixable or taxonomy-level, and do not edit the taxonomy.

**E12. Timing and status must not contradict the row.** One row shows a maturity date and "date not verifiable" simultaneously; another shows a current-period balance tagged with a prior announcement date. The status date and the row's own date come from the same fact, or the status is omitted.

**E13. Show the prior balance beside the current one where it exists.** A tranche whose balance moved between periods is a fact — falling is deleveraging, rising is a draw — and it currently renders as a static list. Available for 7 of 10 today via the prior filing's own current column. No prose parsing, no inference about why.

---

## Sequencing and constraints

- **Group A first.** Fabricated rows on a rendered ladder outrank everything else here.
- Group B second — it is the upstream cause of Group A's worst case.
- One substantive change per paid run still holds. Split the above into code-only (validated free against the cache) and anything needing an extraction bump, and report the split before spending.
- Persist line-level output this session so the next diff has a baseline.
- Never suppress. A line that cannot be rendered correctly renders with its problem stated.
- Rules first, never instances.
