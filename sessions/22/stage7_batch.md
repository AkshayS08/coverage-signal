# Session 22 Stage 7 — the signature-review batch, before any golden is written

Six names were hand-verified against filings (Tenet, DaVita, UHS, Encompass, Molina, CHS). Every ladder's amounts, subtotals, and totals are correct to the dollar, verified. No wrong number was found. Every defect below is in the presentation and facility/prose-reading layer, not the data. Nothing signs until these are fixed and the sheets regenerated. Everything here is a rule over the class; the named company is the worked example only.

Declare a Rule 13 cost shape before any paid step. Most of this is $0 (formatter, rendering, and code that runs after the answer cache). The facility/prose extraction (item 3) is the one likely bump; price it and STOP for approval before spending. Persist the cost log, and note it does not capture narration (Rule 43).

## The one root cause behind most of it

The debt-note table is read well. The surrounding narrative is read only partially. Facilities, stated zeros, capacity, split-lien priority, and events all live in prose sentences rather than table cells, and those are being dropped or mislabelled. Every item in section B is the same shape: a fact stated in a paragraph, not a cell.

## A. Signature-surface integrity (do first, $0, highest priority)

**A1. A displayed figure must be verified against the sentence shown beside it, not merely present somewhere.** The packet paired Tenet's revolver maturity (2030-11-04, real, correctly sourced to the 10-K) with the anchor's *size* sentence, which does not state that date, and attributed it to the wrong filing. That is composite fabrication on the signature surface. Fix: `PacketRow` carries each figure's own sentence, document, and placement; the artifact renders maturity provenance separately from row provenance wherever they differ and says plainly when a figure comes from outside the anchor. The self-check becomes a figure-to-sentence belonging check reusing the facility guard's existing `sentenceStatesFigure` rule (not a new weaker one), run on every figure of every row of every sheet. A presence-of-two-things check that passed while this was broken cannot be trusted until it verifies belonging. Four `maturityFromFacility` rows across the six names are known affected; find any others.

## B. Facilities and prose (the real capability gap)

**B1. Facility type is read from the instrument's own name first, then the section heading; it is "not stated" only when neither gives it.** Rows named "revolving credit facility", "Tranche A term loan", "ABL Facility", "Advances under revolving credit facility" all carry their type in the name, yet render "class not stated on this row". The type was almost never actually absent. UHS's term loan and revolver, Encompass's revolver, Molina's Credit Facility, CHS's ABL are the examples.

**B2. Rename the column "priority class" → "facility type".** The tool reads the filing's grouping label and the instrument name; it does not read the credit agreement's intercreditor terms, so it cannot assert a lien ranking. "Priority class" claims a ranking it has not verified (senior secured notes may be pari passu with a senior secured term loan, or not — only the credit agreement says). Name the column for what the tool knows. Carry the filing's full grouping label including the instrument word ("Senior Secured Notes", not "Senior Secured"). True lien-ranking / waterfall from intercreditor terms is a v2 capability, explicitly out of scope here.

**B3. A stated zero is a captured amount, not an absence.** Molina's revolver ("no amount was outstanding") and CHS's ABL ("no outstanding borrowings") state a drawn balance of zero in words; the tool renders "(no amount stated)". A filing that states a balance in prose — including zero — has stated it. Read drawn = $0. Same class as the em-dash-is-a-stated-zero rule; reuse that logic, don't build a second one.

**B4. Capacity must render.** Molina states a $1.25B Credit Facility; CHS states a $1.0B ABL with $751M available and $32M LCs; both are in prose and both render blank on amount. A facility carries drawn, letters of credit, available, and total size, each verbatim from the sentence that states it, each cited, with the arithmetic check (drawn + LCs + available = size) shown. This is the liquidity input: liquidity = cash + undrawn capacity, already specified, needs the capacity figure to compute.

