# Session 22 — the semantics layer, and a demoable ten-name book

Read the numbered rules at the end of `coverage_signal_build_log.md` before any code. Everything below is a rule over the class; the named company is the worked example only. A change that satisfies the named company while the rule stays unimplemented has fixed nothing.

Work in stages, STOP at each, nothing after a STOP starts until the report is reviewed. Findings log forward to a later session unless a wrong number would render as a position. Budget: $10 authorized, stop-and-ask above it. Every paid run declares its Rule 13 cost shape and result shape first and persists the per-company cost log (Rule 20). A declared shape is span-identity plus attributable model variance, never byte-identity across a bump. Golden files are written only against all nine criteria (goldenCriteria.ts), each reproduced CACHE_BUST x3.

## The purpose, and the order it dictates

The demo script (BRD §13.3) is three names in an arc: Tenet (the position), Encompass (the conversation), UHS (the method). Those three must be perfect. The other seven must be honest. So this session does the three demo names' items first, stops to confirm all three are perfect, and only then widens to the seven. The semantics layer built for the three is the same layer the seven need, so building it demo-first is not throwaway — it is the general fix, proven on the names that matter most.

## Stage 0 — the text-block pre-check ($0)

Before anything, measure: how many of the ten companies expose a non-empty debt text-block tag (the filer's own tagged debt-note boundary) in their 10-Q inline XBRL. Report the count and the per-company yes/no. This decides whether the text-block becomes the primary locator anchor (if ~10 of 10) or a first-among-fallbacks (fewer). Do not build the anchor yet; this measurement scopes the roll-forward stage. STOP with the count.

## Stage 1 — render hygiene, book-wide ($0)

Cheapest, and it touches all three demo names. Delete the leaked eligibility reason ("the whole year falls inside the 18-month window") from every rendered card; it is why a card exists, not something an RM reads. One house number format at render — $1.5B / $396.9M, one decimal, abbreviated — applied everywhere, with verification still holding the as-printed figure underneath. Pluralise month counts. Replace the month-count computation with calendar months against a stated convention (named once in the BRD), never days divided by an average month; this is the root of both the "20 vs 21" ambiguity and the earlier "0 months out" bug (Rule 28). Verify the three demo cards render clean. STOP.

## Stage 2 — priority class and instrument type (the semantics layer's structural half)

This is Tenet's demo blocker and DaVita's hold, and it is the confirmed book-wide absence: rows carry a section string used only for subtotal matching; no priority class or instrument type is derived, normalized, rendered, or ordered on.

- A `priorityClass` field on every row, mapped from the filer's own section heading and any stated seniority language, normalized to a fixed set (senior secured / first lien / second lien / senior unsecured / subordinated / mezzanine / other), verified against the note like any other field. Where the note states no class, the row reads "class not disclosed", never a default of "unsecured".
- An `instrumentType` field on every row (senior note / term loan A / term loan B / revolver / delayed-draw / finance lease / other), from the same headings and the instrument's own name.
- The ladder renders the class and orders by the seniority stack, not by maturity alone.
- Tenet is the worked example (senior unsecured vs senior secured first lien, printed as separate sections, currently flat); DaVita is the second (Senior Secured Credit Facilities vs Senior Notes). Confirm both render with class and type, and that no single-class filer (Centene, Quest, Molina) regresses.

STOP with Tenet and DaVita's rendered ladders and the book-wide class/type coverage.

## Stage 3 — facilities located in their own span (the semantics layer's facility half)

Encompass's demo blocker and the biggest structural gap from the card review: an undrawn facility has no balance row, so it never appears in the debt table, and the tool currently sees facilities only where drawn and tabulated. Quest states a $750M revolver and $600M receivables facility, both undrawn, $1.3B available, in its MD&A and a letters-of-credit note; the card says "no revolving facility."

- Facilities are located by their own content across the MD&A liquidity / capital-resources section, the debt-note prose, and any facilities note — not only the debt-note span.
- Each facility extracts size, drawn, letters of credit, available, maturity, and as-of date, verbatim and verified against the sentence that states each field (this absorbs the carried "revolver fields verified as a sentence not against it" and "drawn revolvers show no capacity line" items — one fix, closed once).
- The arithmetic check drawn + LCs + available = size renders as its own flag.
- A withheld figure never erases the instrument: withhold the unverified number, keep the verified facility on the card (Encompass's $824M).
- Use-of-proceeds becomes an array of verified uses, each with its own sourceLine (Encompass's May proceeds did three things; one was captured).

STOP with Encompass's card showing the facility with any unverifiable field withheld-as-refusal, Quest's revolver now present, and the use-of-proceeds array.

## Stage 4 — the three demo names are perfect

No new work. Re-render Tenet, Encompass, UHS and assert against the script's must-land table:

- Tenet: ladder renders priority class (no row reads "unsecured" where the note says nothing), ordered by seniority, card render-clean.
- Encompass: the 2028 takeout reads as the call, the revolver is present, any unverifiable field reads as a deliberate refusal not a gap, use-of-proceeds shows all three uses.
- UHS: render-clean, golden intact, the residual close holds ($4.741B against $4.852B, $111M stated as unplaced, per §13.3 — not reconciled by a discount, which the filing does not state).

Each of the three CACHE_BUST x3. **STOP. This is the demo gate: all three perfect and reproducible, or the session does not widen.**

## Stage 5 — the seven honest names: facility maturities and the analysis layer

Now widen the same layer across the book.

- Every facility row carries its stated maturity, and a term loan or revolver whose maturity falls inside the window produces a Refi card with the same structure as a bond card; a facility with no stated maturity never cards and says so. Assert with fixtures. (Centene's term loan is on the ladder with no maturity; term-loan and revolver maturities are the strongest refi conversations, so this is where the seven names gain their real cards.)
- Liquidity = cash + undrawn facility capacity, both as-of dated, one computed sum; replaces the juxtaposed line book-wide.
- Revolver semantics: a drawn balance is operational, never a refi signal; a revolver cards only on in-window maturity or a stated outgrown-facility event. No card cites a drawn balance as its reason.
- Why-now cites an event or pattern on the card's own tranche, never a balance. Where a verified retirement, repurchase, or issuance exists on that tranche it is the why-now (Centene's $1,147M repurchase program, already extracted, currently ignored in favour of cash). Cash is never a refi rationale; for an insurer the balance-sheet cash figure is not treasury liquidity.
- At-maturity language ("at maturity", "upon maturity", "when due") makes the pattern line read "pre-funded and repaid at maturity", never "refinanced N months ahead" (Quest). Closed grammatical class, Rule 28's third worked example.

STOP with every card's why-now and every facility maturity across the seven.

## Stage 6 — the two roll-forward names

HCA and Cigna, per the filer-directed roll-forward design (build-log): fires only when the anchor's debt note has no ladder and explicitly, verifiably cross-references a prior filing. Base is the most recent prior filing in the reference chain carrying tranche detail; deltas bridge every intervening period in order, verified by instrument identity; tie to the anchor's balance sheet within threshold or render the gap. If Stage 0 showed a usable text-block anchor, use it to locate; otherwise heading/content. This is the largest single build of the session — if its cost shape threatens the ceiling, STOP and take it as its own session rather than rushing it into this one.

STOP with HCA and Cigna's ladders, labelled base-plus-deltas, tied or gap-rendered.

## Stage 7 — remaining goldens and close

- Amount comparison by parsed value plus printed unit, not exact string, so whitespace variance stops blocking a golden (Centene's Stage 21 block).
- Write every company that now passes all nine criteria, CACHE_BUST x3, on the signature flow — the seven honest names' verification sheets for review, goldens written per signature.
- Narration set priced and held for review, attempted and rendered-clean as separate columns.
- Determinism x3 both books local and live on the pinned as-of; suites, tsc, build; push to main only if clean, report branch, hash, deployment.
- BRD to v1.7: the semantics layer (priority class, instrument type, facility location, liquidity, revolver rules) into §8; the month-count convention named; §13.3 demo script confirmed; standing costs from the persisted log; the carry-list for the audit session and beyond. Build-log close-out, rules numbered onward, full artifact at the boundary.

## Out of scope — do not touch

- The ~40-name pre-warm and anything scaling beyond the ten: the audit session sits between this and that, and the pre-warm is the session after.
- The v2 / post-demo bucket: month-from-range-floor derivation (Tenet), "already refinanced" verbiage (Encompass), per-tranche XBRL as a primary source.
- Book-level ranking across names.

## Standing constraints

- One substantive change per paid run.
- Never suppress: a line or check that cannot resolve renders its problem; a withheld figure keeps its instrument.
- Availability over instruction, a field the model may fill must be one the source structurally has.
- Flag merges rather than making them silently.
- Rules over instances; new rules to the log; the audit session that follows will test every rule for company-specific residue, so write none.

## Acceptance

Stage 4 is the demo gate: Tenet, Encompass, UHS perfect and reproducible. Full-session acceptance: all ten names tie or state why not, every facility carries its maturity and cards when in-window, liquidity is computed, why-now cites events not balances, and every company that meets all nine criteria is golden on signature. Then the book is demoable, and the audit session verifies it is scalable before any 40-name spend.
