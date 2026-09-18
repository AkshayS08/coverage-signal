# Coverage Signal — Card Eligibility Spec (v2 redesign)

Defines what surfaces as an actionable **flash card** (call this week) vs what stays in the **portfolio table** (weekly update, not urgent). Replaces the old company-level weighted scoring. No ranking of one opportunity type against another — the tool surfaces urgent, valuable events and lets the RM judge; events are ordered only by time-to-event.

## The core test
An event earns a flash card if it is **both**:
1. **Dated or live** — it happened or will happen at a knowable time (announced, closing pending, a maturity date, a quarter-over-quarter change), and
2. **Actionable within ~12–18 months** — an RM calling this week could plausibly win business from it.

Standing conditions (has floating-rate debt, has FX exposure, ongoing buyback) are NOT events → they go to the portfolio table.

## The four opportunity buckets & their card triggers

**1. Treasury / deposits**
- Asset sale / divestiture announced or closing → card
- Acquisition closing (escrow, integration accounts, flows) → card
- Large capital raise completed (equity or debt, proceeds need a home) → card
- Cash balance up **>30% QoQ** (from the two most recent 10-Qs) → card
- *Table only:* standing cash levels; cash jump uncomputable (only one 10-Q available)

**2. New debt / financing need**
- Acquisition announced with financing undisclosed or bridge → card
- Major capex program / new facility announced → card
- **Newly increased or newly announced** buyback/dividend authorization (e.g. "board increased authorization from $2B to $4B on [date]") → card
- *Table only:* ongoing/unchanged buyback program

**3. Refi (debt maturity)**
- Debt maturity **inside 18 months** → card (refi conversations start 12–18mo ahead)
- *Table only:* maturity 18+ months out; just-completed refi/amendment (the moment has passed — nothing left to win this week)

**4. FX / rate hedging**
- Hedging need attached to a **new dated event**: new floating-rate debt just issued, or first-time / newly disclosed foreign revenue → card
- *Table only:* standing FX or floating-rate exposure with no change — **BUT the table summary must explicitly flag the hedging opportunity** so the RM still sees it

## Ordering (the only "ranking")
Flash cards sorted by time-to-event:
1. Live / pending events first (announced recently, "closing pending")
2. Then by nearest future date (soonest maturity/closing at top)

No cross-bucket weighting. An urgent refi and an urgent treasury event sit side by side, ordered by timing, and the RM decides.

## Output structure
- **Flash cards (top):** one per card-eligible event (can be 0 to ~8). Each shows: company (linked to EDGAR), event description, source filing link, short summary, and a suggested **Angle**.
- **Portfolio table (below, collapsible):** every company × the 4 buckets — the weekly "stay informed" layer with full evidence. This is where non-card-eligible signals live, including flagged-but-not-urgent hedging opportunities.
- **Agent trace:** hidden/collapsed by default (RMs don't need it); available via toggle (kept for demo value).

## What this preserves
- The 15 triggers still run — they now map *into* the 4 buckets and feed the card/table decision.
- Dedup: because cards are per-*event*, multiple triggers citing the same filing/event collapse into one card (fixes the old triple-counting).
- The treasury insight lives in the taxonomy (these triggers exist at all) and the Angle lines, not in an algorithmic weight.

## Design rationale (for the Gabe conversation)
Originally scored companies with a treasury-weighted formula. Rejected it: ranking "urgent treasury vs urgent refi" is a banker's judgment, not the tool's. The tool's job is to *notice and frame* actionable events; the RM decides which call to make first. Simpler, more honest, easier to defend — and it removes fake precision (an unbounded "1.48" score that meant nothing to a viewer).
