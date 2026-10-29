# Session 27: Checkpoint 8 (signing results, Molina's diff, Cigna's criterion 2)

Status: **stopped**, as instructed. Nothing is pushed.

**Spend this round: $0.6452:**
- Molina refresh: $0.6165 of the approved $1.5353.
- DaVita narration: $0.0287 of the approved $0.04.

Everything else ran at $0.

## Signing results

| Name | Result | Detail |
|---|---|---|
| **Tenet** | **SIGNED at v33** | 3/3; 12 rows; residual 0%; current read set; the $0 loop replay gives the signed state. |
| **Encompass** | **SIGNED at v33** (pre-Oct 28 read set) | 3/3; 7 rows; residual 0%; 2 tolerated differences recorded in the basis. |
| **DaVita** | **NOT SIGNED: the condition fails** | See below. |
| Cigna | not cleared | 3/3 now holds; held on criterion 2 (rule proposed below). |

**Signing changed the two committed cards.** goldenThroughLoop's [3snap] check requires a signed name's card input snapshot to equal its signed answer. The snapshots were re-captured at $0 and the cards regenerated:
- **Tenet:**
  - the cited table lines are now the v33 transcription ("Senior secured first lien notes: 5.125 % due 2027 1,500");
  - its L/C facility gains the maturity its 10-K states, "November 4, 2030".
- **Encompass:**
  - liquidity prints "approximately $ 746 million", as the sentence does;
  - the revolver's maturity now cites the anchor 10-Q;
  - its withheld L/C figure is $46.3MM, "stated as of a date other than the period this card reports".
- **Plain-language fix:** that last reason exposed an engine term on the card ("the anchor's period"), which failed acceptance 5.9. The card now shows plain language (`plainRejectionReason`); the stored reason is unchanged.

**DaVita.**
- **The label is recovered in code** (rule below). The v33 canonical now carries "Total debt principal outstanding". **It changes no card output:** DaVita's v33 card is byte-identical with the label empty or filled.
- **The condition still fails.** The card built from the v33 canonical differs from the committed (v31) card on 136 lines. All of them are cited sentences:
  - **132** cite the same table line with its fair-value cell appended ("… 4.625 % **$ 2,653,750**").
  - **4** cite the revolver's November 24, 2030 maturity from the prose sentence that states it ("…balances are due on November 24, 2030"), not from the table row.
  - No figure, date or label differs. Under ruling (d), these are the tolerated classes for a fresh extraction, but your DaVita condition asked for byte-identity.
- **Not signed.** Your call: sign on the tolerated classes, or keep the condition.

## Rules landed (tests first)

| Ruling | Code | Test, before → after |
|---|---|---|
| DaVita: recover printed headings and subtotal labels from the read document | `textHeadingBefore`, `recoverSubtotalLabels` (printedHeadings.ts), in the loop | `printedLabels.test`: did not run → **20/20**. Covers every sample of the six with the model's headings and labels removed. Control: recorded-only recovers none. |
| Cigna: deltas matched by identity, labels built from identity | `deltaIdentityOf`, `deltaLabelOf`, `deltaLabelPasses` (rollDeltas.ts); compareToGolden; the card's move title | `deltaIdentity.test`: did not run → **11/11** |
| (surfaced by signing) plain language for a withheld reason | `plainRejectionReason` (build.ts) | acceptance: 293 / 1 → **294 / 0** |

**Tests that followed the product:**
- `goldenSourceLine`: L1 keeps Tenet's v31 signature as a fixture.
- `golden` [10e]: the swapped delta is now an identity MISSING/UNEXPECTED.
- `nameCheck` M4: checks the built label and its span.
- `goldenTextTolerance` L2: the control is a label passing no part of the name rule.

**Totals:**
- Offline suite: **76/76 (2,189 assertions)**.
- goldenThroughLoop: **8/8**. It was 2/2 failing; [3snap] failed 2 times until the snapshots were re-captured.
- **9b: 8 of 8.** Cigna 2/2.
- **Cigna's card** changes in one place: the repayment's title is "$550MM 1.250% notes due March 2026" in every sample (was the model's "1.250% senior notes").

## Molina: refresh against the current card (sessions/27/molina_refresh_diff.txt)

| | Current card (v31 snapshot) | Refresh (v33 canonical, Oct 22 10-Q) |
|---|---|---|
| Position date | Jun 30, 2026 (10-Q Jul 23) | **Sep 30, 2026** (10-Q Oct 22) |
| Rows | 5 notes ($800M / $650M / $850M / $750M / $750M) + $1.25B revolver (capacity) | **the same 5 notes, the same amounts, maturities and classes** + the same revolver |
| Tie | captured $3,800M vs tagged $3,769M; residual 0%; passes | captured $3,800M vs tagged **$3,771M**; residual 0%; **passes** |
| Printed heading | none recorded | "Non-current long-term debt" (now recovered from the text) |
| 9b | — | **3/3**: canonical + 2 re-tastes, one read set |

Nothing signed. Signing would re-capture the snapshot on the Q3 10-Q, changing the card's position date, citations and cash.

## Cigna criterion 2: diagnosis ($0)

- **What fails.** Criterion 2 requires every narrative instrument to state a basis. On the v33 canonical, "Revolving Credit Agreement" has **amount null, basis null**.
- **Why.** A $0 replay's log shows the **model returned no amount** for it. The loop's existing fill (Rule 70) looks only for an *outstanding* balance at the anchor date. This instrument's sentence states a *commitment*: "The Company maintains a $ 6.5 billion, five-year revolving credit and letter of credit agreement…". So nothing filled it, and the row renders "(no amount stated)".
- **The same answer has the figure.** Its own facility record carries the verified size, $ 6.5 billion, from that same sentence.
- **Scope (Rule 63).** Across all 24 samples of the six (with Molina's refresh), this is the **only** narrative instrument without a basis. v31 and both Cigna re-tastes carry it as $ 6.5 billion, basis "commitment".
- **Proposed rule.** A narrative instrument the model returned with no amount takes, in code, the figure its **own cited sentence** states for it, with the basis that sentence states:
  - **an outstanding balance** at the anchor's date, as today (Rule 70);
  - **or a commitment:** where it matches exactly one verified facility (the same category and the same cited sentence), it takes that facility's verified size with basis "commitment".
  - Never from another sentence. Two candidates fill neither (Rule 19).
- **Expected effect.** Cigna's revolver carries "$ 6.5 billion", commitment, so criterion 2 passes. It stays held out of captured face as capacity, so coverage is unchanged ($31,913MM, 0.11%). No other sample changes.
- **Not built, pending your ruling.**

## Stage 2

`sessions/27/pipeline_design.md` is updated with your decisions:
- the triggers (a new anchor, or an 8-K with Item 1.01, 1.02, 2.03, 2.04 or 8.01);
- the $2 / $10 / $25 caps, checked pre-call;
- Upstash Redis `SET NX EX` leases, plus the two-concurrent-builds test;
- Ring 1: determinism byte-identical, a fresh extraction on the tolerated classes;
- `resolveCik`: return every match, never cache a guess;
- quotes round up to the cent.

It also records the rules this round added and the finding that signing re-captures the card.

## Noted, not acted on

DaVita's loop log still prints "SCHEDULE COMPLETENESS … unaccounted labeled total: Total debt principal outstanding". The completeness check runs before the label is recovered. It is a warning only, and changes no output.
