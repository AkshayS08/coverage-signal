/**
 * Version stamps folded into answer- and wording-cache keys
 * (lib/cache/answerCache.ts, lib/cache/wordingCache.ts). A cached answer
 * is otherwise permanently wrong once written — bumping the relevant
 * version orphans every existing entry under it (never read again)
 * without deleting anything, so a bad model answer or a prompt-wording
 * fix can be invalidated cleanly instead of manually purging the store.
 *
 * Session 15: split from one shared PROMPT_VERSION into two, because the
 * card-narration prompt changed this session while the extraction prompt
 * did not — a single shared constant would have forced every company's
 * expensive Haiku extraction to be re-asked just because the cheap Sonnet
 * narration prompt changed, which is exactly the wasted-cost outcome
 * Session 14's separate "three caches, three jobs" design exists to avoid.
 * Each constant bumps independently now.
 */

/**
 * claude.ts's 15-trigger extraction prompt + schema, and proceedsUse.ts's
 * classification prompt.
 * v2 (Session 18): debt-maturity returns a schedule (debtSchedule,
 * priorDebtSchedule, reconcilingLines, statedTotal) instead of one fact;
 * new-debt-issuance gains redeems + issuedTranches; every trigger gains
 * cashAmount + projectName. This is a schema change, not a wording fix — a
 * cached answer from before this version has none of these fields at all
 * (undefined, not empty), so it must never be replayed as equivalent to a
 * fresh one. The whole reason this session is expensive: every one of the
 * 10 companies gets re-asked.
 * v3 (Session 18, after the first pilot re-extraction): the v2 pilot's own
 * checksum tie rate (3/10) surfaced two real prompt-following gaps, not
 * verification bugs — confirmed by inspecting the raw dropped rows: (a)
 * `sourceLine` was sometimes a composed, paraphrased sentence ("Senior
 * Secured First Lien Notes, 4.750%, due 2027, $3,228 million") instead of
 * the filing's own verbatim text, so the row-verification guard correctly
 * rejected it — that guard's job is exactly this; (b) debtSchedule rows and
 * statedTotal were sometimes pulled from MULTIPLE different filings (an
 * 8-K mixed in with a 10-Q) instead of one cohesive table, which is also
 * why several companies got no statedTotal at all — there's no one place
 * with a total when the rows themselves were never from one place. v3
 * strengthens both instructions: sourceLine now held to the exact same
 * verbatim standard as `quote` (with a wrong-vs-right example inline), and
 * debtSchedule/statedTotal explicitly required to come from the SAME ONE
 * filing, never assembled across sources.
 * v4 (Session 18, after v3's full re-extraction made the tie rate WORSE —
 * 2/10, down from 3/10): the real dominant cause, confirmed at zero LLM
 * cost by fetching all 10 companies' real filings directly from SEC, was
 * never the prompt at all — lib/fetch/filingText.ts capped every fetched
 * filing at its first 40,000 characters, and ALL 30 of the 10 companies'
 * baseline 10-Q/10-K filings had their debt-schedule note sitting well past
 * that cap (as far as 613k characters in). The model wasn't failing to
 * transcribe verbatim; the debt note usually wasn't in the text it was
 * given at all. Fixed at the fetch/corpus layer, not here — see
 * lib/fetch/noteLocation.ts (a density-based locator that splices a
 * bounded excerpt around the debt note into the corpus) and
 * lib/fetch/filingText.ts (now caches the FULL stripped text, versioned
 * v2, so old 40k-truncated cache entries are never silently replayed).
 * This version bump exists only for the SECOND, smaller bug found
 * alongside it: statedTotal sometimes came back with no unit attached
 * (a bare "45,828" or "10,781,013", unlike row amounts which the prompt
 * already required a unit for) — parseMoneyAmount then treated it as
 * literal face-value dollars, producing checksum gaps in the tens of
 * billions even when every row was correct. Strengthened statedTotal's
 * instruction to the same "unit always attached" standard as row amounts,
 * with an explicit wrong-vs-right example.
 * v5 (Session 18, after the v4 two-company pilot): DaVita's real pilot
 * result reproduced the SAME missing-unit bug v4 fixed for statedTotal, one
 * field over — reconcilingLines' amount came back as a bare "( 66,503 )"
 * with no unit, producing a false ~$66.4M checksum gap on a company whose
 * row data was otherwise a byte-for-byte match to the real 9-tranche
 * filing. The v4 instruction only touched statedTotal; reconcilingLines'
 * amount needed the identical "unit always attached" requirement.
 * v6 (Session 18, after the user's review of the v5 pilot): two structural
 * fixes, both landed as schema/code changes rather than a sixth prompt
 * patch. (1) Category scoping — HCA's real "NOTE 7 — DEBT" table lists
 * Commercial Paper under "Short-term borrowings:" separately from
 * everything under "Long-term debt:", with a "Total long-term debt" line
 * that structurally excludes commercial paper; summing every row
 * regardless of category against that total produced a false ~$3.9B gap
 * on 100%-correct data. DebtScheduleRow/ReconcilingLine gained `category`
 * (verbatim sub-header, null if none), the verdict gained
 * `statedTotalCategory` (which category the total sums), and the checksum
 * (lib/events/position.ts) now sums only matching rows — a row in a
 * different category stays transcribed and visible in the table, just
 * excluded from a total it structurally isn't part of. (2) The missing-unit
 * bug recurred a third time (v3: row amounts; v4: statedTotal; the v4 pilot:
 * reconcilingLines) — three occurrences of the same prompt instruction not
 * holding is a signal to fix it in code, not ask a fourth time: every money
 * field (row amounts, statedTotal, reconcilingLines.amount, cashAmount) now
 * passes through lib/agent/moneyScale.ts's checkMoneyScale at the schema
 * boundary (loop.ts's verifyDebtRows/finalizeVerified) — a value with no
 * determinable scale is dropped/nulled and logged, exactly like an
 * unverified sourceLine, never silently trusted as literal face-value
 * dollars.
 * v7 (Session 18, after the v6 pilot's 3-condition review): three
 * structural fixes. (1) Base/prior filing selection for
 * debtSchedule/priorDebtSchedule is now determined in CODE
 * (lib/fetch/noteLocation.ts's per-filing status, computed before the
 * model is ever asked) and handed to the model as an explicit filing
 * reference — never "find the most recent 10-Q or 10-K yourself." That old
 * instruction is exactly what let Centene's extraction fabricate 28 rows
 * (the newest-by-date filing had no locatable table, so the model filled
 * the gap with a plausible schedule resembling a different company's real
 * structure) and would have picked the wrong filing entirely for Cigna
 * (whose schedule exists ONLY in the 10-K, never either 10-Q). A locator
 * miss and a fabrication risk are the same event — removing the model's
 * need to search closes off the failure mode instead of hoping the model
 * discovers it correctly. (2) DebtScheduleRow.maturityDate/dateGranularity
 * are now nullable and independently verified against each row's own
 * sourceLine (lib/agent/loop.ts's verifyDebtRows) — live-diagnosed against
 * REAL HCA data: "Other debt (effective interest rate of 4.9%)" (genuinely
 * verbatim, passes sourceLine verification) came back paired with
 * maturityDate "2026," which is not stated anywhere in that text. A
 * fabricated date riding on a verified row was a real, previously-uncaught
 * hallucination class; a claimed date with no matching date token in its
 * own row's sourceLine is now nulled, not trusted. (3) reconcilingLines
 * instruction strengthened to explicitly require transcribing EVERY line
 * below the table (a filing routinely has 2-3), not stopping after the
 * first — HCA's real "amounts due within one year: $6,264 million" line
 * was missed even though it's real, useful timing information on its own.
 * v8 (Session 18, immediately after the v7 pilot): fixing (3) above
 * surfaced a NEW problem, live, in BOTH pilot companies at once — a debt
 * note routinely chains multiple totals (HCA: Total long-term debt -> Total
 * debt -> long-term debt net of current portion; DaVita: the same pattern).
 * Not every reconciling line feeds the SAME total: HCA's "Debt issuance
 * costs and discounts" bridges debtSchedule's rows to "Total long-term
 * debt" (statedTotal); its "Less amounts due within one year" line does
 * NOT — it's a reclassification applied to a LATER, different total. The
 * v7 fix (an untagged reconciling line inherits statedTotalCategory)
 * treated both lines as if they fed the same total, producing a false
 * ~$6.26B gap for HCA and a false ~$117M gap for DaVita (previously an
 * exact, hand-verified tie) from completely correct underlying data.
 * ReconcilingLine gained `feedsIntoTotal` (verbatim label of the total
 * line this reconciling line actually adjusts) and the verdict gained
 * `statedTotalLabel` (verbatim label of the total statedTotal's value came
 * from) — the checksum (lib/events/position.ts) now includes a reconciling
 * line ONLY when feedsIntoTotal exactly matches statedTotalLabel, both
 * verbatim copies of the filing's own text, never inferred. Null
 * (genuinely can't be placed) is the fallback, excluded and reported as
 * unplaced — never guessed, never silently summed.
 * v9 (Session 18, immediately after the v8 pilot): feedsIntoTotal is brand
 * new (v8) and, live, the model correctly determined statedTotalLabel for
 * DaVita ("Total debt principal outstanding") but left BOTH reconciling
 * lines' feedsIntoTotal null — including the discount line, which should
 * have matched cleanly. HCA's pilot succeeded on this same field, so this
 * isn't yet a repeated-failure class across companies; the instruction's
 * own hedging ("never guess... a wrong guess corrupts the arithmetic")
 * likely pushed the model toward defaulting to null rather than committing
 * even when determinable. Rewritten as a concrete, mechanical, top-to-
 * bottom procedure (each reconciling line feeds whichever "Total ..." line
 * is the NEXT one printed after it) instead of a judgment call, with null
 * reserved for the genuinely-unlabeled-total case specifically, not general
 * uncertainty.
 * v10 (Session 18) — the full checksum redesign. Three rounds of
 * label-matching (v6's category, v8's feedsIntoTotal, a proposed v9
 * numeric fallback) were all solving a question the filing never asks —
 * "which total does this line belong to." Hand-verification of both pilot
 * companies' real filings established the actual model: a debt note is a
 * RUNNING TOTAL. Every printed subtotal equals the sum of everything
 * printed above it — no labels needed to reconcile it. debtSchedule /
 * priorDebtSchedule / reconcilingLines / statedTotal / statedTotalCategory
 * / statedTotalLabel are DELETED, replaced by scheduleSequence /
 * priorScheduleSequence — an ordered row/adjustment/subtotal transcription
 * of the note's own printed structure (see ScheduleSequenceEntry in
 * lib/agent/claude.ts). A second, independent field —
 * balanceSheetDebtCaptions — captures the SAME filing's balance-sheet debt
 * captions, cross-referenced against the note's own subtotals to prove the
 * note belongs to THIS period (a stale prior-quarter note would otherwise
 * tie perfectly on its own internal arithmetic and slip through
 * undetected). Two independent checks replace the single checksum:
 * lib/events/position.ts's computeWalkChecksum (Check 1 — the internal
 * walk) and computeBalanceSheetCheck (Check 2 — the balance-sheet anchor),
 * reported separately, never blended into one tie rate — they fail
 * differently and each names its own failure.
 * v11 (Session 18, immediately after the v10 pilot): v10's own worked
 * example was itself an instance-fit — it told the model to REPOSITION
 * HCA's "Commercial paper" line out of its printed position to sit later in
 * the sequence, where the arithmetic needed it. Live, the model did not
 * reliably follow that instruction: HCA's real pilot came back with only 7
 * entries (commercial paper left as an ordinary row in its printed
 * position, 2 of the note's real 3 subtotals omitted entirely), reproducing
 * the exact -$3,890M gap the repositioning instruction existed to prevent.
 * Confirmed at zero LLM cost this was a genuine extraction-completeness
 * gap, not truncation — response.stop_reason was never "max_tokens" for
 * that call (assertNotTruncated did not fire). DaVita's pilot, meanwhile,
 * passed both checks with an exact $0 gap on all 3 subtotals — real
 * evidence the running-total model itself is sound; the flaw was
 * specifically the reposition-to-fit instruction.
 * The correction: a debt note is NESTED, not flat, and the filing prints
 * that nesting as section headings ("Long-term debt", "Short-term
 * borrowings"). ScheduleSequenceEntry gains `section` (verbatim heading, or
 * null for a flat single-section note or a top-level rollup) — entries are
 * now transcribed in PRINTED order and NEVER repositioned; the section
 * field, not position, is what a subtotal reconciles against. Check 1
 * (computeWalkChecksum) is now a nested walk: a subtotal WITH a section
 * closes that section (checked against its own rows/adjustments only,
 * never a reordered flat sum); a subtotal with no section is a rollup,
 * checked against every still-open section's computed sum folded together
 * with the top-level running total. Still never resets to a subtotal's
 * CLAIMED amount — a corrupted section's computed sum is what propagates
 * upward, so a dropped row still breaks every subtotal after it, section
 * boundaries included.
 * v12 (Session 18, after the 8-company run) — the FOURTH occurrence of the
 * missing-scale class (row amounts → statedTotal → reconcilingLines.amount
 * → scheduleSequence), and the point at which a fourth prompt fix was ruled
 * out. New shape, found live in Cigna's 10-K: the filing declares its
 * table's unit ONCE in the table caption ("(In millions)") rather than on
 * each row. Two distinct failures followed from that, both silent-ish:
 * 20 of 40 entries were correctly DROPPED as indeterminate (comma-grouped
 * "$ 1,481"), and — far worse — the 18 that survived were comma-free
 * ("$ 549"), which parses as a perfectly determinable $549 in LITERAL
 * dollars, off by a factor of a million. Check 1 cannot catch that (a
 * running-total walk is scale-invariant, so a uniformly wrong-scale table
 * ties perfectly); Check 2 did, reporting a $29.7B anchor gap — exactly the
 * split the two-check design exists for.
 * The fix is a captured field, not a reworded instruction:
 * scheduleTableUnit / priorScheduleTableUnit / balanceSheetTableUnit hold
 * the table's own declaration VERBATIM, and lib/agent/moneyScale.ts's
 * applyTableUnitToAmount applies each one in CODE to that table's amounts
 * and no other, before verification (the drop happens inside
 * verifySequenceEntries, so recovering scale afterwards would be too late).
 * A row that names its OWN scale word always wins; an amount with no unit
 * and no table declaration stays indeterminate and is still dropped —
 * nothing here ever guesses a scale, it only applies one the filing
 * printed. Note the row-wins test is deliberately "does the row state a
 * scale word," NOT "does the row already parse" — the latter was this
 * fix's own first cut and would have skipped precisely the "$ 549" rows
 * that were wrong, while appearing to work (caught by moneyScale.test.ts
 * [24]).
 * Shipped alongside two code-only changes that do NOT affect extraction:
 * prior-period schedules now surface as explicitly-labelled context when a
 * base ladder fails both checks (never merged, never card-eligible, base
 * selection unchanged), and the completeness diagnostic's own
 * occurrence-unaware span matching was fixed.
 * v13 (Session 18) — COLUMN BINDING plus a second money-scale correction.
 * (1) Every debt table is comparative — this period's column beside the
 * prior period's — and nothing in the schema said which one an `amount`
 * came from. That is a silent-corruption class, not a one-off: a set of
 * prior-column rows sums to the prior-column subtotal and passes Check 1
 * perfectly, because the internal walk is self-consistent within EITHER
 * column. Live case: Quest read prior-column values for several rows and
 * both subtotals, walked cleanly, and was caught only by a $29M Check 2
 * anchor gap. ScheduleSequenceEntry and BalanceSheetDebtCaption now carry
 * `periodColumn` (the verbatim column header the amount was read from), and
 * lib/agent/loop.ts's bindEntriesToPeriod drops any entry bound to a period
 * other than the filing's own. The expected period comes from EDGAR's
 * FilingEntry.reportDate — filing metadata, not the table and not the
 * model's judgment. Note the expected token is constructed from the ISO
 * string directly: running it through extractFactTokens degraded it to
 * year-only precision and let a whole wrong QUARTER match (caught by
 * columnBinding.test.ts [10]).
 * (2) checkMoneyScale was backwards at the top end — "$1,000,000,000",
 * written out to the dollar and unambiguous by construction, was rejected
 * as indeterminate while a bare "$ 549" was accepted. Cost Cigna all four
 * issuedTranches and its cashAmount. A magnitude threshold now treats a
 * bare figure too large to be a scaled table cell as self-describing;
 * written as magnitude rather than digit-count because DaVita's REAL
 * 8-digit "10,847,516" IS thousands-scaled and must stay indeterminate.
 * This interacts with v12's table-unit fix and the two are reconciled in
 * isSelfDescribingAmount — without that guard the caption would have been
 * appended to a full-dollar figure, turning $1B into $1 quadrillion.
 * v14 (Session 18, after the v13 run) — PLURAL scale words, a tokenizer gap
 * v13's own changes exposed rather than caused. factTokens.ts matched
 * "million" but not "millions", and the trailing \b actively rejected the
 * plural. A filing caption reads "(dollars in thousands)", so the model
 * echoing "thousands" onto an amount is ordinary input. It failed two ways:
 * "$800,000 thousands" did not tokenize and was dropped as
 * scale-indeterminate — which took out ALL 16 of UHS's entries and left it
 * with no schedule at all — while "$1.5 millions" fell through to the
 * small-dollar matcher, which read the bare "$1.5" and returned ONE POINT
 * FIVE DOLLARS with no scale, a silent million-fold error of exactly the
 * class this pipeline has now hit five times. Fixed in the tokenizer
 * (extractMoneyUnitSuffixed + parseMoneyWithUnit), not at any call site,
 * since every money field routes through it. moneyScale.test.ts [40]
 * asserts the VALUE rather than determinability — a determinability-only
 * test passes on the silent half of this bug.
 * v15 (Session 18, the single covering bump) — CODE-LEVEL SCALE DERIVATION,
 * plus the corrected determinability rule. Deliberately ONE bump covering
 * both, held back while DaVita/HCA/Tenet stayed cached at v14 so the full
 * book re-extracts exactly once against the finished code.
 * (1) A table's scale is now resolved from the FILING'S OWN governing
 * declaration rather than from whatever the model volunteered. The
 * regression pair that forced this: Tenet's v13 run supplied per-row units
 * and verified 32/32; its v14 run supplied neither per-row units nor a
 * caption, on the SAME filing, and 24 of 28 rows were dropped as
 * scale-indeterminate. Nothing about the filing changed, so the scale can't
 * be allowed to depend on the model's volunteering it. lib/agent/loop.ts's
 * deriveScaleFromFilingDeclaration reuses scaleNormalize.ts's existing
 * detectDollarScaleAt (dollar-anchored, so a share-count "(in thousands)"
 * can never be read as a money scale, and null rather than a guess when
 * nothing governs) against each entry's OWN verified sourceLine position.
 * Resolution order: the amount's own unit wins; then the filing's
 * nearest-PRECEDING declaration; then the model's caption, as a fallback
 * only for entries whose sourceLine can't be located literally; then
 * indeterminate, and still dropped. Nothing is inferred at the end of it.
 * (2) checkMoneyScale now requires a POSITIVE signal — an explicit scale
 * word, a per-share token, or a magnitude too large to be a scaled cell —
 * never the mere fact that a number parsed. v13's magnitude fix made
 * "$1,000,000,000" determinable but left the other half backwards: "$ 549"
 * under an "(In millions)" caption still read as FIVE HUNDRED FORTY-NINE
 * DOLLARS, a silent million-fold error Check 1 cannot see (a running-total
 * walk is scale-invariant). This inverted moneyScale.test.ts [11] and [12],
 * which had asserted bare small decimals are true face value; they were
 * inverted rather than exempted, because at the schema boundary there is no
 * context distinguishing a per-share rate from a table cell. [11b] is the
 * reverse assertion proving a genuine "per share" figure still resolves.
 * v16 (Session 18, after the v15 full-book run) — two changes, both of
 * which need the bump for different reasons.
 * (1) PROMPT: the worked example's figures were being transcribed as DATA.
 * CHS's v15 sequence came back holding 1,069 / 1,010 / 44,200 / 45,828 /
 * 49,718 — HCA's numbers, verbatim from this prompt's own example — none of
 * which appear anywhere in CHS's 183,593-character filing. Given the wrong
 * section (its locator landed on ABL narrative), the model filled the gap
 * from its instructions. Every figure in the example is now an impossible
 * repeated-digit placeholder (11,111 / 22,222 / 98,888 / 109,999) from an
 * explicitly imaginary filing, real instrument names are gone, and the
 * example states outright that an absent schedule means an EMPTY sequence.
 * A prompt edit changes nothing until the cache is invalidated, so this
 * alone requires the bump.
 * (2) LOCATOR: noteLocation.ts now selects the debt-note cluster by
 * MAGNITUDE rather than coupon density. That changes the excerpt text the
 * model is handed — a different input, so cached answers keyed to the old
 * excerpt are stale by definition. Corrects DaVita (was reading the
 * interest-rate-cap table) and CHS (was reading ABL prose); the other eight
 * companies' selection is unchanged. The choice is PINNED PER COMPANY in
 * noteLocation.test.ts [13] so a future filing that flips it fails
 * loudly rather than silently changing which table is extracted.
 * Also in this version, though neither needs a bump on its own: an entry's
 * AMOUNT must now be corroborated in the filing (by value against its own
 * verified sourceLine, else by digit group across the filing text), closing
 * the hole that let a real caption carry a fabricated figure; and cashAmount
 * finally routes through deriveScaleFromFilingDeclaration like the other
 * three fields of its class.
 * v17 (Session 19, run B) — THE ONE-SLOT SCHEMA, OPENED EVERYWHERE IT WAS
 * STILL ONE SLOT. Session 18 fixed one slot, for debt-maturity only, and the
 * two defects that survived its review — CHS's second divestiture and
 * Centene's note-prose repurchases — were both the SAME shape one trigger
 * over: a company had two of something and the schema had room for one.
 * (2a) SIX triggers now return an array of instances, on the rule that a
 * trigger whose real-world instance count per period is plausibly greater
 * than one returns an array, decided once for the class and not per company:
 * asset-sale, acquisition-announced, capex-program, ipo-secondary,
 * dividend-buyback, new-subsidiary. Each entry carries its own sourceLine
 * under the same bounded verification contract a ladder row has (BRD 8.3) —
 * transcription in printed order, never selection.
 * (2b) noteRetirements: retirements and repurchases stated in the debt
 * note's OWN PROSE, which no field could previously hold — an 8-K field
 * cannot, because there is no 8-K. Copied verbatim, verified inside the
 * located note's own span, never inferred.
 * (2c) projectCompletionDate + granularity, so a dated project's status is
 * DERIVED from its date in code rather than defaulting to `standing`.
 * All four fields are optional and default — a pre-v17 cached answer has
 * them as undefined, not empty, and must never replay as equivalent to a
 * fresh one. That is what the bump is for.
 * v18 (Session 19, run B2) — NO PROMPT WORDING CHANGED. The bump is for a
 * changed INPUT, which is the same reason v16 needed one for the locator:
 * a cached answer is keyed to the text the model was handed, and that text
 * is now different for five of ten companies.
 * buildExtractionText marked the located debt note on ONE of its two
 * branches. A note past LEAD_CHARS was spliced in under an explicit banner;
 * a note inside the lead was handed over as an unannotated 40,000-character
 * slab, so the locator's whole gain was discarded before the model saw it,
 * purely as an accident of where in the filing the note sat. Molina paid for
 * it: its note at 37,461 and a fair-value table at 28,783 share five nearly
 * identical row labels differing only by carrying value versus face, and
 * v17 took labels from one and amounts from the other for three of five
 * tranches. Verification dropped every composite, so the ladder lost three
 * real rows rather than reporting wrong ones.
 * A third case surfaced while checking which companies this touches: a note
 * that STRADDLES the cap. Quest's starts at 39,415 and ends past 40,000, and
 * the old end-based branch sliced its excerpt from 40,000 — cutting the
 * note's first 585 characters, heading included, every run since the cap
 * existed. Branching on `start` delimits it whole.
 * Input changes for DaVita, HCA, Tenet, Molina (previously unmarked) and
 * Quest (previously truncated). UHS, Encompass, CHS and Cigna are untouched
 * and are this run's control.
 * v19 (Session 19) — the v18 marker, corrected, plus a verification hole
 * v18 exposed. Again no prompt WORDING change; the input changed and so did
 * what verification accepts.
 * (1) The marker asserted "the debt-schedule note was located here". UHS's
 * locator has always landed on its INTEREST-EXPENSE table — the book's only
 * `via=density` match, every other company matching `via=heading`. Unmarked,
 * the model read that span and correctly returned nothing. Marked, it
 * complied and produced five rows from interest expense. The marker now
 * states only that a region MATCHED the locator, that it may not be a debt
 * schedule, and that the answer is an EMPTY sequence if it is not.
 * (2) An amount that verifies only inside the instrument's own label is not
 * a verified balance. UHS's amounts corroborated by VALUE against the issue
 * size in each row's own name, and columnReadFailure went true -> false
 * because a model that never reads the columns leaves no inconsistency to
 * detect. Closed on the value-equality and digit-group paths both.
 * Expected effect: UHS returns to an empty schedule, stated rather than
 * implied. Molina keeps its five tranches — its rows print their own
 * balances and never depended on either path.
 * v20 (Session 20, Stage 2) — LOCATOR BY CONTENT. No prompt wording change
 * again; the INPUT changes for exactly one company, and only because the
 * span handed to the model is a different region of the same filing.
 * UHS's locator had always landed on its INTEREST-EXPENSE table, which
 * clusters denser than the real disclosure (9 matches to 6) and also wins on
 * magnitude, so neither prior signal could reject it. Content now
 * disqualifies it structurally: each row's amount is a median 1.16% of the
 * principal its own label names, which is a quarter's coupon, not a balance.
 * The span moves to 44,363–47,573 — the "Treasury / Credit Facilities and
 * Outstanding Debt Securities" note, whose five bulleted senior notes sum to
 * the $3.0 billion aggregate the same passage states.
 * Nine companies' spans, provenance and match counts are unchanged, so nine
 * cached answers would be identical were they not orphaned by this bump.
 * v21 (Session 20, Stage 2 corrected) — THE ANCHOR FILING IS THE POSITION,
 * ACROSS FILINGS. v20 moved UHS's span to the right note and then carried a
 * row transcribed from the 10-K's December 2025 table into the current
 * ladder, under a source attribution naming the June 2026 10-Q. Every guard
 * passed it: the sourceLine verified literally, the amount corroborated, the
 * note bound held — all against the wrong filing, because nothing required
 * the row's filing and the position's filing to be the same one.
 * A schedule row must now cite the anchor; a row from any other filing is
 * dropped with its reason stated, and when that empties the ladder the
 * fallback is suppressed — the fallback looks for a schedule in an OLDER
 * filing, which is exactly what was just rejected.
 * Bumped because the dropped rows are a verification outcome baked into
 * every cached answer, not something the assembly layer can undo.
 * v22 (Session 20, Stage 3) — THE PROSE HALF OF THE CAPITAL STRUCTURE.
 * Two new fields on debt-maturity, both prompt-driven and both verified
 * inside the located note: proseInstruments (category-typed instruments the
 * note states in narrative rather than in a table) and revolver (facility
 * size, drawn, letters of credit, available, delayed-draw capacity, kept as
 * five separate figures so drawn + LCs + available = size can be checked).
 * UHS is why: $1.1B rendered against $4,851,847K stated, with the missing
 * $3.7B written out in bullets rather than absent from the filing.
 * Coverage now runs at the anchor over rows plus prose, with the note's own
 * discount line subtracted rather than tolerated (Rule 17).
 * v23 (Session 20, Stage 4) — THE ANCHOR, THE NOTE, AND WHAT COUNTS AS DEBT.
 * Four changes, one of which is a capability the extractor never had.
 * (a) BULLETED AND SENTENCE-FORM SCHEDULES TRANSCRIBE. A ladder entry is any
 * statement of principal, rate and maturity for one instrument, whatever the
 * typography. Until now "row" meant table row and a prose filer had no
 * ladder at all — UHS's five senior secured notes are five bullets, and they
 * were never extracted from the filing that states them. periodColumn is
 * null for an entry that came from no column, which the binder already
 * keeps.
 * (b) THE ANCHOR IS THE MOST RECENT 10-Q/10-K, FULL STOP. The old rule
 * filtered to filings whose note the LOCATOR could reach and then took the
 * newest of those — a fallback wearing a precondition's clothes. Measured on
 * v22, two of ten had silently anchored on a 10-K: UHS assembled one
 * position from three filings and three dates, and Cigna rendered a 38-row
 * December ladder beside a June balance sheet. And the wrong-column caption
 * reads were downstream of it, not separate — the guidance section was
 * naming December 31 2025 as the base period, so the model read the December
 * column exactly as instructed. A filing whose note yields no ladder now
 * renders EMPTY WITH REASON; the search-order fallback is deleted, not
 * suppressed.
 * (c) THE ANCHOR RULE COVERS THE POSITION, NOT ONE FIELD OF IT. It applied
 * to scheduleSequence alone while balanceSheetDebtCaptions (the coverage
 * denominator), proseInstruments and revolver went unchecked.
 * (d) DEBT IS WHAT IS DRAWN. New amountBasis field: the model copies whether
 * a stated amount is a balance outstanding or a commitment. A revolving
 * facility contributes its drawn balance and never its size — Molina's
 * $1.25B facility (nothing drawn) and Tenet's $1.900B (drawn $0) were both
 * summed as debt in v22 and both read above 100% coverage.
 * Bumped for (a), (c) and (d), all of which change extraction output; (b)
 * changes which filing is extracted from, which is the same thing twice.
 * v24 (Session 20, Stage 4 corrected) — COPY THE DIGITS AS PRINTED.
 * v23's bulleted-schedule capability worked and was thrown away by one word.
 * UHS's five senior-note bullets transcribed verbatim, inside the located
 * note, at offsets 46,083 / 46,352 / 46,649 / 46,919 / 47,184 — and all five
 * were dropped, because the model rendered the bullet's "$ 700 million" as
 * "$ 700,000 thousand" to match the units of the table it thought it was
 * building. The value is identical; the digits are not printed anywhere near
 * the row, so amountCorroborated reads a restated figure as an invented one
 * and discards it. Measured both ways against the real filing: as the model
 * wrote them, none of the five corroborate; as the filing prints them, all
 * five do.
 * The rule is copy-as-printed and it cuts both ways, which is what makes it
 * safe: a table cell reading "700,000" under an "(In thousands)" caption
 * stays "$700,000 thousand", and a bullet reading "$ 700 million" stays
 * "$700 million". Neither converts. A ladder mixing a thousands table and
 * millions bullets carries both units exactly as each was printed; making
 * them uniform is not tidying, it is altering the source.
 * Also: a liability the note states is INCLUDED IN DEBT is an instrument
 * even where the sentence names no facility, and where one sentence gives
 * figures for two dates the anchor's own period wins — the same rule already
 * applied to a comparative table's columns. Without it UHS reconciles to
 * 3.69% and fails, because the $68 million of Trust financial liabilities
 * its note describes in a sentence is part of the balance the balance sheet
 * reports.
 *
 * v25 (Session 20, Stage 4 corrected again) — ONE INSTRUMENT, ONE FIELD.
 * v24's "typography is not the test" is REVERTED in full. Making a sentence
 * a schedule row did not add the bullets; it moved the problem. The model
 * transcribed UHS's three SENTENCES as rows, skipped the bulleted list
 * entirely, and returned the same three instruments in BOTH scheduleSequence
 * and proseInstruments in different units — "$1,448,000 thousand" as a row
 * against "$1,448 billion" as prose, which is a misplaced decimal, $1.448
 * TRILLION, and it reached a ladder line.
 * Two fields that can both hold the same instrument will eventually disagree,
 * and no amount of "do not duplicate" wording fixes a schema that permits it.
 * So the boundary is the filing's own typography, decided once: what the
 * note prints as a TABLE goes in scheduleSequence, what it prints as a
 * BULLET or a SENTENCE goes in proseInstruments, one entry each. A note with
 * no table returns an empty scheduleSequence and a full proseInstruments
 * list, and that is a complete answer rather than a failure.
 * Previewed free before spending: UHS's note contains no table at all (its
 * six issue-size statements sit a median 270 characters apart, where a
 * table's rows sit 60-90), and all eight of its instruments plus both
 * undrawn facilities locate inside the note span. Eight instruments, eight
 * single destinations, nothing routable twice.
 * The v24 unit rule (copy the digits as printed, never restate them) is
 * KEPT — it was measured safe on eight table-reading companies and is now
 * stated for prose amounts too. The "included in debt" rule is kept.
 *
 * v26 (Session 21, item 1d) — THE LAST BALANCE-MOVING FIELD GETS A SOURCE
 * LINE. `redeems` was free text: a description, verified against nothing,
 * with no statement of whether the retirement had happened, and it removed
 * rows from the ladder on that basis for twenty sessions. It now carries
 * { instrument, amount, status, sourceLine }, the sourceLine is verified
 * literally against a cited filing exactly as every other claim is, and only
 * a VERIFIED COMPLETED claim retires anything.
 * Measured across the book before the change — four distinct states in seven
 * companies: HCA and Quest genuinely completed ("we redeemed all $1.500
 * billion...", "repaid in full at maturity"); Tenet an intent ("intends to
 * use the net proceeds ... to finance ... the redemption"); Cigna and Molina
 * describing an instrument that appears nowhere in the filing they cite; and
 * UHS naming its 2026 notes only in a clause listing what the NEW notes rank
 * alongside — the "Existing 2026 Notes" — which retired a live $700 million
 * obligation.
 * Bumped because the field's shape changes and every cached body carries the
 * old one. A legacy string normalises to status:null, sourceLine:null — an
 * unverified claim, which is exactly what it always was.
 *
 * v27 (Session 21, Stage 3) — `redeems` BECOMES AN ARRAY. The Session 18
 * one-slot fix reaching the last single-slot field in the schema. One filing
 * routinely retires several things: UHS's August 8-K repays the outstanding
 * borrowings under its revolving credit facility (a real, completed
 * retirement, stated in the filing) AND names the 2026 notes in a clause
 * listing what the new notes rank alongside (not a retirement at all). A
 * single slot holds one of them — and after v26 correctly refused the false
 * one, there was nowhere left to put the true one, so a confirmed $225
 * million repayment went unrendered.
 * Each entry is corroborated on tense and verified against its cited filing
 * INDEPENDENTLY, because the same document needs opposite answers about its
 * two claims. Both gates per claim, each load-bearing alone (position.test
 * [S21a]-[S21d]).
 * Legacy shapes — a bare string, a single object — normalise into the array
 * with status and sourceLine null, which is an unverified claim and is what
 * they always were.
 */