**B5. Facility maturities are searched across the full corpus, not only the anchor table, and cited to the filing that states them.** DaVita and CHS print maturities in the debt table (easy, correctly read). Tenet's and UHS's facility maturities live in the credit-agreement prose or a prior filing — a facility whose maturity is stated anywhere in the corpus and falls in-window is a refi card, so the search must reach it. Where no filing states a date, the maturity is "not stated" (never guessed); where it is relative ("five years from funding", "364 days after funding"), it renders relative, never resolved to a false date. Every facility maturity cites the document that states it (per A1).

B1–B5 are one extraction/rendering change to how facilities are read from prose. Price them together.

## C. Priority stated in prose (CHS, the worked example)

**C1. Where a filing states a split or specific lien position in prose, capture it verbatim into the facility-type/provenance, do not render "class not stated".** CHS's ABL prose states "first-priority security interest in [receivables]... junior-priority third lien security interest in substantially all other assets" — the richest priority disclosure in the book, entirely in a paragraph, and the tool captures none of it. This is not the v2 waterfall (that derives ranking across instruments from intercreditor terms); this is transcribing a priority the filing states outright, same discipline as any other verbatim field. Where the filing states no lien position, "not stated" is correct.

## D. Ordering (must fix before demo — visibly wrong on the waterfall)

**D1. The seniority sort must rank senior above junior.** CHS renders its Junior-Priority Secured Notes at the TOP of the ladder, above its Senior Secured Notes. `PRIORITY_CLASSES` ranks junior-priority-secured above senior-secured; it is currently pinned to break loudly and it is breaking on CHS. Correct the rank order so senior secured precedes junior-priority precedes unsecured precedes subordinated, and CHS is the assertion. This is the single most damaging visible error for a debt tool — subordinated debt shown as most senior — and CHS is the only name with a real junior tranche, so it is the name that proves the fix.

## E. Display consistency (after verification, $0)

**E1. Cards and sheets display all amounts in $millions, one house scale, after verification.** DaVita renders "$1,975,000 thousand" beside Tenet's "$1,500 million"; normalize display to $millions ($1,975M, $1,500M) so a reader isn't converting scales across rows. Verification still holds the as-printed unit underneath (Rule: verify as printed, display normalized). Display-only, never touches the verified figure or the guard.

## F. The criteria and the reproducibility gate

**F1. Criterion 8c reads the real instrument-type field, not a by-hand confirm.** Once B1 lands, instrument type is a populated field; 8c should evaluate it, not defer to a signer, and for a filer whose names don't carry type (Tenet's bare "5.125% due 2027") it reads type from the heading, not "the names carry it" (which is false for Tenet).

**F2. amountBasis survives onto the assembled row.** The basis (face/carrying/outstanding) is carried on the extracted instrument and dropped when it becomes a row, so criterion 2 passes with a note rather than cleanly. Carry it through; it is a pinned field the golden should hold.

**F3. 9b reproducibility is real spend, and the honest names each need CACHE_BUST x3 before signing.** Only the three demo names were re-asked x3. The other three signable names (DaVita, Molina, CHS — and Encompass) each need x3 at the current version before their golden is written. Price this; it is the one unavoidable paid step at signature time.

## After the fixes

Regenerate the six sheets in the review-artifact format (same URL), verified figure-to-sentence throughout, facility types and capacities and stated zeros rendered, the ladder sorted senior-first, amounts in $millions. Present for signature. Write each golden only on signature, only after its CACHE_BUST x3. Then determinism x3 both books, suites, tsc, build, push, BRD v1.7, build-log close-out.

## Out of scope — v2 / post-demo, do not build

- True lien-ranking / waterfall derived from credit-agreement intercreditor terms across instruments (B2 renames the column precisely so this isn't claimed).
- Deriving a maturity month from a stated range floor (Tenet November 2027).
- The measured-vs-unreachable shared helper is already Rule 37; the guard-corpus-type-completeness (Rule 42) and cost-log-narration (Rule 43) items are audit-session, not this batch.

## Standing constraints

- Never suppress; a withheld figure keeps its instrument; a stated zero is a figure.
- One deciding function per rendered value; no two fields for one concept.
- Verify as printed, display normalized.
- Rules over instances; the audit session that follows tests every rule for company-specific residue.
