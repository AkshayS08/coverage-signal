# Session 27: Checkpoint 7 (replays, signing proposals, Molina's declared cost, the Stage 2 draft)

Status: **stopped**, as instructed. Nothing is re-signed or pushed. **Spend this round: $0.00.** The approved DaVita narration was refused by the gate; see below.

## Rules landed (tests first; failure counts before and after)

| Ruling | Code | Test | Before | After |
|---|---|---|---|---|
| DaVita 1(a)(b): the debt table decides | `fundedProse` (instrument.ts), used by the position and by coverage | `fundedDebt.test` | 49 pass / 13 fail | 62 / 0 |
| (the test follows the product) | | `coverage.test` [12] retargeted; [12d] added | — | 45 / 0 |
| DaVita 1(c): a broken coverage tie is a check failure | `countsToward9b` (golden.ts), used by s27nineb | `ninebTie.test` | 0 / 18 (did not run) | 18 / 0 |
| Cigna (a): a delta's date is held to its sentence | `dateHeldToSentence` (rollDeltas.ts) | `deltaDatePrecision.test` | 4 / 7 | 11 / 0 |
| Cigna (b)(c): whitespace and footnote markers; labels compared case-insensitively | `normalisedText`, `cmpLabel` (golden.ts) | `goldenTextTolerance.test` | 10 / 7 | 17 / 0 |

- **Offline suite:** 74 of 74 suites, 2,143 assertions.
- **The six generated cards:** unchanged.
- **goldenThroughLoop:** 2 pass, 2 fail, the same before and after. Every golden is at v31, so none applies at v33; re-signing is what clears it.

## Replays ($0)

**9b: 6 of 8** (was 4 of 8).

| Name | Result |
|---|---|
| Tenet | 2/2 reproduce |
| Encompass | 2/2 reproduce, at its pre-Oct 28 read set |
| DaVita | **2/2 reproduce** (was 0/2). Captured face is 10,847,516,000 in all four samples (v31, v33, both re-tastes), as signed. |
| Cigna | 0/2. Of the 138 divergence lines, **one is left:** the delta label. |

**Cigna's one remaining line:**
- The canonical's model labelled the repayment with the *base row's* name ("$ 550 million, 1.250 % Notes due March 2026"). That name isn't in the delta's sentence, so the name rule shows it as "notes".
- The re-tastes and the signed v31 labelled it "1.250 % senior notes", which is verbatim, so they show that.
- Both labels obey the name rule. They differ only in which words the model chose. Ruling (c) as written (case-insensitive, on the displayed label) does not cover this.

**Golden finding (Cigna):** the signed delta date 2026-03-01 is an invented day. Code now gives 2026-03 in all four samples.

## Signing proposals (sessions/27/signing_proposals.txt)

| Name | 9b | Rule 58 | Criteria | Canonical v33 against the signed v31 state |
|---|---|---|---|---|
| **Tenet** | 3/3 | clean | 12/12; none changed | Position unchanged. The card's derived "inputs" cite re-transcribed table lines ("Senior secured first lien notes: 5.125 % due 2027 1,500" against "5.125 % due 2027 $ 1,500 $ 1,500"); both state the amount. |
| **Encompass** (pre-Oct 28) | 3/3 | clean | 12/12; 8b's detail drops the trailing dashes from printed headings ("Credit Agreement—" becomes "Credit Agreement") | Position unchanged. |
| **DaVita** | 3/3 | clean | 12/12; criterion 4's detail lost a label: "Total debt principal outstanding: gap 0 TIES" becomes "(unlabelled)". The filing prints the label; v31 and both re-tastes carry it; **the v33 canonical left it null.** | Position unchanged. |
| **Cigna** | **1/3: not proposed** | clean | 10/12. **Criterion 2 fails on the canonical:** 1 of 2 narrative instruments states no basis. 9b fails too. | — |

Each proposal signs the canonical v33 answer at its read set. **I need your clear for each name.** For DaVita, the clear also has to cover signing an answer whose subtotal label is null: 9b doesn't pin labels, and the tie holds either way.

## DaVita narration: refused, $0 billed

- **The gate refused the call.** The counted worst case is 7,549 input tokens plus 700 output, which is **$0.033147**, just above the approved $0.0331. The earlier pre-call price was rounded down.
- **I did not raise the ceiling.** To proceed, I need approval for **$0.0332**.

## Molina: quarterly refresh, declared (awaiting approval)

`sessions/27/molina_refresh_pricing.json`, all from pre-call counts, at $0.

- **What changes:** the anchor moves from the 10-Q of Jul 23 (period Jun 30) to the 10-Q of Oct 22 (period **Sep 30**). The read set has 9 filings.

| Run | Base (60,350 in / 20,000 max) | Dig (5 × budget, 10-Q Apr 23) | Proceeds-use (estimate) | Worst case |
|---|---|---|---|---|
| Canonical | $0.1603 | $0.2759 | $0.0755 | $0.5118 |
| Re-taste 1 | $0.1603 | $0.2759 | $0.0755 | $0.5118 |
| Re-taste 2 | $0.1603 | $0.2759 | $0.0755 | $0.5118 |
| **Total** | | | | **$1.5353** |

- **Proceeds-use is the one estimate.** It can't be counted before a base answer exists, so it uses the v33 count plus 25%.
- **Expected from the ledger:** about $0.45. Molina's Oct 22 canonical cost $0.1512 and dug 0 times.
- **Expected card changes:**
  - the position date becomes Sep 30, 2026;
  - the anchor citation becomes the Q3 10-Q;
  - the rows are re-read from the Q3 table;
  - tagged debt goes from $3,769M to $3,771M (`LongTermDebtNoncurrent`), so it should be essentially unchanged;
  - cash comes from the Sep 30 tag;
  - the badge drops from Signed until it is re-signed.

**Encompass and CHS:** no refresh yet. They wait for their Q3 10-Qs.

## Stage 2

The draft is `sessions/27/pipeline_design.md`, design only. Its §10 lists four decisions for you.
