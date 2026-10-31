# Session 27: Checkpoint 11 (rulings of Oct 31: release, the cap rule, the missed move, the refresh batch)

Status: **stopped**, as instructed: the per-name diffs and the refreshed screenshots are below. Nothing is signed beyond Tenet's cleared re-signature.

**Spend this round: $1.8968**, the refresh batch, approved at $5.41 worst case. Everything else ran at $0.

## 1. Tenet re-signed (cleared Oct 31)

- Re-signed at v33 on its Oct 15 read set: 3/3, 12 rows, residual 0%. The $0 replay through the loop gives the signed state.
- The revolver's and the L/C facility's "November 4, 2030" are 10-K standing terms, tagged.
- goldenThroughLoop: 16/16.

## 2. Encompass: the false "not stated" is gone

- The card reads "Letters of credit outstanding: stated only as of December 31, 2025 in the 10-K; not shown.", linked to the 10-K's sentence.
- **New check over all six:** no field with a figure found in a read document (removed under Rule 66, or withheld) renders "not stated". `falseNotStated` went from 6 passed / 2 failed to **8/8**, with a control.

## 3. Released

- `npm run release` passed preflight, goldenThroughLoop, the offline suite (84/84, 2,340 assertions) and failClosed (25/25, both controls failing as required).
- It pushed `562df5b`, and **/api/health serves 562df5b** in production.

## 4. The cap rule

- The $2.00 per-build cap stays.
- Digs draw only on the dig allowance: the cap less the other stages' counted worst case.
- A dig that wouldn't fit is refused before the call (`DigRefusedError`). Its trigger is recorded as unresolved, and the card's "Not shown" section flags it.
- `digAllowance.test`: did not run → **5/5**, with a control.
- **In the batch,** the allowances were Tenet $0.9568, DaVita $1.0789 and CHS $1.3161. No dig fired.

## 5. The missed move

**Diagnosis (Rule 63): the scope is not the cause.**
- The facts instruction is year-scoped ("from January 1 of the anchor period's year through the brief date"), and the stage's filter keeps every verified move.
- On Molina's Q2 anchor, all three asks returned the Feb 4, 2026 amendment from "We executed an amendment to the Credit Agreement on February 4, 2026 …".
- On Q3, the same sentence was in the input (confirmed with `--dump`), and all three omitted it.
- So the model dropped a sentence it was shown.

**The fix, as a rule.** `moveSentences.ts` locates past-tense debt-move sentences in code (an amendment, an issuance, a redemption or repayment, a redemption notice, a facility entered into, refinanced or terminated) with an in-window date near the verb. It excludes conditionals, exhibit and press-release lines, and period markers ("six months ended …").
- **The cause:** the facts stage now receives them as "CANDIDATE MOVE SENTENCES" to account for. The three batch facts runs used this.
- **The safety net:** a located sentence that no move card covers renders as "Possible move, not confirmed: <sentence>". The moves section never says "none" beside one. One transaction printed in two documents is one move.

**Tests:** `possibleMoves` did not run → **14/14** (controls: "may redeem", a prior year, possible moves removed). The six committed cards carry no possible moves.

## 6. The refresh batch ($1.8968 of $5.41)

| Name | Base ×3 | Facts | 9b | Rows | Captured face | Residual |
|---|---|---|---|---|---|---|
| Tenet (10-Q Oct 29) | $0.2204 each | $0.1051 | **3/3** | 13 | $13,341MM | 0%, passes |
| DaVita (10-Q Oct 29) | $0.1881 each | $0.0919 | **3/3** | 9 | $10,832.2MM | 0%, passes |
| CHS (10-Q Oct 29) | $0.1237 each | $0.1032 | **3/3** | 12 | $9,766MM | 0%, passes |

Screenshots: `screenshots_v8/Tenet-refresh.png`, `DaVita-refresh.png`, `CHS-refresh.png`, plus `Molina-refresh.png`, all re-rendered. Full diffs: `sessions/27/refresh/<cik>_visible_diff.md`.