export const EXTRACTION_PROMPT_VERSION = 27;

/**
 * sonnetEventBriefing.ts's card-narration prompt + schema.
 * v2 (Session 15): CALL ABOUT/WHY NOW/OPEN WITH replaces What/Why call/Angle.
 * v3 (Session 15b): evidence sentences added to context, the accuracy
 * corpus, and a required callAbout figure-or-date check — the prompt and
 * what counts as "verified" both changed, so old cached bodies (drafted
 * without ever seeing evidence text) must not be replayed as if
 * equivalent.
 * v4 (Session 16 Fix D, attempt 1): explicit "state figures exactly as
 * given, never a sum/rounded/derived total" instruction — Centene's
 * callAbout requirement was making Sonnet occasionally compute a round
 * total ("$2.0 billion") from two stated redemption amounts instead of
 * using the stated remaining balance ("$568.7 million"), correctly
 * rejected by the number-guard.
 * v5 (Session 16 Fix D, attempt 2): v4's abstract instruction wasn't
 * concrete enough — verified live, Centene still failed 3/3 fresh attempts
 * under v4, still computing "$2.1 billion"/"$2 billion". Replaced with a
 * concrete worked example of the exact failure shape (a balance paid down
 * in steps, plus what remains) so the instruction has something specific
 * to pattern-match against, not just an abstract rule.
 * v6 (Session 17, bumped once at the end per Item 0, after every narration
 * change was in): Item 4 (citations computed from which facts the drafted
 * text actually references, not the headline trigger alone), Item 16
 * (timing stated as "N months out," never "inside the N-month refi
 * window" — the threshold is an internal rule, not a market term), and
 * Item 17 (OPEN WITH replaced with KEY POINTS — 2-4 plain-fact bullets,
 * first bullet always the headline fact, no bullet may connect two facts
 * together). Old cached bodies used a different field (openWith) and a
 * different citation rule entirely — replaying them would be a shape the
 * current code can no longer even parse correctly, not just stale wording.
 * v7 (Session 18): seniority now available in callAbout (F2 — "senior
 * secured first lien notes," not just "notes"); a redemption a card's own
 * position-applied issuance explains is now stated as a KEY POINT, copied
 * from the field (E1). Both instructions read new context fields
 * (seniority/redeemsInfo) that didn't exist in any cached body before this
 * version — nothing to replay, there's no prior wording for either.
 */
