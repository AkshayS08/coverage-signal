# Coverage Signal — Build Map & Architecture

## 1. Product spec

A web app. The user enters a book of company names; an agent scans public filings and news for each, triages trigger events (dig-or-drop), maps the real ones to a banking conversation, and returns a ranked call sheet — showing its reasoning live as it works.

- **Input:** a list of public company names (demo). Preset healthcare-services book for one-click.
- **Fetched (server-side):** SEC EDGAR filings (8-K, 10-Q), news headlines.
- **Output:** (a) a live agent trace, (b) a ranked call sheet — Company | Trigger (cited) | Banking need | Opener | Confidence — sorted by a treasury-weighted score.
- **Non-negotiables:** public data only in the demo; the agent never makes a credit decision; every claim cited; the whole thing must run and read clearly in a two-minute demo.

## 2. Tools & stack

- **Framework:** Next.js (React frontend + API routes as backend), TypeScript.
- **Host:** Vercel — one deploy gives a shareable URL; API key lives in an env var.
- **AI:** Anthropic API (Claude) via SDK, server-side, tool-use loop. Haiku for extraction/classification, Sonnet only for opener drafting (see Model routing below).
- **Data:** SEC EDGAR (submissions + filings) and a news source (news API or RSS), fetched server-side with a real SEC User-Agent.
- **Streaming:** server-sent events / streamed response to push the trace to the browser.
- **Storage:** in-memory + a file cache for the demo. No database needed.

## 3. Architecture

**Data flow**
```
Browser (input book)
  → POST /api/run
     → [deterministic] resolve names → CIKs, pull recent filing list + headlines (cached)
     → for each company: AGENT LOOP (model + tools)
     → [deterministic] score + rank
  → stream trace events → Browser (trace panel + call sheet)
```

**Components**
- **Fetch layer (deterministic):** EDGAR + news pulls, cached to disk so re-runs don't re-spend.
- **Agent loop (the centerpiece, per company):** a tool-use loop.
  - *Tools:* `get_recent_filings`, `read_filing`, `search_news`.
  - *Cycle:* observe → decide (is there a trigger? dig or drop) → act (fetch more if ambiguous) → re-evaluate → emit `{trigger, need, opener, confidence, citations}` or "no actionable trigger."
  - *Bounds:* ~5 steps max; stop when confident.
- **Ranker (deterministic):** `score = need_value × recency × confidence`; `need_value` weights treasury/deposit above credit.
- **Trace streamer:** emits each loop decision as one readable line to the UI.

**Deterministic vs agentic (design stance)**
The scan, the filing-list pull, and the ranking are deterministic and cheap. The model runs *only* inside the per-trigger triage loop and to draft the opener. The loop is spent only where the event is ambiguous enough to need it.

**Model routing (which model runs where)**
Not one model everywhere. Route by task, cheapest that clears the bar:
- **Haiku** — trigger detection, dig-or-drop classification, extraction. These are extraction tasks; Haiku (~3x cheaper than Sonnet) handles them well and is the default inside the loop.
- **Sonnet** — only the opener drafting, and only that one step where an ambiguous dig-or-drop is misfiring. Openers are a tiny share of tokens, so the quality lift costs almost nothing.
- Rule: never pay Sonnet rates for extraction. If Haiku ever fumbles a specific ambiguous case, upgrade *that step*, not the whole loop.

**Caching layer (fetch once, reuse forever)**
Every raw pull (8-K, 10-Q, headline) is written to a disk cache keyed by company + filing. The loop reads filings from the cache, never re-fetches. This means dev iteration re-runs the model against local files at zero fetch cost, and repeat demo runs on the same book are near-free. The cache is a first-class component, not an afterthought — it's the main cost lever.

**Constraints to honor**
- EDGAR and news fetched server-side (browser CORS + key safety).
- Throttle requests; real SEC User-Agent.
- Cap the book (~12) and cache to control cost on a public link.
- Private-company data is out of scope for the demo. The real version reads bank-internal signals (idle operating balances, escrow wires, on-book maturities, FX volume) — richer, and only the bank has them.

## 4. Build steps (1 hr / session, ~6)

1. Scaffold Next.js; deploy a hello-world to Vercel → get the live URL first.
2. Server route: EDGAR + news fetch; validate raw pulls for 3 names. No model yet.
3. Agent loop: tools + the ReAct loop for one company, console output.
4. Stream the loop's steps to the trace panel; one readable line per decision.
5. Ranker + call-sheet table + the preset healthcare book.
6. Polish so it reads like a tool; cap/cache; run on ~12 names; tighten citations → ship the link.

**Cost discipline while building**
- Mock the model response while building fetch, streaming, ranking, and UI (steps 2, 4, 5). Zero tokens until the loop itself is what you're testing.
- Develop the loop against a fixed 3-name set with hand-verified triggers. Only run the full 12-name book a handful of times, right before the demo.
- Result: build cost lands under ~$10, not $50.

**Gate to start building:** this map + the one-pager approved.