**Tenet, against the current card**
- **Position:** Sep 30, 2026, from the 10-Q filed Oct 29; the header names it as this week's position.
- **The Sept 23 redemption is now confirmed.** Moves: "Sept 2026 · Redeemed $1,500MM 5.125% senior secured first lien notes due November 2027 (with cash on hand)" and "Redeemed $500MM 6.125% senior unsecured notes due October 2028". The new "$2,000MM 6.250% senior unsecured notes due 2034" is issued.
- **The call:** "$600MM of 4.625% senior secured notes due 2028 are not yet refinanced". Refinanced: $0.
- **Totals:** total debt $13,341MM (secured $8,300MM, unsecured $4,362MM, other $679MM). Liquidity $4,574MM (cash $2,674MM). Balance sheet $13,243MM after $98MM.
- **Not shown (new):** "Senior secured letters of credit available, $95MM: withheld. Sentence does not state this figure."
- **A defect the batch revealed, fixed** (`headingPosition.test` 4/1 → **5/5**, the six cards unchanged). The first render showed every note as "senior unsecured". The Q3 table prints "Senior secured first lien notes:" before a nil row the answer no longer carries, and the heading rule needed a heading directly before a carried row. Now:
  - a row takes the last heading printed before its own position;
  - the card reads the loop's recorded heading instead of recomputing it by adjacency, so the rule has one home.

**DaVita, against the current card**
- Position Sep 30. Total $10,832.2MM. Term Loan A-2 $1,962.5MM; revolver drawn $80MM (was $65MM); Term Loan B-2 $2,352MM.
- Liquidity $1,915.6MM (cash $495.6MM). Scheduled amortization in the window: $304.8MM (was $337.1MM).
- **Two defects, for your ruling** (not fixed):
  - **(a) "6.75% senior *secured* notes".** The card took "secured" from "…refinancing of Term Loan B-1 with a **secured** Term Loan B-2 facility … and issuance of the 6.75% Senior Notes…". The word modifies the term loan, not the notes. The table prints them under "Senior Notes:", and the current card says "security not stated".
    - **Proposed rule:** a security word labels an instrument only where it modifies that instrument's own name ("secured … notes", "the notes are secured"), never because it shares a sentence with it.
  - **(b) "Letter-of-credit sub-facility ~$0MM, capacity only."** The facts stage filed the *separate bilateral* L/C facility's outstanding letters of credit ("$ 184,758", in thousands) as a sub-facility of the revolver, and the scale was lost.
    - **Proposed rule:** a sub-facility is one its own sentence places inside the parent facility. A figure stated for another facility is not a sub-facility. A sub-facility amount takes its table's printed scale, like every figure (Rule 67).

**CHS, against the current card**
- Position Sep 30. Total $9,766MM. Liquidity: cash $155MM, available ~$745MM. A new move card: "May 6, 2026 · Repurchased ~$368MM 4¾% senior secured notes due 2031 · $689MM remains (with ~$600MM of divestiture proceeds)".
- **One defect, for your ruling** (not fixed): the table reads "**~$736MM** repurchased in 2026". The facts stage kept one tender offer twice: once dated by its launch sentence (Apr 22) and once by its settlement sentence (May 6), each with "approximately $368 million principal amount".
  - **Proposed rule:** moves of the same type, instrument and face are one transaction, dated by its completion. The launch date is its announcement, not a second move.

**Molina (refreshed on Oct 22; re-rendered, no new spend)**
- The moves section now shows "Possible move, not confirmed: 'We executed an amendment to the Credit Agreement on February 4, 2026 …'". It shows once, and no longer says "No debt moves stated".
- Confirming it as a move needs Molina's facts stage re-run with the candidate list: about $0.06, within your earlier $0.35 approval for Molina's facts if you want it.

**Tests:** offline suite **87/87 (2,363 assertions)** before the last two commits, which touched the move rules only (`possibleMoves` 14/14, `missingStage` 10/10, the committed cards unchanged).

## Waiting on you

1. Rulings on the three defects (DaVita a and b, CHS).
2. Review of the four refreshed cards (Tenet, DaVita, CHS, Molina).
3. Molina's facts re-run with the candidate list, about $0.06 under the existing approval.