/**
 * v8 (Session 18 stage 2, Group E narration): three changes, all of which
 * alter what a card says.
 *
 *   E4  The card states the tranche's OUTSTANDING balance. An indenture names
 *       a tranche by its ORIGINAL ISSUE SIZE, and narration was reading that
 *       name — so a partially repurchased tranche was narrated at the wrong
 *       number. Cigna's 4.500% due 2030 is named "$1,000 million" and has
 *       $993M outstanding; its 7.875% Debentures are named "$259 million" and
 *       carry $260M. Materially wrong, not slightly off.
 *   E5  A company gets ONE refi card, and the other cardable tranches on the
 *       same ladder now reach narration as KEY POINTS instead of becoming
 *       cards of their own.
 *   E10 WHY NOW states facts and their relation and does not advise, enforced
 *       by a structural check on modality and evaluation rather than by the
 *       instruction alone.
 *
 * E4 and E5 change buildContext, so their cards would re-narrate on the
 * context hash regardless. E10 changes only the SYSTEM PROMPT, which the
 * context hash cannot see — the bump is what invalidates those.
 */

/**
 * 8 -> 9. Session 18, stage-2 review — items 13, 14, 15 and 16, all four of
 * them SYSTEM PROMPT changes that the context hash cannot see.
 *
 *   13  One instrument per bullet. A source filing will state four
 *       instruments in one sentence, and copying that sentence across gives
 *       a bullet four facts. The guard counts RATES (a rate identifies an
 *       instrument) rather than amounts, because E4 explicitly requires a
 *       bullet stating two amounts for one instrument.
 *   14  Bullets must serve the call. Cards about a 2027 maturity were
 *       carrying bullets on buybacks and dividend increases — real facts,
 *       and neither is a reason to make this call.
 *   15  No month count for a bare-year maturity. "now about 16 months out"
 *       for a tranche whose filing prints only "due 2027" was the card
 *       reading back this system's own December-31 windowing convention as
 *       though the filing had disclosed it.
 *   16  Availability is a capability claim. "showing the market is open for
 *       exactly this kind of deal" makes the same move as "well-positioned
 *       to address this maturity" while carrying neither a modal nor an
 *       evaluative adjective, so the closed lists missed it.
 *
 * A NOTE ON WHY THE PROMPT MOVED TOO, not just the guards: 13's own worked
 * example in the keyPoints spec WAS the four-instrument sentence its new
 * guard rejects. Shipping the guard against the old prompt would have made
 * every card fail, retry, fail again and go to the loud-failure banner — at
 * two Sonnet calls each. A guard and the instruction it enforces are one
 * change; the Group E narration overrun ($0.65 against a $0.07 estimate,
 * five runs, because a failed briefing is never cached) was this same
 * lesson billed the expensive way.
 */
