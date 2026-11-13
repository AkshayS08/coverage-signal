# Stage 2 evidence: the decision 11 facts re-run (Nov 9–13, 2026)

Kept as evidence; production keeps its pre-re-run facts (Akshay, Nov 13: no fresh run).

**What ran.** Card facts for Tenet, Encompass, DaVita and CHS on inputs carrying their debt-item 8-Ks (decision 11) and
paragraph text. Billed $0.4569 of $0.71 approved (12 calls). Raw answers: `sessions/27/facts_rerun/raw-<cik>.json`.

**First verification (Nov 9, the verifier's own rules).** Three cards regressed: Encompass lost its May 29 and Aug 13
issues and Mar 9 refinancing; Tenet its redemption pairing; CHS its Feb 2 redemption. Causes: spacing in a quote; a
day taken from one document with a sentence from another; a notice dating a completed move.

**Re-verification (Nov 13, the card's own deciding functions, `moveEvidence.ts`; $0).** DaVita and CHS come out
identical to production. Tenet and Encompass differ (`sessions/27/facts_rerun/reverified/`, renders in
`sessions/26/screenshots_v15/*-facts-reverified.png`):
- Tenet: both redemptions are dated by the Sept 8 notice, which ruling A2 rejects; the notice shows as a possible move.
- Encompass: the issues are dated by days the cited 10-Q sentences do not state and no 8-K sentence passes the same-move
  test; both issues, the March draw and the May and August repayments show as possible moves.

**What Stage 2 takes from it.**
1. With the 8-Ks in its input, the model takes a detail from one document and cites a sentence from another; the
   verifier must judge by the card's functions (now so), and the prompt should ask for the sentence that states the
   detail.
2. A notice sentence is the model's preferred source for a redemption's date; A2 rightly refuses it, which loses the move
   unless a sentence states it done.
3. The facts input carries the possible-move candidates and the brief date, so its cache key moves when either does
   (Encompass's input moved with the Nov 13 purpose-tied draw rule).
