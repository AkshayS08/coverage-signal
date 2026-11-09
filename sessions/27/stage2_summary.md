# Stage 2 in one page: build a card for any company

**Status:** design for approval. Nothing is built and nothing bills until you approve. Full detail: `sessions/27/pipeline_design.md`.

## What happens when someone asks for a card

| Step | What it does | Cost |
|---|---|---|
| 1. Find the company | Match the name, ticker or CIK against the SEC's list. More than one match shows a picker; it never guesses. | $0 |
| 2. Get its filings | Re-fetch the filing list from EDGAR, or confirm it is newer than the request. | $0 |
| 3. Choose the anchor | The latest 10-Q or 10-K. | $0 |
| 4. Decide what to read | The anchor, the filings after it, and debt 8-Ks since the latest 10-K. | $0 |
| 5. Check the cache | A card built before on the same documents is rebuilt free. | $0 |
| 6. Show the price | Count the tokens, price the worst case, ask before anything bills. | $0 |
| 7. Read the debt (3 samples) | The main extraction, run three times to prove it is stable. | $0.37 to $0.70 |
| 8. Extra reads, only when needed | The 10-K note the 10-Q points to; up to 5 targeted "digs"; how new money was used. | ~$0.21 typical (worst case ~$1.20 if all five digs fire in all three samples; none has yet) |
| 9. Read the card facts | Moves, sub-limits and maturities, from the anchor. | ~$0.10 |
| 10. Apply the rules and checks | Pure code: no model, no cost. | $0 |
| 11. Render | Build the card from what was read. Optional plain-English narration. | $0 (narration ~$0.03) |

**Typical new card:** about $0.50 to $0.90. Encompass's real refresh cost $0.65 against $1.80 declared.

## The badge on every card

1. **Could not build:** a plain reason (no match, no 10-Q or 10-K, a filing unreadable, cost cap reached).
2. **Signed:** a person has reviewed the card and its answer, and today's answer still matches it.
3. **Checks failed:** the card shows, with a panel listing each failure and its source. Failed figures are withheld, never shown as clean numbers.
4. **Checks passed:** every automated check holds, including 3-of-3 stability, but no person has signed.

## Spending caps (all checked before each call)

- **$2.00** worst case per card.
- **$10** a day per user.
- **$25** a day across everyone.
- A cached card never asks: it is proven free first.
- Every price is rounded up to the cent.

## Decisions already made (1 to 13)

1. **Refresh triggers:** a new 10-Q or 10-K, or an 8-K with a debt item (1.01, 1.02, 2.03, 2.04, 8.01). Otherwise the last card is served.
2. **Caps:** $2.00 per card, $10 per user per day, $25 per day overall.
3. **One build at a time per company:** a lock (Upstash Redis), so two requests never pay twice.
4. **Rebuilds are byte-identical** from cache; new extractions are compared against the recorded tolerances.
5. **Company lookup** returns every match and never caches a guess.
6. **Prices round up** to the cent.
7. **A refresh re-runs every paid step** on the new filing, card facts included.
8. **A section not yet read** from the new filing says so; it never claims absence.
9. **Standing terms vs balances:** a 10-K-only standing term shows with a "10-K" tag; a 10-K-only balance never shows.
10. **Serving from the last build** reads the filing list as it stood at that build.
11. **The card-facts step reads the same documents as the main extraction**, debt 8-Ks included. (Agreed, not yet built.)
12. **Never price or bill on a stale filing list.**
13. **"This offering" looks back at most three sentences**, until paragraph breaks are kept. (A stated approximation.)

## Open decisions, with my recommendation

1. **Build decision 11 before Stage 2 opens.** *Recommend yes.* Today the card facts can miss a move's day or price that only an 8-K states. It needs a facts re-run per name, about $0.10 each, declared first.
2. **Keep paragraph breaks in the text step** and retire decision 13's approximation. *Recommend yes.* It is a $0 code change, but every cached document must be re-read once.
3. **Seniority and security from the 10-K, tagged** (your Nov 9 question). *Recommend yes.* Only Encompass changes: its four senior notes become "senior unsecured", tagged 10-K, and its bars move from grey to the unsecured colour.
4. **Who may sign.** *Recommend:* only you, for now. New companies show "Checks passed" until you have seen the card.
5. **Narration on new cards.** *Recommend:* off by default; on per card at ~$0.03 once its checks pass.
6. **What a new user sees before paying.** *Recommend:* the price and the worst case on one screen, with a single Approve button; nothing bills without it.

**Next, if you approve:** build steps 1 to 6 first, at $0 (lookup, filing list, read set, cache check, pricing), then the paid steps behind the approval screen.