export const NARRATION_PROMPT_VERSION = 9;

/**
 * Session 17 Item 0: this project's session prompts have referred to this
 * constant as "wordingPromptVersion" and its extraction counterpart as
 * "extractionPromptVersion." The FUNCTIONAL split those names describe —
 * two independent constants, one per cache namespace, bumped
 * independently — already happened in Session 15 (see NARRATION_PROMPT_
 * VERSION's own history above) and was re-verified intact at the start of
 * this session (Item 0's diagnosis: already done, nothing to split).
 * Kept under their existing SCREAMING_SNAKE_CASE names rather than
 * renamed to match a session prompt's casing convention — renaming would
 * touch every read site across the codebase for a naming preference, not
 * a functional gap, and this project's own standing rules favor fixing
 * the shape of a real problem over cosmetic churn.
 */

/**
 * SESSION 19, RUN A — proceedsUse KEYS ON ITS OWN VERSION.
 *
 * It was keyed on EXTRACTION_PROMPT_VERSION, which is the wrong constant for
 * it: proceedsUse is a different model (Sonnet, not Haiku), a different
 * prompt, and a different input contract from the base classification. They
 * shared a key only because they were written at the same time.
 *
 * That sharing makes the standing "one substantive change per paid run"
 * constraint unachievable for this call. Run A changes ONLY what proceedsUse
 * is fed; bumping the shared constant to re-run it would also invalidate
 * every base classification and re-extract the whole book under a prompt
 * that Stage 2 had just changed for other reasons — two substantive changes
 * in one pass, with a baseline diff nobody could attribute.
 *
 * Split, so each call is invalidated by the thing that actually changed it.
 * A run that touches only the proceedsUse input now costs only the
 * proceedsUse calls, and the 2a/2b/2c extraction changes stay genuinely
 * inert until EXTRACTION_PROMPT_VERSION moves in run B.
 *
 * THE KEY IS NAMESPACED "pu-v", AND THAT IS NOT COSMETIC. Splitting a
 * constant out of a shared key path does not give it a fresh namespace — it
 * gives it the OTHER constant's history. This path interpolated
 * EXTRACTION_PROMPT_VERSION for its whole life, so `.../v2.json` and
 * `.../v3.json` already exist for most companies, written on 2026-08-21
 * when that constant was 2 and 3, under a different prompt and unbounded
 * input. Setting this constant to 2 read them straight back.
 *
 * It was caught only because the cost meter said 0 calls for eight
 * companies that should all have missed, and two of them came back with
 * DIFFERENT values — which would have been reported as the input bound
 * flipping two classifications. It was a seven-day-old answer to a
 * different question.
 *
 * The rule: a version constant split out of a shared key path needs a
 * namespace of its own, not a number nobody has used yet. Numbers get
 * reused; a prefix does not.
 *
 * 1 -> 2: the input is bounded (lib/agent/proceedsUseInput.ts). The
 * classification prompt itself is unchanged; what changed is that it no
 * longer receives each company's most recent 10-Q whole, which measured 83%
 * of this call's entire input.
 */
export const PROCEEDS_USE_PROMPT_VERSION = 2;
