# Coverage Signal — Metrics, Cost, Limits & Evaluation

## 1. Success metrics

- **Comprehension:** a non-banker watches one run and can explain, unprompted, what the tool does and why the dig/drop matters — in under two minutes.
- **Latency:** a full ~12-name run completes in under 90 seconds.
- **Triage precision:** of the calls surfaced, ≥80% are ones you (as the banker) judge genuinely worth making; ≤1 obvious false positive per run.
- **Drop discipline:** clear noise (CFO change, ratings action, board appointment) is correctly dropped ≥90% of the time.
- **Insider signal:** at least one treasury/deposit opportunity per run that a lending-first RM would have missed.
- **Citation integrity:** 100% of surfaced triggers trace to a real, correct source. Zero invented facts.

## 2. Cost — build & run

Rates below are current per-million-token API prices; they change, so treat as estimates. The realistic total is **~$10–15**, not $70 — that upper figure only holds if you ignore every lever below.

| Item | Naive | With levers |
|---|---|---|
| API — per 12-name run | ~$1–2 | ~$0.30–0.60 |
| API — full build phase | ~$20–50 | ~$5–10 |
| Hosting — Vercel Hobby | $0 | $0 |
| SEC EDGAR | $0 | $0 |
| News — RSS / free tier | $0 | $0 |
| **Total to build + demo** | ~$20–70 | **~$10–15 + your ~6 hours** |

**The four levers (cheapest first):**
1. **Haiku, not Sonnet, for the loop.** Detection and classification are extraction — Haiku (~3x cheaper) is fine. Reserve Sonnet for opener drafting only. Cuts the bill by more than half.
2. **Cache every filing.** Fetch each 8-K/10-Q once, reuse across all runs. The single biggest dev-cost saver, and you're building the cache anyway.
3. **Fixed 3-name test set.** Develop the loop against three hand-verified companies. Run the full 12-name book only a handful of times, right before the demo.
4. **Mock the model while building plumbing.** Hardcode a fake agent response for the fetch, streaming, ranking, and UI work. Zero tokens until the loop logic itself is what you're testing.

**Guardrail:** keep the ~12-name cap and cache on for any public link, or a curious visitor can run up spend. And don't downgrade the demo loop to save pennies — a wrong trigger in front of Gabe costs far more than tokens. Test Haiku; if it fumbles a specific ambiguous dig-or-drop, upgrade *that step* to Sonnet, nothing else.

## 3. Limitations (name these before Gabe does)

- **Public data only.** Misses private companies — most of a real book — and every non-public trigger. This is the demo's ceiling and the real version's opportunity.
- **News quality.** Headlines can be noisy, stale, or missing; the dig step is only as good as the source.
- **No credit judgment, by design.** It can't prioritize by the bank's actual credit appetite — it flags conversations, not decisions.
- **Rules-based mapping.** The trigger→need logic is transparent but won't catch novel or compound situations.
- **Filing lag.** 8-Ks are timely; 10-Q signals are quarterly, so some reads are weeks old.
- **Standalone.** No CRM or core-banking integration; it doesn't know who's already been called.
- **Heuristic confidence.** The confidence score is indicative, not statistically calibrated.

## 4. Evaluation checkpoints (gates)

- **After S2 (fetch):** raw EDGAR + news pulls are correct for 3 known names — spot-check that filings actually match.
- **After S3 (loop):** on 3 hand-verified cases the agent returns the right trigger + citation; it visibly digs on 1 ambiguous case and stops within the step bound.
- **After S4 (trace):** a non-banker reads the live trace and follows it without help.
- **After S5 (ranking):** treasury triggers rank above credit; the call sheet matches your banker judgment on a 12-name set.
- **Pre-demo:** run 12 names end-to-end three times — latency under 90s, zero hallucinated citations, ≥80% call precision, cost per run within budget.
- **Pre-send to Gabe:** a non-finance person watches it and can explain back what it does and why dig/drop is the point. If they can't, fix the trace, not the model.
