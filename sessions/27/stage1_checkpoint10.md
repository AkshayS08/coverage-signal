# Session 27: Checkpoint 10 (Tenet's corrected card, Molina's re-render, the batch's declared cost)

Status: **stopped**, as instructed. Nothing is pushed, released or re-signed.

**Spend this round: $0.0574.** That is Molina's verified-facts run, approved up to $0.35 and priced at $0.1454 worst case. All pricing and replays ran at $0.

## Tenet's corrected card (screenshots_v8/1-TENET-HEALTHCARE-CORP.png, for your clear)

- **Your ruling (Oct 30):** a standing term stated only in the latest 10-K renders with the "10-K" tag, unless a later filing in the read set amends that facility.
- **Tenet's read set:** after the Feb 17 10-K come the Jul 29 10-Q ("as amended to date", a formula, not an amendment), and the Sep 8 and Sep 22 8-Ks, which are about notes and don't name either facility. None of them amends either facility.
- **So both maturities render tagged:**
  - Liquidity: "Undrawn revolver, matures November 4, 2030 [10-K]".
  - Facilities: "senior secured revolver · … · matures November 4, 2030 [10-K]" and "Letter of credit facility · $105MM letters of credit outstanding · $200MM size · matures November 4, 2030 [10-K]".
- **The L/C facility's maturity is new on the v3 card.** An L/C facility line never rendered a maturity for any name. That was a gap for the whole class, now fixed: it shows its maturity as any facility does.
- **Balances from the 10-K stay out, tagged or not.** That is how Encompass's "$46.3MM letters of credit as of December 31, 2025" (a 10-K sentence; the anchor 10-Q doesn't print it) leaves its card. It had been withheld with a reason; now the facility says "Letters of credit outstanding not stated."
- **Tenet is not re-signed, per your instruction.** goldenThroughLoop fails Tenet's [3] and [3id] until you clear it, because the 10-K re-enters its position identity.
- **How it was replayed:** Tenet's Q3 10-Q (Oct 29) has moved its live read set. The corrected card was replayed at $0 on its Oct 15 read set through `READ_SET_AS_OF`, the new "serve from the last build" setting. goldenThroughLoop now checks the published brief's read sets by default.

## Rules landed (tests first; before → after)

| Rule | Test |
|---|---|
| Standing terms from the 10-K, tagged and bounded; 10-K balances never | `standingTerms` 3/4 → **7/7**; `annualReportSource` 9/2 → **11/11** (controls: an untagged term and a tagged balance are both caught) |
| Rule 53 extended (a "no amount was outstanding" sentence is a stated zero) | `statedNothingOutstanding`: did not run → **24/24**. It changes no sample of the six. Molina's three refresh answers now carry drawn $0 (9b still 3/3). |
| A section whose stage hasn't run says "not yet read from [filing]" | `missingStage`: did not run → **10/10**. Facts now record their anchor; a prior anchor's facts never render. |
| Refresh = every stage; missing-stage rendering | in `pipeline_design.md` (§3, §5, §10 items 7–10) |

**Offline suite:** 83 of 83 suites, 2,332 assertions. **goldenThroughLoop:** 14 passed, 2 failed; the two failures are Tenet's [3] and [3id], which await your clear of its re-signature.

## Molina's re-render (screenshots_v8/Molina-refresh.png)

The verified-facts stage ran on the Oct 22 10-Q: **$0.0574**, three asks. Against the current card:

- **Header:** "Weekly coverage brief · Oct 16 to Oct 30, 2026"; "10-Q filed Oct 22, 2026 · New this week: this 10-Q, filed Oct 22, 2026, is the position · 3 other filings, none affecting debt".
- **Position:** as of **September 30, 2026**.
- **The call:** to Apr 30, 2028; the next maturity is "19 months away · 1 month past the window" (was 20 · 2).
- **Liquidity:** $5,729MM, with cash $4,479MM (was $6,235MM / $4,985MM). "Not counted: up to $800MM of uncommitted incremental term loans" **is back**.
- **Facilities:** "Revolver · $1,250MM size · **$0 drawn** · matures November 20, 2030". The **$0 drawn is back**, now from Rule 53's extension. The swingline $15MM and L/C $100MM sub-facilities **are back**.
- **Footnote:** balance sheet $3,771MM after $29MM (was $3,769MM after $31MM).
- **Moves:** the Feb 4, 2026 amendment card **is still missing**, and the section says "No debt moves stated this year". **This is false again, and the missing-stage rule doesn't cover it.**
  - The facts stage did run on this anchor.
  - The sentence "We executed an amendment to the Credit Agreement on February 4, 2026 …" was in its input (checked with `--dump`).
  - None of the three asks returned it as a move. On the Q2 anchor the same stage did.
- **Proposed rule, not built:** a move sentence located in code (an amendment, issuance, redemption or repayment, dated inside the year's window) that the facts stage didn't keep is a check failure. The moves section then never asserts absence while such a sentence exists. It would say, for example, "1 stated move not confirmed: Feb 4, 2026 credit agreement amendment", with its sentence.

## The refresh batch, declared (sessions/27/refresh_batch_pricing.json; pre-call counts, $0)

Every billed stage on each Oct 29 10-Q: the base extraction (3 asks), the dig budget (5 per ask), proceeds-use (the one estimate: the Oct 22 count plus 25%), and the verified facts on the new anchor's text.

| Name | Base / ask | Dig / ask | Proceeds-use / ask | Facts (3 asks) | Worst case | Declared |
|---|---|---|---|---|---|---|
| Tenet | $0.2011 (101,097 in) | $0.3241 | $0.0945 | $0.1563 | $2.0155 | **$2.02** |
| DaVita | $0.1791 (79,085 in) | $0.2949 | $0.0748 | $0.1593 | $1.8056 | **$1.81** |
| CHS | $0.1757 (75,660 in) | $0.2978 | $0 (none on Oct 22) | $0.1569 | $1.5772 | **$1.58** |
| **Batch** | | | | | | **$5.41** |
| Molina | already run: extraction $0.6165 + facts $0.0574 = **$0.6739** | | | | | nothing further |

- **Tenet's worst case ($2.02) is over the $2.00 per-build cap.** The dig budget, at 5 per ask, is 48% of it.
- **Expected spend is far lower.** The ledger shows Tenet's re-tastes at $0.2326 each with no digs, and Molina's facts at $0.0574. Expected: Tenet about $0.76, DaVita about $0.62, CHS about $0.43, so about $1.81 for the batch.
- **Decisions for you:** approve the batch at $5.41, and either raise Tenet's cap or cap its dig budget.

## Release plan (unchanged, waiting on your clears)

1. Clear Tenet's corrected card, then re-sign it.
2. Release the Oct 15 cards as a checkpoint (`npm run release`).
3. Approve the refresh batch.
