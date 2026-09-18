# Coverage Signal — Detailed Build Log

A session-by-session record of what was built, the Claude Code prompt used, the logic, and the verified output. Kept so any architecture question (e.g. from Gabe) can be answered from the actual implementation, not memory.

Stack: Next.js + TypeScript, deployed on Vercel. Anthropic API (Haiku) for classification. SEC EDGAR for data. Model routing: Haiku for extraction/classification; Sonnet reserved for opener drafting (later). Deterministic-vs-agentic split throughout: cheap deterministic steps do the plumbing; the model runs only where judgment is needed.

**Paths in older entries are pre-reorg.** These documents lived outside the
repo until the docs cleanup after Session 22, when they were brought in and
renamed. Entries written before it name the old files; they are left as
written, because an entry is a record of what was true when it was made. The
map, once:

| named in older entries | now |
|---|---|
| `coverage_signal_BRD.md` | `docs/BRD.md` |
| `coverage_signal_build_log.md` | `docs/build_log.md` (this file) |
| `coverage_signal_trigger_taxonomy.md` | `docs/trigger_taxonomy.md` |
| `coverage_signal_card_eligibility_spec.md` | `docs/card_eligibility_spec.md` |
| `coverage_signal_metrics_cost_limits.md` | `docs/metrics_cost_limits.md` |
| `coverage_signal_build_map.md` | `docs/build_map.md` |
| `files/session_NN_*`, `session_NN_*` | `sessions/NN/` |

Every rule's own entry is indexed in `docs/rules.md`, generated from the
headings below.

---

## Session 1 — Scaffold + deploy

**Goal:** stand up the Next.js app and get it live on a real URL (deploy-first).

**Logic:** Deploy before building features so deployment isn't a late surprise. Stub the UI shape (input + two panels) with no logic.

**Built:**
- Next.js + TypeScript app scaffolded.
- `app/page.tsx` — title "Coverage Signal", subtitle "Who to call this week", textarea pre-filled with 8 healthcare-services names, "Run agent" button, and two panels: "Agent trace" (left), "Call sheet" (right).
- `.env.local` with `ANTHROPIC_API_KEY` placeholder; `cache/` folder gitignored; folder structure `lib/fetch|agent|rank|book`.
- Deployed to Vercel via GitHub.

**Deployment issues resolved (for reference):**
- Git wasn't initialized in the app folder; app had been scaffolded under a different directory (`Revised Agent/`) than the git repo (`RM Product/`). Moved app into place.
- GitHub rejected password auth → installed GitHub CLI (`gh auth login`).
- Local branch was `master`, GitHub default `main` → pushes needed `git push origin master:main`.
- **Root cause of repeated 404s:** Vercel **Framework Preset** was set to "Other" instead of "Next.js", so it never ran the Next build (14-second no-op builds). Fixing the preset to Next.js resolved it. Also a stale `turbopack.root` in `next.config.ts` was removed. Lesson: on a Vercel 404 with a suspiciously fast build, check Framework Preset first.

**Output:** live URL rendering the scaffold — title, pre-filled book, button, two empty panels.

---

## Session 2 — Deterministic fetch layer

**Goal:** pull real SEC filings by company name and cache them. No model, no UI.

**Logic:** This is the deterministic supply line. Resolve a company name to its SEC identifier, pull its filings, cache every raw pull so nothing is fetched twice (the main cost lever).

**Built in `lib/fetch/`:**
- `cache.ts` — generic disk cache (`cachedFetch`/`readCache`/`writeCache`) rooted at `cache/`.
- `http.ts` — throttled SEC fetch wrapper (~8 req/sec, under SEC's 10/sec limit) with a real `User-Agent`.
- `cik.ts` — `resolveCik(name)` against EDGAR's `company_tickers.json`, normalizing away suffixes (Inc/Corp/Holdings).
- `filings.ts` — `getRecentFilings(name, forms)`, pulling EDGAR's submissions API per CIK, caching raw pull + per-company-per-form derived lists.
- `test.ts` — CLI (`npm run fetch:test`).

**Output (verified, real EDGAR data):**
- HCA Healthcare → CIK 0000860730, 132 filings
- DaVita → CIK 0000927066, 154 filings
- Encompass Health → CIK 0000785161, 142 filings
- First run: fetched fresh + cached. Immediate re-run: cache hit across the board, zero re-fetches. Build/lint/type-check clean.

---

## Session 3 — The agent loop (trigger intelligence)

**Goal:** classify a company against the 15-trigger taxonomy; dig on ambiguous triggers; emit verdict + citations. Console only.

**Logic — the core product.** The 15 triggers ARE the intelligence (see `coverage_signal_trigger_taxonomy.md`). The loop assesses all 15, records "searched but no public signal" (`dataAvailable: false`) for triggers public data can't feed (rather than hiding them — that blank is the argument for the internal-data version). The model only "digs" (reads a full filing) when a trigger is genuinely ambiguous.

**Built in `lib/agent/`:**
- `triggers.ts` — all 15 triggers: `id`, `name`, `signal`, `mappedNeed`, `needType` (credit/treasury/distress), `detectability` (PUBLIC/INTERNAL), item-code hints.
- `selectFilings.ts` — deterministic baseline-filing picker using 8-K item codes to prioritize which filings are worth reading before any model call.
- `tools.ts` — `getRecentFilings` (re-exported), `readFiling(url)`, stub `searchNews(company)` → `[]`.
- `claude.ts` — Haiku (`claude-haiku-4-5`) via forced tool-use: one `classifyAllTriggers` pass over all 15, plus `classifyOneTrigger` for dig follow-ups.
- `loop.ts` — `runAgentLoop(company)`: fetch filings → read baseline corpus → base Haiku pass → walk all 15 (print FIRED / no-signal / DIG / dataAvailable-false) → bound digs at 5 → compute verdict.
- Extended `lib/fetch/`: added `items` (8-K item codes) to `FilingEntry`; added `filingText.ts` for cached, HTML-stripped filing text.

**Key fix — corpus-skip guard:** the model's first run wasted 3 of 5 dig slots re-requesting filings already in the baseline corpus (returning identical text). Added a check to skip digs against URLs already held. Re-run needed only 1 real dig. This is the deterministic/agentic discipline in practice — only spend a dig when there's genuinely new information.

**Output (verified, real DaVita run):** all 15 triggers assessed. 5 fired — debt maturity (Term Loan A-2 2027, revolver 2026), new debt issuance ($1B notes + 2 credit-agreement amendments), revolver utilization, $2B buyback authorization, floating-rate debt with SOFR caps — each with real evidence quoted from filings. 1 correctly `dataAvailable: false` (new subsidiary/entity — INTERNAL). Zero distress flags. Verdict: CALL.

---

## Session 3.5 — Corpus expansion (material change)

**Goal:** give the model more state, so it needs fewer digs and reads exposure that quarterlies compress.

**Logic:** filing selection is deterministic and count-based, not date-windowed. Periodic filings carry *state* (a maturity shows in the debt table regardless of when announced); event filings (8-K) carry *events*. Read both.

**Change (`selectFilings.ts`, `loop.ts`):** baseline corpus expanded from 1 10-Q + up to 6 8-Ks to:
- 2 most recent 10-Qs (state + quarter-over-quarter movement)
- 1 most recent 10-K (full debt schedule, risk factors, FX/rate/commodity exposure)
- up to 6 high-signal 8-Ks (item-code filtered: 1.01/1.02/1.03/2.01/2.03/2.04/2.05/2.06/3.02/7.01/8.01; fallback to 3 most recent if none qualify)
= 9 filings read. Dig cap and corpus-skip untouched.

**Output (verified):** corpus now 2 10-Q + 1 10-K + 6 8-K; 10-K caches correctly; build passes. Same 4–5 triggers fire, same INTERNAL flag, same CALL verdict — and **zero digs needed** (richer corpus resolved every trigger in the base pass). Fewer digs = lower cost; confirms feeding better context up front reduces expensive round-trips.

---

## Session 4 — Stream the trace to the UI

**Goal:** turn the console trace into a live, watchable stream in the "Agent trace" panel.

**Logic:** the trace is the demo's soul — the viewer should *watch the loop reason*, one readable line per decision, not read JSON.

**Built:**
- `app/api/run/route.ts` — takes a company name, runs `runAgentLoop`, streams each decision back (server-side, key from `.env.local`).
- `app/page.tsx` — "Run agent" reads the first non-empty textarea line, POSTs to `/api/run`, reads the response as a streaming reader loop (buffers partial lines across chunk boundaries), appends each complete line to trace state as it arrives. Button disables / shows "Running..." mid-run.

**Output (verified via Playwright against dev server):** trace grew 0→2 lines at ~424ms, held at 2 for ~13.5s (the single batched Haiku call in flight), then jumped to the full 22 lines at ~13.9s. Genuinely incremental over 13+ seconds; the 15 per-trigger results land together because they come from one Haiku call (by design). Zero console errors. Call sheet still empty (session 5).

**Known demo-feel issue (deferred to polish/session 6):** the ~13-second gap where the panel sits at 2 lines then dumps all 15 reads as "is it frozen?" in a live demo. Fix is cosmetic, not logic: stagger the 15 results in on the client (~150ms each) so they cascade like live reasoning, plus optional "working..." filler lines during the wait. No backend/cost change.

---

## Session 5 — Multi-company run + ranking + call sheet

**Goal:** run the whole book, rank CALL companies treasury-first, and fill the call sheet panel.

**Logic:** ranking is deterministic. Treasury/deposit triggers outrank credit triggers (the insider skew — that's where commercial margin lives and where lending-trained RMs under-call). Distress triggers surface as relationship flags, never scored as sell opportunities.

**Built:**
- `lib/rank/score.ts` — `scoreTrigger()`: `score = need_value × recency × confidence`. Treasury weighted 1.5× vs credit 1.0×; distress = 0 (never scored). Linear recency decay (1.0 today → 0.1 floor at 24 months, from most recent citation date).
- `lib/rank/opener.ts` — deterministic templated one-liner from the top trigger (no model call; Sonnet openers deferred to polish).
- `lib/rank/rankCompanies.ts` — filters to CALL verdicts, scores each by its highest-scoring fired credit/treasury trigger, sorts descending. Distress-only and no-signal companies excluded. Dependency-free (type-only imports) so safe in the browser bundle.
- `lib/agent/streamEvents.ts` — NDJSON wire protocol (`trace`/`result`/`error`/`done`) shared server↔client.
- `app/api/run/route.ts` — takes `{ companies: string[] }`, loops sequentially through `runAgentLoop`, capped at 12 (metrics-doc guardrail), streams NDJSON.
- `app/page.tsx` — parses every non-empty line as a company, streams/parses NDJSON, groups trace lines under company headers, renders ranked call-sheet cards (rank, company, score, opener, per-trigger needType badge/name/mapped-need/confidence/citation links).

**Output (verified, real 3-company headless run — DaVita, HCA, Encompass):**
- All 3 got CALL. **Encompass ranked #1** because it fired a treasury trigger (asset sale/divestiture → proceeds deposit + sweep), outranking HCA and DaVita *despite lower confidence* — the treasury skew working on real data, not a synthetic check. This is the headline demo outcome: the ranking surfaced the exact opportunity a lending-trained RM would under-call.
- Citations are real, clickable EDGAR URLs matching each company's CIK.
- Trace panel delineates each company's block; treasury badge teal vs gray credit badge; zero console errors.
- Deterministic/agentic split, corpus-skip, and 2×10-Q + 10-K + 6×8-K baseline untouched.

**Status:** full loop working end to end — book in → agent reasons per company → ranked, cited call sheet out. Product, not scaffold.

---

## Session 6a — Demo pacing + honest dig handling

**Goal:** kill the frozen-panel effect and handle the visible-dig question honestly.

**Fix 1 — Trace pacing (client-side only, `app/page.tsx`, zero backend change):**
- A reveal-queue sits between incoming NDJSON events and the visible trace: real lines queue and drain one at a time every 150ms instead of dumping in one render.
- When the queue is empty and the panel is idle >700ms (waiting on the batched Haiku call), rotating filler lines ("scanning 15 trigger signals...", "cross-referencing the debt schedule...") keep it moving — dimmed/italic so they never read as real findings.
- Verified: max gap between visible lines was 853ms (under the 1s target) across the ~18s wait, with the 15-trigger burst cascading in at ~120–250ms/line instead of at once.

**Fix 2 — Visible dig, redefined (honest, per decision):**
- Tested 20+ real healthcare-services companies for a genuine second-Haiku-call dig; none fired — the richer corpus consistently resolves ambiguity in the base pass or via the free corpus-skip check.
- Decision: do NOT rig the corpus to manufacture a dig. Use the real `"...unclear, but nothing new to check — no signal found"` line as the honest demo proxy for the decision point (verified live with DaVita). Shows the agent *reaching* the dig decision and correctly deciding nothing more is worth fetching — judgment, not a staged trick.
- **How the dig capability gets shown to Gabe (not via live demo):** (a) tell the story + point at the code path and the corpus-skip guard; (b) the saved session-3 DaVita transcript, a real run that needed 1 dig before the corpus was expanded. Framing: "I built the dig capability, then gave it a rich enough corpus that it rarely needs to run" — engineering the expensive step to rarely fire.

**Data fix found along the way:** "Select Medical Holdings" (in the default book) errors on lookup — went private in 2021, no longer files with SEC. Replaced with Concentra Group Holdings (verified). Moved DaVita first (most-tested, reliably shows the decision-point line).

**Scope:** only trace pacing (client) + default book list (data). No changes to agent logic, taxonomy, ranking, or corpus. Type-checks, lints, builds clean.

---

## Session 6b — Spend safety + Sonnet openers + tool polish

**Goal:** make the app safe to expose on a public link, warm up the openers, and make it read like a real bank artifact.

**1. Spend safety:**
- **Passphrase gate:** `APP_PASSCODE` env var, checked server-side in `route.ts` before any model call. Missing env var → 500 (fail-closed, not silently open). Wrong/missing passphrase → 401, nothing runs. Never referenced in client code — confirmed absent from compiled client bundle.
- **Rate limit:** in-memory per-IP limiter (`app/api/run/rateLimit.ts`), max 10 runs/hour, clear 429 with retry time. Honest limitation noted: in-memory resets on cold start/redeploy — a backstop behind the passphrase gate for a single low-traffic link, not distributed rate limiting.
- **12-company cap** from earlier session confirmed still active.

**2. Sonnet openers** — one Sonnet call per CALL company (cost-bounded), 10s timeout, falls back to template + logs source (trace + server console) on failure.
- **Real bug fixed:** `temperature` is deprecated on this Sonnet model version and every call was silently failing into the template fallback. Removed it; strengthened the system prompt (first version added unwanted preamble/meta-commentary). Verified both test companies now get warm, specific, evidence-referencing one-liners (referencing the actual Enhabit divestiture, Ninth Amendment terms), tagged "Sonnet-drafted" in UI.

**3. Tool polish:**
- Treasury badge now vivid amber/gold vs neutral gray credit badges, plus amber left-border accent on the whole card when the top trigger is treasury — unmistakable at a glance.
- Citations are clickable links with external-link marker.
- New summary line format.
- **Real bug fixed:** error messages (wrong passphrase, rate-limit) were silently dropped because the reveal-queue drain wasn't awaited on early-return paths — now fixed so every error is visible.

**Output (verified live, cost-consciously — used empty-company requests to pre-consume rate-limit budget instead of burning API calls):** wrong passphrase blocks immediately; correct passphrase runs; 11th request/hour gets clean 429; Sonnet openers read well with working fallback; treasury-first ranking visually obvious (Encompass #1 over DaVita on its treasury trigger). Layout holds at 1280×800, 1440×900, 1920×1080. Type-check, lint, build clean; no secrets/SDK in client bundle.

**Env vars now required:** `ANTHROPIC_API_KEY` and `APP_PASSCODE` — both must be set in `.env.local` (local) and in Vercel (production) before the live link works.

---

## Deployment checklist (next)
1. Vercel → Settings → Environment Variables: add `ANTHROPIC_API_KEY` and `APP_PASSCODE` (Production).
2. Push latest to GitHub; confirm Vercel redeploys from the newest commit.
3. Test the live URL end to end: wrong passphrase blocks, correct passphrase runs the book, call sheet renders with Sonnet openers and treasury-first ranking.
4. Only then share the URL + passphrase with Gabe.

**DEPLOYED (done):** live on Vercel with both env vars set. Fixed a Vercel-only bug — filesystem is read-only except `/tmp`, so `cache.ts` now roots the cache at `os.tmpdir()/coverage-signal-cache` when `process.env.VERCEL` is set (local dev unchanged). Trade-off: `/tmp` wipes between runs, so the live site fetches fresh each run (fine for demo); the cache-hit cost saving still applies locally.

---

## Session 7 — Actionability pass (evidence, selectivity, confidence removed)

**Goal:** make the output actionable — an RM should know who to call and why WITHOUT opening a filing. No changes to taxonomy or corpus.

**Changes:**
1. **Evidence line per fired flag** — each fired trigger now shows the specific fact from the filing (e.g. "Company announced agreement to sell ownership interests in Mountain View Hospital, LLC and Idaho Falls Community Hospital, LLC..."), one factual line above the citation. The agent already extracted this; it's now carried through to the card. This is the fix that makes the tool save the scan instead of just pointing at filings.
2. **Confidence removed entirely** — deleted from the UI and from the scoring formula. **New score = need_value × recency** (confidence factor dropped). (Field left on the internal `TriggerResult` type since the model still produces it agent-side; just no longer consumed.)
3. **Call vs Monitor split** — `CALL_THRESHOLD` constant in `lib/rank/rankCompanies.ts`, calibrated against a real run (scores 1.48, 1.32, 1.31, 1.15, 0.99, 0.99, 0.94, 0.92 — clear gap) and set to **1.2**. Above → full call cards; below → collapsed "Monitor" list (name + top trigger). Summary line: "N assessed · M to call · K monitoring".
4. **Filing dates verified (not a bug)** — cross-checked DaVita's most recent 8-K against the cache, EDGAR's live submissions JSON, and EDGAR's atom feed; all agree (2026-06-08). Code passes EDGAR's ISO dates through verbatim. The "future" impression is just that we're deep into 2026. Left untouched.
5. **Cards lead with the top trigger** as a visually distinct headline; supporting triggers under "ALSO FLAGGED".

**Side benefit:** Sonnet now only runs for companies that clear the call bar (2 calls this run vs 8 before) — output is more selective AND cheaper.

**Known behavior (not a bug):** the call/monitor split shifts slightly run-to-run (saw 2/6 and 3/5) due to genuine Haiku non-determinism on borderline triggers. If demo repeatability matters, pin classification temperature later. Honest framing for Gabe: "slight variance on borderline cases, expected for an LLM classifier."

**Verified:** two full real runs of the 8-company book (headless + screenshots), zero console errors, 6a pacing intact, type-check/lint/build clean. Diff touched only `lib/rank/*`, `app/page.tsx`, `app/page.module.css`, `app/api/run/route.ts`.

---

## Scoring formula (on record — answer to "how does scoring work?")

**Company score = its single highest-scoring fired trigger.**
**Trigger score = need_value × recency.**
- **need_value** — treasury/deposit triggers 1.5×, credit 1.0×, distress 0 (never scored). This is the insider skew: treasury/deposits are where commercial banking margin lives and where lending-trained RMs under-call.
- **recency** — linear decay from 1.0 (today) to a 0.1 floor at 24 months, based on the most recent citation date. Older trigger → lower score.
- **(confidence removed in session 7 — was a model self-estimate, not calibrated, so dropped.)**
- **CALL_THRESHOLD = 1.2** — above → "call this week"; below → "monitor". Tunable single constant.

---

## Decisions & rejections (the "why", for defending the design)

Reasoning behind key choices, and paths deliberately NOT taken. These are the likely probe points in a technical conversation.

**Chose: a "notice the moment" tool (trigger detection). Rejected: a research/summary tool.**
Research and document-summary tools already exist (and are the incumbent product category). The scarce thing in commercial coverage isn't information about a client — it's noticing *when* a client develops a need. So the product detects trigger events, not "tell me about company X".

**Chose: treasury/deposit-weighted ranking. Rejected: neutral or lending-first weighting.**
The insider point. Commercial banking margin lives in operating accounts/deposits, not lending, but RMs are lending-trained and systematically under-call treasury opportunities. Weighting treasury above credit corrects the bank's real blind spot — the thing a generalist would get wrong.

**Chose: assess all 15 triggers and show "no public signal" for the ones that can't be checked. Rejected: silently skipping undetectable triggers.**
The blanks (INTERNAL-tagged triggers like new-subsidiary/entity formation) are honest AND are the argument for the internal-data version: "the framework ran all 15; these gaps are exactly the treasury signals that live inside the bank."

**Chose: deterministic pipeline + a model only inside the triage/dig step. Rejected: model-everywhere.**
Most of the pipeline (fetch, filing selection, ranking) is deterministic and cheap. The model runs only where judgment is needed (classify + dig + briefing). Corpus-skip guard prevents digging into filings already in hand. This is the cost/architecture story.

**Chose: rich baseline corpus (2×10-Q + 10-K + 6×8-K), accepting that digs rarely fire. Rejected: thin corpus to force visible digs / rigging the corpus to manufacture a demo dig.**
A staged dig is a prop that collapses under a sharp question. Instead: give the model enough context up front that it rarely needs the expensive dig (a feature — engineering the costly step to rarely run). The dig capability is shown via the code path + the real session-3 transcript that needed a dig before the corpus was expanded, not a live-forced one.

**Chose: remove the confidence score entirely. Rejected: keeping/displaying it.**
It was the model's own uncalibrated self-estimate (95-98% everywhere), added no real signal, and invited an unanswerable "confidence in what, measured how?" question. Removed from display and from the scoring formula.

**Chose: RM-facing briefing (analyst note + suggested angle). Rejected: client-facing pitch opener.**
The first opener version opened with presumptuous "Hi, congratulations on the sale..." — salesy, assumed facts/rapport, read as AI-written. Replaced with a terse internal briefing a banker would respect, plus one "Angle" line (a recommendation, where the treasury insight shows — not a pitch).

**Chose: selectivity (call vs monitor threshold). Rejected: flagging every company as a call.**
A list where everyone's a "call" is noise, not triage. The value is making the cut. Threshold surfaces the few that matter; the rest are monitored (and, per the final polish, still fully expandable so the RM can override the cut).

**Chose: keep full evidence on every trigger (including supporting ones). Rejected: shortening supporting-trigger evidence.**
Considered trimming supporting triggers to one line for density. Rejected for now: while proving thoroughness (demo/Gabe stage), full sourced evidence on every trigger IS the demonstration of depth. Trimming for daily-use speed is a later, real-product optimization — not now.

**Chose: temperature 0 on Haiku classification. Rejected: leaving it at default.**
Default temperature produced run-to-run variance on borderline triggers (call/monitor split shifted 4→2 on identical runs). Temperature 0 (confirmed accepted by claude-haiku-4-5) makes identical runs return identical results — needed so a live demo doesn't change answers when the same book is run twice.

**Chose: passphrase gate + rate limit + 12-company cap. Rejected: an open public link.**
A live link that runs the agent spends real API credits per run. Gated so only the intended recipient (a founder) can trigger runs; rate-limited and capped so even a valid user can't run up spend.

**Explicitly out of scope (the "real version" story, told not built):** private-company data, bank-internal signals (idle balances, escrow wires, on-book maturities, FX volume), CRM/core-banking integration, news feeds, >15 triggers, calibrated confidence. These define the valuable internal version; the public tool proves the framework.

---

## Session 8 — Briefing rewrite + "why now" timing

**Goal:** replace the salesy client-facing opener with an RM-facing briefing, and surface real urgency. No changes to taxonomy, corpus, scoring, or threshold.

**Changes:**
1. **Opener → Briefing.** Replaced the client-facing "Hi, congratulations..." pitch with an RM-facing internal briefing: 2-4 factual bullets + one "Angle:" line, styled as an analyst note (no greetings, no congratulations, no assumed rapport). New files `lib/rank/briefing.ts` (template fallback) and `lib/rank/sonnetBriefing.ts` (Sonnet call, kept out of the client-safe barrel). Deleted `opener.ts`/`sonnetOpener.ts`. The "Angle:" line is where the treasury insight shows (e.g. lead with deposit + sweep on a proceeds event) — a recommendation, not a pitch.
2. **"Why now" timing.** Added guidance to the Haiku classification prompt (`lib/agent/claude.ts`) so evidence lines surface real timing ("refi window open now (~9 months out)") when the filing discloses it — never invented.

**Bug found and fixed:** first test showed 3 of 4 CALL companies silently falling back to templates. Root cause: `max_tokens: 400` too tight (measured 379 output tokens in a multi-trigger case), truncating the JSON tool call mid-generation. Raised to 800 + tightened prompt to one sentence per bullet. (Second instance of a too-tight limit silently degrading quality — cf. the `temperature` bug in 6b. Pattern: silent fallbacks are the sneaky failure mode; per-session verification catches them.)

**Verified (full 8-company book, real passphrase + API calls):** all 4 CALL-tier companies (Tenet, Surgery Partners, UHS, Encompass) got genuine Sonnet-drafted briefings, zero template fallbacks. Bullets terse and factual (Surgery Partners: "$795M net cash after adjustments... closing pending physician approvals"). Every card has an "Angle:" line. "Why now" shows where real (Tenet 2027 refi window, UHS 2026 maturity) and absent where there's no genuine urgency. Zero console errors, 6a pacing intact, type-check/lint/build clean. Only expected files touched.

**Status: build complete.** Live tool: book in → agent assesses 15 triggers per company with real evidence → ranked call/monitor split → RM-facing briefing with suggested angle and timing, all cited. Ready to redeploy to Vercel and share.

---

## Session 9 — Final report-layer polish

**Goal:** make the output read as a real weekly report, not a one-off demo. Presentation only (`app/page.tsx`, `app/page.module.css`); no agent/taxonomy/scoring/threshold/corpus changes.

**Changes:**
1. **Monitor entries fully expandable** — each monitor row is a nested `<details>` expanding to the exact same full card (all triggers, evidence, citations, ALSO FLAGGED cap/toggle, briefing) via a shared `renderCompanyCard()` used by both calls and monitors. The threshold decides the default view, not whether detail exists — an RM can open any monitored name and override the cut.
2. **"How this works" methodology** — collapsed-by-default panel near the call-sheet header: plain-English explanation of the 15-trigger scan, treasury-weighted/recency-adjusted priority, and the call/monitor split. Answers Gabe's scoring question on the page itself.
3. **Top verdict banner** — bold "This week: N to call · M monitoring · K treasury opportunities" above the cards, so the takeaway lands before scrolling.
4. **As-of timestamp** — "As of [run date] · based on filings retrieved from SEC EDGAR", captured at run start. Makes it read as a recurring report.
5. **Company names clickable** — every name (calls + monitors) links to its real SEC EDGAR browse page via the already-resolved CIK, new tab.
6. **Collapsible trace panel** — wrapped in `<details open>`, expanded by default (so the demo still shows it), collapsible so the call sheet can be the focus. 6a pacing untouched (pure CSS-visibility toggle over unchanged state).

**Also folded in earlier this stretch:** evidence-line truncation removed (full sentences); raw XBRL/namespace tags forbidden in evidence (plain English only); "score" relabeled "priority" and de-emphasized vs the rank badge; ALSO FLAGGED capped at top 3 with "show N more"; trace filler expanded to 12 distinct non-repeating lines; temperature 0 confirmed on Haiku classification for run-to-run stability.

**Verified (live, real 8-company run):** banner "2 to call · 6 monitoring · 2 treasury opportunities", correct as-of date, methodology expands, all 8 names link to correct EDGAR CIK URLs, a monitor entry (Concentra) expands to its full card incl. evidence/citations/briefing and its own "show 1 more", trace collapses/re-expands with content preserved. Zero console errors; type-check/lint/build clean.

**Rejected this stretch (logged in Decisions above):** shortening supporting-trigger evidence for density — kept full evidence, since at the demo stage full sourced detail IS the proof of depth.

**BUILD COMPLETE.** Remaining work is non-code: push final to Vercel, keep API credits topped up so demos don't die mid-run, then profile spec + Gabe outreach.

---

## v2 REDESIGN — Event cards, not company scores (decided; build pending)

After a full live review, decided to rebuild the output layer. The intelligence (15 triggers, corpus, agent loop) is unchanged; what changes is everything *downstream* of classification. Full spec: `coverage_signal_card_eligibility_spec.md`.

**Why we rebuilt (the problems found in review):**
- Priority number was unbounded and meaningless to a viewer ("1.48 out of what?").
- Same real-world event (e.g. one hospital divestiture) fired multiple triggers and showed as 2-3 separate opportunities — double-counting that inflated cards and misled.
- Scoring was too blunt: all credit treated equal, so a refi maturing in 12 months scored the same as one in 5 years. A near-term refi (Tenet, ~12mo) should be a "call" but wasn't clearing the bar.
- "Top 2 calls" was arbitrary — real answer is "however many are urgent," which can be 1 to ~8.
- Company-level ranking forced a false judgment: is an urgent treasury opportunity more important than an urgent refi? That's the RM's call, not the tool's.

**What we decided (the new model):**
- **Kill company-level scoring entirely.** No numeric score, no priority number, no 1.2 threshold. Removed.
- **Surface EVENTS, not companies.** The tool flags actionable trigger events; the RM decides which call to make first.
- **Four opportunity buckets:** treasury/deposits, new debt/financing, refi (maturity), FX/rate hedging. The 15 triggers map into these.
- **Flash card test:** an event earns a card if it's (a) dated or live AND (b) actionable within ~12-18 months. Standing conditions (has floating debt, has FX exposure, ongoing buyback) → table only.
- **All card-worthy events are equal weight.** No cross-bucket ranking. Ordered ONLY by time-to-event: live/pending first, then nearest future date. ("Sooner = higher" is the one and only sort rule.)
- **Dedup:** cards are per-event, so multiple triggers citing the same filing collapse into one card (fixes the double-count).

**Specific card-eligibility calls we made (and why):**
- Cash-balance jump → card only if **>30% QoQ** (needs both recent 10-Qs; else table). A raw "has cash" isn't an event.
- Buyback/dividend → card only if **newly increased/announced** (e.g. "raised from $2B to $4B on [date]"); ongoing program → table. Chosen over a cash-ratio rule because "did they just raise it?" is a clean yes/no the model reads directly, vs fuzzy ratio math it could get wrong.
- Refi maturity → card if **within 18 months** (not 12) — refi conversations start 12-18mo ahead.
- Just-completed refi/amendment → **table**, not card — the moment passed, nothing to win this week. (Overrode the earlier "DaVita amendments are interesting" instinct: interesting ≠ actionable-this-week.)
- Hedging → card only when attached to a **new dated event** (new floating-rate issuance, newly disclosed foreign revenue); standing exposure → table, **but the table summary must explicitly flag the hedging opportunity** so it's not lost.

**Structure decided:**
- Flash cards on top (0 to ~8): company (EDGAR-linked), event, source, summary, Angle. Sonnet briefing now per-EVENT, not per-company.
- Collapsible portfolio table below: every company × 4 buckets, full evidence — the weekly "stay informed" layer.
- Agent trace: hidden/collapsed by default (RM doesn't need it), kept behind a toggle for demo value. (Considered deleting it — rejected: it's the "I can architect an agent" evidence for Gabe.)

**What we consciously gave up:** the algorithmic treasury-weighting (the old insider flex). It's not lost — it moves into the taxonomy (these triggers exist at all; most tools wouldn't look for treasury signals) and the Angle lines. The *decision* to remove it is itself the stronger story: "I first weighted treasury algorithmically, then realized ranking treasury-vs-refi urgency is the RM's judgment, not the tool's." Design maturity, not a walk-back.

**Build plan:** Session A = logic (bucket mapping + dedup + card-eligibility rules + remove old scoring + time-order), console-tested. Session B = new UI (flash cards + collapsible portfolio table + trace hidden). Dedup is the highest-risk piece — verify it collapses same-filing events without over- or under-merging.

---

## Sessions A–B — v2 build + fact-base rearchitecture (as shipped, commit f91349f)

**Built:** the v2 output layer per the eligibility spec, on top of a new fact-base architecture introduced to kill hallucination:

```
Haiku detects facts → deterministic code decides buckets/headlines → Sonnet narrates → number-guard audits output → scale normalization
```

**What this fixed:** hallucinated figures. Every number on every card now traces to a filing. Verified: demo-safety passed, scale normalization correct, type-check/lint/build clean. Declared scope freeze.

**Deployed:** pushed to Vercel, built clean from `main` at f91349f (31s build, status Ready). Deploy chain verified end to end for the first time with no failures — the framework-preset 404, the `master`/`main` split, and the read-only-filesystem cache bug are all retired.

---

## Session 10 — LIVE RUN FAILED. Post-mortem.

Ran the full 8-company book on the live URL. Output was the worst of any version to date. Deploy was NOT stale — `git status` clean, local HEAD = `origin/main` = Vercel's built commit. The deployed code is the latest code. This is a real regression.

### What the run produced (8 companies, 6 cards)

Checked every card against `coverage_signal_card_eligibility_spec.md`. **Roughly zero of the six cards should have been cards, and at least three table entries should have been.**

| Card | What it showed | Spec says |
|---|---|---|
| HCA | "During May 2026, we redeemed all $1.5B... notes due 2026" | Just-completed refi → **table**. Moment passed. |
| Tenet | Notes priced 2025-11-18 (9 months ago) | Past event → **table**. Its real card event (5.125% notes due Nov 2027, inside 18mo) was marked TABLE-ONLY. |
| Acadia | Notes issued 2025-03-10 (17 months ago), "matures ~Mar 2030" | Fails both halves of the card test. Sort keyed off a 43-month maturity. |
| Encompass | "annually expands capacity by building new hospitals" | Standing condition, not an event → **table**. Its real event ($500M notes, 2026-05-29) was in the table. |
| DaVita | Capex $271.84M up from $264.35M | Standing capex program → **table**. |
| Concentra | Raw scrape: ", 2025 ASSETS Current assets: Cash $158.04 million $79.9 million" | Cash card requires code-computed >30% QoQ. No computation ran. |

**Worst single miss:** UHS returned "No immediate action" while its own portfolio table held 1.650% notes maturing inside 12 months AND a live Talkspace acquisition with a $400M delayed-draw term loan attached. Two clean card triggers per spec, both suppressed to TABLE-ONLY.

**Suspected secondary cause:** 6 cards across 6 companies at exactly 1:1 suggests an implicit one-card-per-company selection, which would both force a card where nothing qualifies and suppress a second qualifying event on the same name. Spec allows 0–8 cards with no per-company cap. Verify in code.

### Other defects found in the same run

- **Third silent template fallback.** HCA and Concentra cards ran the deterministic template ("Maps to a refinancing conversation" / "Lead with X, referencing this filing detail directly", tagged SOURCE QUOTE) instead of Sonnet. Prior instances: `max_tokens: 400` truncation (session 8), deprecated `temperature` on Sonnet (session 6b). **Three occurrences is a design flaw, not bad luck** — silent degradation must become a loud dev-mode failure.
- **False date arithmetic passed the number-guard.** DaVita table: "4.625% Senior Notes due June 1, 2030 mature within ~18 months from June 30, 2026." That is 46 months — and DaVita's own summary line correctly says "refi window ~46mo." The number-guard audits figures against filings; it does not audit computed date claims.
- **Raw table scrape reached the UI** (Concentra "What" line) — number-guard passed it because the figures are real.

### ROOT CAUSE (the honest version)

The old pipeline had **Sonnet reading filings and deciding what mattered**. Its event judgment was good — that is why early runs had excellent card selection — but narration and fact-selection lived in the same generation step, so it invented numbers.

The fact-base rearchitecture split them, which killed hallucination. But it **transferred event judgment from the model to deterministic code without giving the code the fields needed to make that judgment.** Haiku's extraction schema emits `evidence` (a prose blob), `mappedNeed`, `needType`, `citations` — there is no `event_date` and no status marker. So the fact record reaching the gate says *"we redeemed $1.5B of notes due 2026"* as text, with nothing structured to distinguish completed from upcoming.

The gate then fell back on the only proxies it had — bucket membership, trigger id, filing date — none of which can separate a completed May-2026 redemption from an upcoming Nov-2027 maturity. Hence stale cards and suppressed live events.

**In one line: we amputated the event judgment along with the hallucination.**

### WHY IT WASN'T CAUGHT (process failure, own it)

Verification tested for the failure mode we had just fixed. Demo-safety asked *"do the numbers match the filings"* — they do, every figure on those cards is real and correctly scaled. **Nobody ever wrote an assertion about which events become cards**, because card selection had never been the broken thing before.

The eligibility layer — the newest code and the heart of v2 — shipped with zero semantic tests. Every hardening pass in sessions 6–9 strengthened the layers *around* the one layer that was never verified. The scope-freeze checklist should have included card-selection assertions and did not.

Generalized lesson, now a standing rule: **when a fix moves a responsibility from one component to another, test the responsibility, not just the fix.**

---

## Corrected architecture (v2.1) — what Session 11 builds

Does not undo the fact-base split. Completes it: the split was right, the inputs were missing.

```
Cached EDGAR corpus (2x10-Q, 10-K, 6x8-K)
  → Haiku extracts facts  [NEW: + event_date + event_status]
  → Fact guard: event_date must appear verbatim in source text, else reject
  → Card gate (DETERMINISTIC, no model): applies the eligibility spec as arithmetic
      ├→ Flash cards → Sonnet narrates card What/Why/Angle
      └→ Portfolio table → Sonnet writes per-company summary
  ↑ Golden tests assert the gate on cached facts, free, every change
```

**Division of labour, stated explicitly:**
- *Reading a filing* ("is this completed or upcoming, what date") = language understanding = **model's job**. This is the judgment being restored.
- *Applying the rules* ("is that date within 18 months, is 30% QoQ met") = arithmetic on known facts = **code's job**. Letting the model do this is how hallucination returns.

**Why Haiku is still the right model for the new step:** it is labeling what the sentence already states ("we redeemed" vs "mature within"), not inferring. Verifiable against source text. If a specific ambiguous pattern misfires repeatedly, upgrade *that step* to Sonnet per the build-map routing rule — not the whole loop.

### Rules the gate must enforce (full list, from the eligibility spec)

- Card = **dated or live AND actionable within ~12–18 months**. Both conditions, not either.
- **Refi:** maturity ≤18mo → card; >18mo → table; **just-completed refi/amendment → table**.
- **Treasury:** divestiture/acquisition closing → card; capital raise completed → card; cash → card **only if code computes >30% QoQ** from two 10-Qs; single 10-Q available → table.
- **New debt:** acquisition announced with financing undisclosed/bridge → card; capex program **newly announced** → card; **ongoing capex → table**; buyback → card only if **newly increased or announced**.
- **Hedging:** card only when attached to a new dated event; standing exposure → table, **and the table summary must explicitly flag the hedging opportunity**.
- All 15 triggers still run and map into the 4 buckets; `dataAvailable: false` preserved.
- **Dedup per event** — multiple triggers citing the same filing collapse to one card.
- **Sort by time-to-event only:** live/pending first, then nearest date. No cross-bucket weighting.
- **0 to ~8 cards. No per-company cap.**

### Portfolio table summary (added after the Session 10 review)

The shipped per-company summary line is deterministic template output — "new debt raised — standing; acquisition financing — standing; capex financing — this week; revolver upsize — standing" — which reads as run-on noise and was a named defect in the live review.

**Replaced with a Sonnet-written summary per company**, generated from the gated facts (not raw filing text), with the number-guard applied to its output. Constraints:
- Must state the hedging opportunity explicitly when standing FX or floating-rate exposure exists (spec requirement — it must not get lost in the table).
- Must not contradict the card gate: if no event carded for that company, the summary says there is nothing to act on this week rather than manufacturing urgency.
- Must not introduce any figure or date absent from the gated fact set.

Cost: ~8 additional Sonnet calls per full 8-company run. Sonnet now has two consumers (card narration + table summary); both fall under the loud-fallback rule from Session 12 — neither may degrade to template silently.

### Golden tests (the permanent tripwire)

Assertions locked to this exact broken run's cached facts. Run locally, zero API cost, on every change:

- UHS 1.650% notes due 2026 → **card**
- UHS Talkspace acquisition + delayed-draw TL → **card**
- Tenet 5.125% notes due Nov 2027 → **card**
- Encompass $500M notes 2026-05-29 → **card**
- HCA May-2026 redeemed notes → **table**
- Tenet Nov-2025 pricing → **table**
- Acadia Mar-2025 issuance → **table**
- Encompass + DaVita standing capex → **table**
- Concentra cash without computed >30% QoQ → **table**

Both historical failure modes now have permanent tripwires: **number-guard** catches invented facts, **golden tests** catch wrong selection.

### Session plan

- **Session 11 — eligibility gate rewrite + golden tests.** Add the two extraction fields; make the gate pure arithmetic; check for and remove any implicit one-card-per-company cap; write the golden set above. Console-verified, no UI work.
- **Session 12 — narration integrity.** Template fallback becomes a loud dev-mode failure (banner + logged stage), never silent, for BOTH Sonnet consumers. Route every card's What line through Sonnet with the number-guard after it. Build the per-company portfolio summary (constraints above). Add a deterministic reject for scrape-shaped text (many numerals, no verb) so raw table dumps cannot reach the screen.
- **Session 13 — live run, verify against golden expectations, cache the good run.**

**Residual risk, stated:** status classification remains a model call; Haiku will occasionally mislabel a genuinely ambiguous filing (an amendment that both completes something and creates something new). That is a per-case error the golden set accumulates coverage on, not a systemic collapse like this one.

---

## Session 11, Step 1 — Extraction audit (findings)

Ran Haiku extraction against cached/fetched filings for the companies in the ten test cases. No gate code exercised. Zero-cost local replay of `evaluateEligibility` against the captured evidence strings to verify hypotheses empirically rather than by inspection.

**Headline: extraction is sound.** All nine live cases carry enough in the `evidence` prose for a human to classify correctly. **The corpus stays at 9 filings per company** — the earlier question of whether 9 filings/72 total was causing hallucination or misfires is answered: no. The failures are 100% code-side.

### The two bug shapes

1. **Omission (the majority of false positives — #6 Tenet, #7 Acadia, #8 Encompass capex, #9 DaVita capex; #4 passes by luck).** The `new-debt-issuance` and `capex-program` trigger cases return an unconditional `{ cardEligible: true }`. No date check, no freshness check, evidence never consulted. Notably, the `isFreshEvent` / `STANDING_CONDITION_RE` / `MULTI_PERIOD_RE` machinery already exists and is wired for `dividend-buyback` and `floating-rate-debt` — it is simply never called for `capex-program`.

2. **Date misattribution (#1 UHS, #5 HCA).** Where timing logic does run, it scans for any future absolute date in the evidence blob with no way to know which date belongs to the fact.
   - **#1 UHS:** "due 2026" has no month, so the scanner cannot parse it and instead picks up a hospital *lease expiration* ("December 2026") — the only month+year date present. Right verdict, fabricated reason.
   - **#5 HCA — the confirmed live bug, traced exactly:** the code *does* set `alreadyPast = true` (the redeemed-keyword regex works) and cards anyway. `evaluateEligibility`'s debt-maturity branch only consults `alreadyPast` inside the `monthsToNearestFuture === null` arm. The redeemed notes' own former due date ("September 2026") is still future, so `monthsToNearestFuture` comes out ~1 month, the `alreadyPast` arm is never reached, and a settled redemption cards as "maturity ~1mo out." The retired-tranche exclusion regex does not save it either: in this phrasing "redeemed" *trails* "September 2026", and the ~40-char lookbehind is direction-sensitive.

### Three findings that changed the Step 2–5 spec

- **The gate must read `evidence`, never `verifiedQuote`.** `verifiedQuote` is a bare table fragment ("5.125 % due 2027 1,500 1,500" / "Additions of property and equipment ( 102,018 ) ( 143,258 )") in roughly eight places, wherever quote verification falls back to the table co-occurrence path. Evidence prose is unaffected.
- **Golden tests must key on company + trigger id, never on dollar figures.** DaVita's capex evidence cited different figures in the audit run than in the live run despite temperature 0 — Haiku's evidence *selection* varies run-to-run even when classification does not. Figure-keyed assertions would be brittle.
- **`completed` alone cannot separate card from table.** Encompass's May 2026 issuance uses the same word ("Completed issuance") as Tenet's Nov 2025 and Acadia's Mar 2025 issuances. A word-matching gate gets this wrong the moment phrasing shifts.

### DECISION — completed issuances card only on the proceeds test

**A completed debt or equity issuance cards only when proceeds are not fully applied to redeeming debt** — i.e. there is a balance that needs a home and the bank can compete for it. Recency also required: `PROCEEDS_RECENCY_DAYS = 90` (single tunable constant), since a raise from 17 months ago has deployed its cash.

New extraction field: `proceedsUse: "refinancing_only" | "partly_unapplied" | "unstated"`. `unstated` defaults to TABLE (conservative — otherwise everything cards) and is flagged in the portfolio summary.

**Consequence of the 90-day window, accepted knowingly:** no completed issuance in this book passes the test. Encompass (2026-05-29, inside the window) fails on `refinancing_only`; HCA $3.0B (8-K 2026-04-30, `partly_unapplied`) fails on recency at ~99 days; DaVita's June 2026 Term Loan B-2 fails on `unstated`. The two together prove both halves of the rule do independent work, and both are golden tests. Because no real fact exercises the positive branch, a **synthetic fixture case** (completed issuance, 30 days old, `partly_unapplied`) was added to guard that code path — an untested path is how this session's regression happened.

This reverses the pre-audit golden set, which had Encompass as a card. Rationale: consistent with the spec's existing "just-completed refi → table, the moment has passed" rule, and it keeps the treasury logic honest — the question is whether there are deposits to win, not whether something happened recently.

### Golden set now 16 assertions (was 14)

Added: HCA April 2026 issuance must CARD (positive case for the proceeds test); Encompass May 2026 issuance must TABLE (negative case); UHS #1's date must derive from the notes, not the hospital lease expiration.

---

## Session 11 — COMPLETE (local commit e3aabd5, not pushed)

Vercel deliberately left on f91349f until Session 13 verifies a live run.

### What was built

- **Extraction fields added** (`claude.ts`): `eventDate`, `eventDateGranularity` (year/month/day), `eventStatus` (upcoming / just_announced / completed / standing). Gate reads `evidence` prose only — never `verifiedQuote`, which is a bare table fragment in ~8 places.
- **`factGuard.ts` (new):** verifies `eventDate` against the cited filing text, anchored to fact-specific words rather than document-wide existence. Added after a live false positive — UHS's bare-year notes initially verified a fabricated `2026-12-31` because that string coincidentally appears elsewhere in the same 10-Q describing an unrelated payment schedule.
- **`eventTiming.ts` (new):** pure date arithmetic replacing the regex scan of evidence prose. Deleted `extractTimingInfo`.
- **`eligibility.ts` rewritten:** two universal hard rules run before any per-trigger logic (standing → TABLE always; completed → TABLE always, except new-debt-issuance which runs the proceeds test). **Every unconditional `return { cardEligible: true }` removed** — this was the largest single fix.
- **Per-company cap removed** (`buildEvents.ts`, `headlineCandidates[0]`) — now one card per dedup cluster.
- **`proceedsUse` moved to Sonnet** (`proceedsUse.ts`, one call per company, only when new-debt-issuance fired). Haiku was flipping the label run-to-run at temperature 0 on identical disclosures; a field that decides a card cannot be a coin flip. Routing rule from the build map applied: upgrade the step, not the loop.
- **`PENDING_LIVE_MAX_AGE_DAYS = 90`** — `isPendingLive` now requires `just_announced` AND an event date inside the window. Fixed centrally in `computeTiming`, not per-trigger, so future triggers inherit it.

### Bugs found only by building the fixture, not by review

- `computeTiming`'s past-date branch hardcoded `isPendingLive: false` regardless of status, silently dropping UHS's second card.
- The proceeds test had a **sign error** in its day arithmetic — its positive branch could never fire in real code, and test #8b was passing by coincidence (always defaulting to TABLE) rather than by correct logic.
- `just_announced` **never decayed**. DaVita's Feb 2026 agreement carded in August and would have carded indefinitely. Third instance of the unconditional-true shape.

### Bare-year maturity — spec gap, resolved

UHS's notes disclose only "due 2026" — no month or day anywhere in the 9-doc corpus. Verified directly against all fetched filings; a real disclosure-granularity gap, not a corpus-selection bug. Resolution: `dateGranularity` flag; `eventDate` never fabricated; a separate `windowDate` applies a Dec-31 convention **for arithmetic and sorting only, never display**. Dec 31 is conservative in the safe direction — if the latest possible date clears the window, the true date certainly does. The eligibility spec assumes dated maturities and does not address bare-year disclosure; noted as a spec gap.

### Golden suite: 24 assertions, 19 live / 5 synthetic-guard

Synthetic guards exist only where live data does not reach a branch: verified-recent acquisition (#2-guard), completed issuance 30d partly_unapplied (#4), redeemed-notes completed status (#5-guard), UHS ≥2 cards (#12), bare-year outside window (#17). **Standing rule going forward: the live-assertion count is the number that matters.** A suite drifting toward synthetic coverage is the exact pattern that let the Session 10 regression through.

### Final live card list (e3aabd5)

- UHS / debt-maturity — matures 2026
- Surgery Partners / asset-sale — pending/live, 18 days old *(intermittent — see below)*

DaVita's stale acquisition and UHS's undated Talkspace fact both correctly dropped out. Down from 4 cards; the reduction is the fix working.

### Open issues carried into Session 12

1. **Quote-verification non-determinism — now the top defect.** Surgery Partners' asset-sale ($795M consideration, closing pending, 18 days old — the strongest event in the book) cards only when its quote happens to verify that run. A demo whose headline card intermittently disappears is unusable. **This is fixed before narration work, not after.** Pre-existing, unrelated to the gate.
2. **`proceedsUse` schema gap (CON, SGRY).** Both facts are credit-agreement amendments — a revolver increase, an incremental term loan — not notes offerings. An amendment creating capacity has no proceeds to apply, so the three-way schema may not map onto that fact shape at all. Confirmed no currently-carding event depends on `proceedsUse`; instability affects table-only rows. Deferred, not fixed.
3. **Demo density.** One to two cards from eight companies is an honest reflection of a real week, but thin for a demo. Cards are per-event, not per-company, so widening the book to 15–20 names is the cheap lever — likely 4–6 cards with zero logic changes. Decide before Session 13's cached run.
4. **Acadia self-consistency slip:** `dateGranularity: "year"` paired with a full date (2025-12-31, the filing's real fiscal-year-end, not fabricated). Harmless — `completed` short-circuits before date math — but would matter on a trigger whose decision depends on `windowDate`.

---

## Session 12 — COMPLETE (local commits through the gate-contract fix; nothing pushed)

Vercel still on f91349f. Book size held at 8 companies. Gate, `eventTiming`, `factGuard`, extraction fields, taxonomy, corpus, and fetch layer all untouched — Session 11's logic is settled.

### Part A — quote-selection determinism

**Diagnosis was the valuable part, and it inverted the assumption.** Verification was never flaky; it was correct all three runs. It caught Haiku splicing two individually true sentences 1,169 characters apart into one fabricated contiguous span — the anti-hallucination guard doing exactly its job.

- Filing text ruled out (all 9 baseline hashes byte-identical across runs, all `fromCache: true`). Normalization ruled out. The variance was Haiku's quote *selection*.
- Fix was prompt-level, not a relaxed guard: quote defined as a **required field** — the single contiguous sentence stating the transaction's material figures — rather than a preference inside a general instruction. A preference lost to the model's default pull toward the opening sentence; a required field did not.
- Added `matchType: "literal" | "co-occurrence"` instrumentation, threaded through `TriggerResult`.
- A "verifies cleanly" pass is not the bar: run 3 originally verified a quote containing **no dollar figures at all**, which would have shipped an empty card looking like a success. Assertion `[19c]` now requires the quote to contain the deal figures.

### Parts B & C — portfolio summary + narration integrity

- `companySummary.ts` (deterministic bullet list) **deleted**, replaced by `sonnetPortfolioSummary.ts` — Sonnet-written, from gated facts only, with a five-constraint checker and one retry before loud failure.
- Silent template fallback eliminated for **both** Sonnet consumers. Failures render a visible banner; nothing degrades to template prose silently. This closes the pattern that appeared three times (max_tokens truncation, deprecated temperature, Session 10 template fallback).
- `scrapeGuard.ts` blocks scrape-shaped text from any display-bound string.

### THE LESSON OF THIS SESSION: checkers written as string matching

**Four guards in a row rejected correct output because they matched vocabulary or wording instead of claims.** Each was individually reasonable and each was wrong:

1. **`scrapeGuard` verb allowlist** — banner'd Surgery Partners' card, the strongest event in the book, because "values" and "providing" were not in `COMMON_VERBS`. A genuine, literal-matching, figure-bearing sentence rejected by a word list. Replaced with a structural test (sentence-terminal punctuation + numeral-to-word ratio), validated against real fixture quotes on both sides.
2. **`violatesDateGranularity` substring containment** — flagged Sonnet writing "months" where the fed phrase said "mo". Same duration, same meaning, called a fabrication. Replaced with semantic value comparison (`FactLine.monthsValue`, unit normalization).
3. **`violatesGateContract` urgent-phrase regex** — caused every retry across two runs and the session's only hard failure. It flagged the literal words "urgent" / "immediate" **inside negated claims**: "there is no urgent call to make" was rejected *for containing the word urgent*. Replaced with a claim-based check: a no-card summary must contain an explicit no-action statement and no non-negated directive tied to now/today/this week. Standing-opportunity language ("worth raising", "worth flagging") is explicitly allowed — blocking it put the gate contract and the hedging-flag requirement in direct conflict.
4. Follow-ons found while validating #3: the no-action regex required the word "actionable" and missed the system prompt's other fixed phrase; and "neither has triggered a call this week" failed because "neither" was absent from the negation list.

**Standing rule: a guard that scans vocabulary rather than claims will reject the sentences that say the opposite of what it fears.** Structural or semantic tests, never word lists.

### Figure-binding fixes (the last substantive defect class)

Figure-to-fact binding was positional ("first figure near the fact"), which broke three ways in real filings:

- **Scale loss — Encompass "$17.9" with no unit.** `extractMoneyUnitSuffixed` tolerated only 0–1 whitespace chars before the scale word; the filing contains `"$ 17.9  million"` with a double space (an EDGAR artifact), so a looser matcher grabbed the bare number — **off by 1,000,000×**. Widened to `\s{0,4}`; added `hasDeterminableScale()` as a binding-layer backstop and a book-wide assertion scanning every figure (32 checked, 0 failures).
- **from/to phrasing — HCA "$4.0 billion revolver upsize."** Took the pre-upsize cap from "increased from $4.0B to $8.0B", stating the opposite of what happened. `looksLikeChangeDescription()` now requires a from/prior/was signal before the first figure AND a to/current/now signal between the two — not a bare "to" check.
- **Adjacency mis-binding — DaVita "FX hedging, currently at $2.88 million."** An adjacent net-income figure presented as a hedging position: a real number attached to an unrelated claim, the exact failure mode this project started with. Figures must now be semantically related to the fact, not merely near it. DaVita's fx-exposure correctly binds **nothing** and Sonnet substitutes a genuinely-figured fact instead. Deliberately scoped to fx-exposure and commodity-exposure only — the two triggers with demonstrated risk — since guessing keywords for all 15 would reject currently-correct figures.

Typed money extraction (`MoneyUnitType`: currency / per-share / count) now drops wrong-typed figures rather than displaying them: Encompass's 50% ownership stake no longer reads as the asset sale's dollar value, its $0.19 per-share dividend no longer reads as a buyback authorization size, and UHS's bare table cells ("3,938", "164,501") are dropped. **"No figure disclosed" beats a wrong-typed number** — and it reads fine in the output.

### Test [12] — a broken test, not a broken product

The synthetic fact overrode `eventDate` and `quoteVerified` but kept the real trigger's `citations`, which cite the same 8-K as UHS's debt-maturity. `clusterIntoEvents` correctly merged them into one cluster, so the test failed for a reason unrelated to the per-company cap it exists to prove. **UHS genuinely has one merged event; dedup is correct.** Fixed by giving the synthetic fact a disjoint citation. No company in the current fixture naturally produces two clusters.

### Session 12 acceptance — met

- Portfolio summaries: **8/8 succeeded on both of two independent runs, zero retries.**
- Cards: 3 (UHS refi ~5mo, Tenet refi ~15mo, Surgery Partners treasury pending/live). Surgery Partners restored — it was being banner'd by the scrape-guard false positive, not by any real defect.
- Suites: 27/27 golden, 40/40 narration integrity, regression clean, lint clean.

### Open issues carried into Session 13

1. **Tenet's card intermittently banners** on the pre-existing word-ceiling guard in `sonnetEventBriefing.ts` (47/38/29 words against a 45 limit) — failed run 1, passed run 2. Same intermittency class as the SGRY bug just fixed, and it will surface in a live run. **Fix before or during the live run.**
2. **`proceedsUse` schema gap (CON, SGRY)** — credit-agreement amendments have no proceeds to apply; the three-way schema may not map onto that fact shape. Still deferred; no live card depends on it.
3. **Table co-occurrence fallback path** implicated twice now (bare fragments in Session 11, and it would have rescued the spliced quote in Session 12). Worth a look.
4. **Demo density.** Three cards from eight companies. Honest, but thin. Book stays at 8 by decision; revisit only if the live run yields fewer.
5. **Acadia self-consistency slip** — `dateGranularity: "year"` paired with a full date. Harmless today; would matter on a trigger whose decision depends on `windowDate`.

---

## Session 13 — SHIPPED, THEN FAILED LIVE. The v2 architecture is retired.

Pushed `a05be23` to `main`; Vercel Ready, verified three ways (GitHub deployment record, commit status, and pulling the live JS bundle to confirm it contained Session 12 strings absent from f91349f). The deployment was genuinely current.

**Then the live runs disagreed with each other.** Same commit, same book:
- 8-name run: 2 cards, both UHS. Tenet and Surgery Partners missing. Header read "7 companies assessed" for 8 inputs.
- 5-name run: 3 cards. Tenet now carded. Header correct.
- Local runs throughout Sessions 11–13: 3 cards, a different set again.

Not a deploy problem, not a timeout, not the read-only filesystem. **The output is non-deterministic run to run.**

### ROOT CAUSE — the one that was there the whole time

**We cache the document and throw away the answer.** Filings are cached to disk, but Haiku is re-asked on every single click and answers slightly differently each time — a different filing cited, a different sentence quoted, a different framing. Sonnet likewise re-writes the card text on every run.

Every instance we chased separately across three sessions was this same cause: the spliced quote (Session 12 Part A), citation drift forcing live assertions into synthetic guards (three times), HCA's framing variance, Encompass's `proceedsUse` flip-flop, the `2026-12-31` fabrication, Tenet appearing and vanishing. We fixed each instance and never named the mechanism.

### WHY THREE SESSIONS OF TESTING NEVER CAUGHT IT

**The golden tests run against a saved fixture — which is itself an answer cache.** Facts extracted once, saved to a file, asserted against forever. Deterministic by construction.

The deployed app has no fixture. It re-rolls the dice on every click.

**We tested a machine that had the cache and shipped one that did not.** 31/31 passing and a broken screen were both true simultaneously. And nobody ever ran the same book twice and diffed the output — consistency was the product requirement and the one thing never asserted.

**Third standing rule: test the machine you ship, not a fixture of it.**

### Secondary defects observed live (carried into v3)

- UHS's Aug 12 2026 issuance carded on two consecutive live runs despite proceeds funding Talkspace and paying down the revolver — `proceedsUse` is not binding on that fact.
- Card 1's Angle described UHS's $373M *drawn* revolver balance as though it were idle cash — a real figure attached to an inverted claim.
- DaVita's summary said "revolver draw at $1.44 billion" while its own table said "$65 million drawn, $1.435 billion available" — bound the available figure and called it the draw.
- Summaries read as one shape repeated eight times: a five-line paragraph reciting standing items and ending with a hedging sentence. HCA's opened "there is nothing actionable this week" and then ran 60 words. This is the Session 10 run-on complaint in prose form — the *spec* is wrong, not just the execution.

---

## v3 ARCHITECTURE — the answer-cache rebuild

Full spec in `coverage_signal_v3_architecture.md`. Summary:

**The insight:** a filing never changes, so the answer about it can never legitimately change. Stop trying to make the model deterministic — only ever ask it once per question.

**Three caches:**
| Cache | Key | TTL |
|---|---|---|
| Document | filing URL | **24h** — the filing *list* changes; a stale list hid Concentra's 98% QoQ cash build |
| **Answer (new)** | `company + filingId + triggerId + promptVersion` | **permanent** — content never changes |
| **Wording (new)** | `hash(gated fact)` | **permanent** — same event, same sentence |

`promptVersion` in the key is the escape hatch: a cached wrong answer is otherwise permanently wrong. Storage must be Vercel KV or Blob — serverless has no disk (the Session 1 bug).

**The gate is unchanged.** Sessions 11–13's work stands: bucketing by trigger id, one card test for all four buckets (dated AND live: ≤18mo maturity or <90 days announced), dedup per event, sort by time-to-event. Golden tests now assert against cached facts — the same thing the app reads, closing the fixture/live gap.

**Scope decision:** the demo must accept *any* 5 companies Gabe types. A precomputed frozen brief was proposed and rejected — it defeats the purpose. Consistency comes from the cache, structurally, not from pre-approval.

### OUTPUT FORMAT — decided this session

**Cards: action first, then the synthesis.**
- `CALL ABOUT:` the action in one imperative line — not a description of an event
- `WHY NOW:` two sentences max, must connect at least two facts (the event + what makes it live). If it can't, it isn't a card.
- `OPEN WITH:` one sentence the RM can actually say
- Every figure carries its unit; any figure without a determinable scale is dropped, never guessed

**Portfolio table: bullets with sources, no paragraphs.** Deterministic — **no Sonnet in the table at all.** One line per fact: fact + figure + timing + source link. All four buckets always shown including empties ("no signal found" is the honesty that proves the framework ran). Hedging flag as a marker, not a sentence. Deleting the summary generator also deletes the retry/constraint/banner machinery that caused most of Session 12's instability.

**Empty state:** "No actionable events this week — 4 buckets checked, 15 triggers run, 12 found no signal." Blank reads as broken; this reads as rigor. Matters most for low-debt names where refi and new-debt legitimately return nothing.

### Accepted limitations, going in with eyes open

1. A wrong cached answer is permanently wrong (mitigated by `promptVersion`).
2. Cold companies take ~60–90s. Pre-warming ~40 large names before a demo makes most typed names instant — same code, reading done early, not faked.
3. Consistency ≠ quality. A bad card becomes consistently bad; the human review pass still matters.
4. Thin coverage on no-debt companies (mature tech) — the empty state is the mitigation.
5. Name resolution unsolved — an ambiguous name could resolve to the wrong company.
6. Cost grows with the library; worth a cap.

### Sessions

Superseded. Current session plan lives in coverage_signal_BRD.md § 13.0.
## Pre-Session-17 review and the v1.1 architecture decision




---

### What this entry covers

A review of the Session 17 prompt before executing it, which turned into an architecture decision. Session 17 got rescoped down, and a new Session 18 was defined. No code changed in this session.

---

### The Session 17 prompt review

Seven problems found in the prompt itself, before any of it was executed.

**1. The promptVersion collision.** Session 14 built `promptVersion.ts` as one constant folded into every answer and wording key. Session 17 changes the narration prompt (KEY POINTS, language items), which requires bumping that constant, which also invalidates the answer cache and forces full re-extraction. Worse, the session's only safety mechanism is the baseline diff, and a re-extraction re-rolls extraction once, so table lines no fix touched would shift and "account for every changed line" produces noise.

**Decision: split the constant.** `extractionPromptVersion` keys the answer cache. `wordingPromptVersion` keys the wording cache. A narration change re-narrates from byte-identical cached facts. Ships first in Session 17.

**2. Item 18 contradicted itself and the scope line.** It claimed extraction drops the "Senior secured first lien notes:" header, then claimed the table already carries it. The live screenshot settled it: the Tenet table line reads "Senior secured first lien notes of $1.5 billion due November 2027," so seniority is in the saved fact. Item dropped from Session 17. It arrives free in Session 18 as a row field.

**3. Item 2 treats a recall failure as a rendering problem.** HCA and Cigna render Refi as `no signal found` while both hold real maturities. Restoring the line with a qualifier makes the display honest and does nothing about tranches extraction never saw. Also: a maturity extraction never mentioned at all gets no line and no qualifier. Invisible stays invisible.

**4. Item 10 repeats item 2's mistake.** Suppressing routine capex asserts the company spends nothing on facilities. Relabel, never delete.

**5. Item 4 was not assertable as written.** "Cites every filing its narration draws on" cannot be tested. Restated as: every date and figure in card text must appear in at least one cited filing, and the card's citation set is the union across every fact in its cluster.

**6. Item 1 needed a diagnosis first.** If the dev markers are renderer literals, strip and assert. If they were persisted into cached wording, a render-time strip leaves the store dirty.

**7. Housekeeping.** The prompt said 17 items while the list numbered to 18, with 17 out of sequence. And the determinism check needs one warm-up run first, because the wording cache never caches a failure, so run 1 after any wording change can legitimately differ from runs 2 and 3.

---

### The three weaknesses that came out of the audit

**1. No component holds current state.** Every answer is "what does this filing say." Nothing holds "what is HCA's debt right now." This is the parent of the retirement problem, the bare-year problem, and the refi/new-debt duplication. They are one missing layer, not three bugs.

**2. Recall is unproven.** Every guard checks that what appeared is true. Nothing checks that what is true appeared. HCA and Cigna are the live counterexamples.

**3. The demo has no visible differentiation.** Determinism, guards, and caching are all invisible. What shows on screen is a call sheet, and the first reaction to a call sheet is that a good prompt gets most of the way there. Deferred to Session 19: a verification strip, a run-again button, and the completeness claim from the checksum.

---

### The insight

Debt is enumerable and self-checking. The filing lists every tranche and then states the total on the same page. So there is an answer key printed next to the question.

Stop asking an open question ("find the debt signals") that has no right answer. Ask a closed one ("copy the table") and check the sum. Recall becomes arithmetic instead of a spot-check.

The one-answer-per-trigger schema is why HCA showed only the tranches attached to a newly issued bond. Ten tranches, one slot. No prompt wording lifts that.

---

### Architecture decisions (BRD v1.1)

1. **`debt-maturity` returns `debtSchedule` rows**, plus `reconcilingLines` and `statedTotal`. Transcription, not selection. `seniority` from the debt note's own section header.
2. **`new-debt-issuance` gains `redeems`** — the notes named as retired, copied verbatim, never inferred.
3. **New `position.ts` between extraction and the gate.** Newest schedule as the base ladder, later 8-Ks applied on top, newest filing wins per tranche, each row marked `live` / `retired` / `unconfirmed`. Pure code, no model calls, reads cached answers only.
4. **Checksum guard.** Rows plus reconciling lines tie to the stated total. Ties means nothing missed. Does not tie renders `does not tie — $X unaccounted`, never suppression.
5. **`cashAmount` and `projectName` replace topic-matching.** `cashAmount: null` never cards. Amount plus a named project is a project; amount with no name is period spend. Direction is not extracted, since the trigger's bucket already carries it and a second source of truth can disagree with the first.
6. **Staleness by display, not suppression.** Completed events over 12 months sort to the bottom of their bucket and render their age.

**Deleted by these changes:** the condenser's tranche-clause picker, the "+N more tranches to YYYY" suffix, and the same-citation refi/new-debt dedup. Three approximations out, one deterministic module in. Net less code.

---

### What the checksum proves

Completeness, and only completeness. A row copied with the right amount and the wrong maturity year still sums correctly, so field accuracy stays the fact guard's job. Two guards, two jobs, neither covering the other.

Scope is debt only. Cash and 8-K events have no published total, so there is no equivalent proof. Events get a coverage count instead (filings read = filings answered), which is weaker and gets stated as weaker.

---

### Session split

**Session 17, rescoped to 10 items.** Renderer, language, card format, and the promptVersion split. Items that survive the rebuild.

**Session 18.** Refi rebuild plus the bucketing fix. Seven Session 17 items are dissolved rather than patched: item 2 (A1 over-suppression), 6 through 9 (wrong-bucket triggers), 10 (routine capex), 15 (tranche-count phrasing). Patching them first would be thrown away.

All ten names re-extracted, so one shape everywhere and no mixed old and new. Higher cost and a longer cold session, accepted.

---

### Baseline diff protocol, modified for Session 18

The per-line protocol from Session 16 works when fixes are small. Session 18 changes the extraction shape, so every refi line across ten companies changes on purpose and per-line accounting becomes noise.

**Category accounting instead.** Every changed line must belong to one of: refi rebuild, bucketing fix, or Session 17 carryover. A line that fits none of the three stops the session. A Treasury line changing in a session that touched no Treasury logic is a stop. A refi line changing is expected and needs no individual explanation.

---

### Rule 4 — fix the shape, not the symptom

The guard stack grew to police a bad data model. Blob evidence sentences forced a condenser, which forced a scrape guard, splice detection, and figure-type binding. Structured rows delete most of that machinery.

The test for any future addition: does it make a claim checkable, or does it patch a symptom? Checkable stays. Patch means the shape underneath is wrong.

---

### Session 18 closing notes

**The category diff could not be run, and was not faked.** The protocol above
requires a baseline of Session 17's live per-line output. That output does not
exist — what survives is `session17-report.html`, a narrative write-up with no
line-level capture. A baseline reconstructed after the fact would defeat the
protocol's only purpose: an uncategorisable line is supposed to STOP the
session, and a baseline rebuilt from the current code can never produce one.
Reporting the gap is the honest outcome; a green diff against a synthesised
baseline would have been worse than no diff at all.

**Standing change, from here on: capture line-level output every session.**
Every session must persist its own rendered per-line output (both books, every
bucket line and ladder row) as a file, not only a narrative report. The
narrative is for humans; the line capture is what makes the next session's diff
possible. A session that ships without one removes the next session's ability
to run this protocol.

**A determinism check must never hash its own instrumentation.** Session 18's
harness hashed each company's payload INCLUDING `spendUsd`, read from the cost
meter. Quest's card fails narration and retries, so its Sonnet token count —
and therefore its cost — differs on every run. Book B duly "failed"
determinism on all three passes while its actual output was byte-identical.
Cost, latency, timestamps and token counts are measurements OF a run, never
part of it. Hash the product; report the instrumentation separately.

**Logged, not fixed — UHS capex misclassified as `standing`.** UHS's
capex-program trigger returns `eventStatus: "standing"` for a disclosure that
names a specific building (Miller Medical Plaza, 80,000 rentable square feet)
with a specific completion date (December 2026) — which is a dated project, not
a standing condition. Consequence: the standing gate sits ABOVE D2 in
`evaluateEligibility`, so the Session 18 D2 exemption for named capex projects
is never reached for UHS, and reverse assertion R1 still does not card. The
exemption itself is correct and tested; the misclassification is upstream, at
the extraction layer. Decision deferred pending review — overriding the
standing gate is a materially larger change than the D2 exemption and would let
genuinely standing capex programmes card.

---

## Session 18, stage 2 — the review pass

Stage 1 diagnosed, stages 2 onward fixed. Six commits, none merged. Extraction
was never re-run: `EXTRACTION_PROMPT_VERSION` stayed at 16 throughout and every
measurement below was taken free against that cache. The only money spent was
four Sonnet narration calls at the very end.

## What stage 1 established, and what it corrected

Four diagnoses, all free. Three of them corrected a premise rather than
confirming one, which is the point of diagnosing before fixing.

**The drop rate was not what it looked like.** 33 drops across 269 entries, not
the 65 a first parse suggested — 32 were UHS log lines from ABANDONED locator
retries that never reached the final result. Of the 33 real ones, **18 were
prior-period entries that no check reads**. Only 14 touched a current ladder,
on three companies. "Is the book one bug from reconciling or five" resolved to:
one, and it was CHS.

**Molina's green badge was right and the drop count beside it was measuring
something else.** Its base ladder was complete to the dollar — five rows, one
adjustment, one subtotal, walk gap $0, the balance sheet's single caption
matching the subtotal exactly. All seven of its "drops" were the prior
filing's comparative column, correctly rejected by column binding. Nothing
reconciled loosely; `rowsDropped` simply summed four arrays and sat next to a
badge that only describes one of them.

**Month recovery had nothing to recover.** 28 year-only rows book-wide; zero
carry a month in their own sourceLine; 27 of 28 have no month printed anywhere
in the company's corpus. The filings write "due 2030" and stop.

## The fourth fabrication event, and its mechanism

Three fabricated rows were on CHS's rendered ladder and had cleared
verification. The cause was the same one as the previous three — the model was
handed the wrong text — and this time the chain was fully traceable:

`COUPON_NEAR_YEAR_RE` required a decimal point. CHS prints 4¾%, 6⅞%, 10⅞%. The
detector was blind to the table, density clustered on the redemption narrative
(which does spell coupons as decimals), and the returned span was
[49,227–51,119] against a table starting at 48,497. **The model was never shown
the table it was asked to transcribe.**

Verification did not contain it either. "Proceeds from ABL Facility 708" is a
real line of CHS's filing — from the CASH FLOW STATEMENT — and it verified
LITERALLY, putting a $708M ABL balance on a ladder whose note reports that
facility at zero. Two more rows passed on co-occurrence over rate+year alone,
because `extractFactTokens` does not read a trailing bare table figure as
money, so the amount was never checked by that pass at all.

## Rule 5 — a guard's reach must be bounded by the thing it is guarding

Every
verification hole this session had the same shape: a check that searched a
whole document for evidence about one row. "Does 350 appear in this filing" is
not a question about a row; in 183,000 characters it is not a question at all.
Corroboration is now bounded twice — to the row's own matched position, and to
the located note — and the note bound is what separates a real cash-flow line
from a schedule row 37,000 characters away.

The corollary, learned by breaking it: a bound is only as good as the position
it is measured from. First-occurrence indexOf resolved correctly-transcribed
rows to a caption's OTHER appearance on the balance sheet, and the new bound
then rejected them — one real subtotal each on Centene, Encompass and Molina,
and UHS's walk pushed from a clean tie to a 24% miss, firing the new A3
suppression on a ladder that was never wrong. `scheduleCompleteness.ts` had
already hit this exact bug and solved it; the fix was to apply its remedy here.

## Rule 6 — a field the model is shown must be a field the guards can see

*From the narration bump — the `factOwnText` lesson.*

**Adding one without the other is not a partial fix; it is a regression.**

E4 gave narration the tranche's OUTSTANDING balance as its own labelled prompt
field — the number a refi conversation is actually about, because an indenture
names a tranche by its ORIGINAL ISSUE SIZE and the two diverge the moment any
of it is repurchased. Cigna's 4.500% due 2030 is named "$1,000 million" and
carries $993M; Centene's 4.25% due 2027 is named "$2,500 million" and carries
$1.1B. Narration had been reading the name.

`factOwnText` in `numberGuard.ts` builds the corpus every card bullet is
checked against: `normalizedText`, `verifiedText`, `evidence`, `seniority`,
`redeemsInfo`. The new fields were added to the PROMPT and not to that list.
The model dutifully wrote "$1.5 billion outstanding", no single fact appeared
to contain that figure — the raw sourceLine holds "1,481", not the display
form — and **three of four cards came back blank**, rejected for a bullet "not
fully explained by any single fact".

Three blank cards, caused by two halves of one system disagreeing about what a
fact contains. `formatFact` and `factOwnText` are two views of the same
question — what does this fact say — and they must be changed together. The
doc comment now says so at the site.

It cost real money to learn: quoted $0.07 expected / $0.15 worst case, spent
**$0.65 across five runs**, because a failed briefing is deliberately never
cached and every diagnose-and-repair cycle re-billed the failures. The final
run alone was $0.0941 across 4 calls, inside the estimate. The overrun is the
price of a defect that could only surface in live output.

Two smaller ones from the same run, both worth keeping:

- **"may" is a month.** A case-insensitive modal test rejected Quest's card
  twice for writing "due May 2027". Bare may/might are the weakest modals in
  the set and were dropped; the pinned regression test is the date, not the
  modal. A guard on the grammar of advice must not fire on the calendar.
- **The fix for a max_tokens stop is the budget, never the guard that
  noticed.** 400 output tokens was sized before E4 and E5 added content the
  card is REQUIRED to state. Tenet's body came back well-formed and truncated
  mid-structure at exactly 400; the code correctly reported a malformed body
  rather than accepting half a card. Raised to 700.

## Two rules that changed a verdict

**Check 2 must match category, not proximity.** Cigna's balance sheet carries
Short-term debt $592M and Long-term debt $30,871M; its note is sectioned,
closes each section with its own subtotal, and prints no combined rollup. The
nearest single subtotal was long-term, so the anchor missed by exactly $592M —
not a gap but the entire short-term category. Both walks tied throughout and
Cigna still read FAIL. Where a note prints section-scoped subtotals, their sum
IS the combined total the filing never wrote down. Cigna: FAIL to PASS.

**"Wrong column" is not "no schedule".** UHS's two 10-Qs both carry a located,
transcribed note whose every row was discarded for stating the December
comparative column. The search-order fallback saw zero survivors, could not
tell a misread from an absent note, and walked back to a February 10-K —
rendering an eight-month-old ladder as the current position beside an August
8-K. All-rows-discarded-for-period is now a read failure that reports itself
and does NOT trigger the fallback. UHS renders "NOTE FOUND BUT READ WRONG"
instead of a stale but tidy answer. The underlying misread is extraction-layer
and clears at the next bump.

## Standing note — B is shipped and inert

`corpusFingerprint` hashes the filing catalog, not the extraction text, so the
locator rewrite changes what the model WOULD be shown without invalidating a
single cached answer. Nothing re-extracts by accident, and nothing improves
until a deliberate bump. CHS therefore still renders 2 rows of a 12-row note;
the A3 statement says so on screen in the meantime. The gap between "fixed" and
"in effect" is a version bump, and it should be stated whenever a locator
change is reported as done.

## What was diagnosed and deliberately not fixed

- **Acquisition consideration under New debt**, and **the hedging bucket's
  membership** — both taxonomy-level. The taxonomy was not edited. Molina's
  pharmacy-cost line comes from `commodity-exposure`, which the taxonomy itself
  defines as "commodity / input-cost", so it is correctly bucketed by its own
  definition; UHS's international-expansion to hedging is the weaker mapping.
- **HCA's aggregate double-count.** Its category rollup cannot be matched
  against the three tranches its April 8-K prices, so all four render. Nothing
  is summed for display, so no arithmetic is corrupted.
- ~~**Centene's card.** It stated "$1.1 billion", a figure in none of its facts,
  on both attempts. The number guard rejected it; the card renders its own
  failure rather than a fabricated figure. That is the guard working and it was
  left alone.~~

  **CORRECTED (stage-2 review, item 1). The claim above is wrong in both
  halves and is struck rather than deleted, because a build log that quietly
  edits away a wrong diagnosis is worth less than one that shows it.**

  The figure was never absent and was never fabricated. Centene's own debt
  note prints `$ 1,067` for that tranche, and it is in the fact's
  `verifiedText` and `evidence` verbatim. `$1.1 billion` is THIS TOOL'S OWN
  display rounding of it, produced by `formatMoneyForDisplay` and handed to
  narration as E4's `outstandingAmount` field specifically so the card would
  state it.

  What actually happened is Rule 6 again, in a third place. `checkCardStructure`
  built its accuracy corpus from a hand-maintained field list —
  `normalizedText`, `verifiedText`, `evidence`, `seniority`, `redeemsInfo` —
  which is a THIRD view of "what a fact says" alongside `factOwnText` and
  `formatFact`, and it never gained E4's two fields. So the corpus contained
  `1,067` and not `$1.1B`, and the guard's own tolerance cannot bridge its own
  formatter: `moneyValuesMatch` allows 2%, and $1.1B against $1,067M is 3.1%.
  Verified by reconstructing both corpora against the real cached facts —
  v8's corpus rejects `$1.1 billion`, `factOwnText` accepts it, same bullet,
  same facts.

  So the card was rejected for stating exactly what E4 exists to make it
  state, and the entry above recorded that as a fabrication catch. It is the
  same failure that blanked three cards during Group E, found then in the
  narration direction and missed here in the audit direction, because the two
  halves were still two lists.

  Nothing about the figure changed. One line changed: the corpus is now
  `factBase.map(factOwnText)`.

---

## Standing cost lever — `proceedsUse`, before any pre-warm

**`proceedsUse` is 59% of a full-book extraction bill, and it buys a
three-way enum.**

Measured against the real corpora, a v17 full-book bump prices at roughly
$1.65. The breakdown is not where anyone would guess:

| item | tokens | rate | cost |
|---|---|---|---|
| Haiku classification, input (corpus 422k + scaffolding) | ~502,000 | $1/Mtok | $0.50 |
| Haiku classification, output | ~35,000 | $5/Mtok | $0.18 |
| **`proceedsUse`, 8 Sonnet calls** | **326,208** | $3/Mtok | **$0.98** |
| dig follow-ups (0 used) | — | — | $0 |

`classifyProceedsUse` ships the FULL text of every filing citing the
issuance PLUS the newest 10-Q — not the excerpted extraction text, the whole
documents — to Sonnet, to answer `refinancing_only | partly_unapplied |
unstated` with `max_tokens: 200`. UHS alone sends 86,210 tokens. The design
is deliberate and its doc comment explains why (the use-of-proceeds sentence
is frequently outside whatever excerpt Haiku selected), so the fix is not to
narrow it back to an excerpt — that is the bug it was built to fix.

NOT FIXING NOW. But it is the first thing to look at before any pre-warm of
40 names: at this shape a 40-name pre-warm is roughly $6.60, of which ~$3.90
is this one call. Options worth measuring when it comes up, cheapest first:
scope the payload to the filing sections that can contain use-of-proceeds
language rather than whole documents; move it to Haiku and measure whether
the classification degrades; or fold it into the main classification call,
which already reads the same corpus, and delete the separate call entirely.
It is also the only Sonnet call in the extraction path, so it is the only
place where the 3x price applies at corpus scale.

## A cached replay is free only inside a TTL window

Reported twice in one session as "zero API cost, replayed from cache" —
wrong both times. Tenet re-extracted live during the stage-1 diagnostic, and
CHS during an uninstrumented measurement script. Neither surfaced until a
blob listing showed an answer written minutes earlier.

Not a bug: `corpusFingerprint` hashes the company's FULL filing catalog and
the filing-list cache has a 24-hour TTL. When the TTL lapses and EDGAR
returns a catalog differing by one filing — a new 8-K anywhere in CHS's
293-filing history — the fingerprint changes, every cached answer for that
company becomes unreachable, and the next run silently re-extracts it.

Two consequences worth carrying forward. First, **"I replayed from cache" is
a claim about a moment, not a property of the code**, and it must be checked
rather than asserted: `npm run preflight` now HEADs each company's exact
answer key and reports which would re-bill, with zero model calls by
construction. Run it before describing a run as free. Second, **any
measurement script that calls `runAgentLoop` must scope a cost meter around
it** — the ones that missed this instrumented only the narration calls, so an
extraction inside the same script was invisible to their own totals.

## The CHS bump happened by accident, and it worked

CHS was authorised for a scoped single-company re-extraction (~$0.17,
against a full-book v17 that would have re-billed seven companies to re-ask
an identical question). It turned out already done: the catalog change above
had forced CHS's re-extraction during one of the measurement runs, under the
new heading-first locator.

The result is what the locator fix was built to produce. CHS went **FAIL to
PASS**: both checks tie, 15 of 16 base entries verified against 6 of 15, and
the ladder is 11 real tranches whose every figure matches the 10-Q's own
June 30 2026 column — 42 / 644 / 1,535 / 689 / 1,549 / 700 / 1,790 / 1,244 /
1,227 / 298 / 52, against ground truth read by hand in stage 1. All three
fabricated rows are gone: the $708M ABL (a cash-flow line), and the $350M and
$400M Junior-Priority notes that had passed on caption co-occurrence alone.

This is the first end-to-end confirmation that the stage-1 diagnosis was
right about the mechanism — the model had never been shown the table — rather
than merely consistent with it.

**Small artifact, logged not fixed.** CHS's ladder now carries two
`unconfirmed` rows ("Finance lease and financing obligations" 299, "Other"
42) that are the SAME instruments as two live rows, from the prior filing.
`rowsRepresentSameTranche` matches on maturity and rate, and these rows have
neither, so the match cannot be made and the unconfirmed pass reports them as
tranches that vanished. Harmless today — they render as unconfirmed, which is
honest about the uncertainty — but the rule is over-firing on undated rows
and a future company with several of them would look worse than it is.
The shape of the session

Stage 1 diagnosed without touching code. Stage 2 fixed in five groups, A through E, then a narration bump. Then a full RM read of both books produced a further list, and verifying that list found two defects larger than anything on it.

The recurring theme: a fix verified on the surface it targeted, and nowhere else. The money formatter reached ladder rows but not bucket lines or movement deltas. The aggregate-disclosure label reached the header but not the rows beneath it. The multi-period collapse reached some triggers but not capex. Each looked complete when reported.

Stage 1 — three diagnoses that corrected a premise rather than confirming one

The drop count was 33, not 65. Thirty-two of the first parse were log lines from abandoned locator retries that never reached a result.

Only 14 of 33 drops touch a current ladder. Eighteen are prior-period entries that neither check reads. So a company reported as "44% incomplete" was complete: its badge summed four arrays, and a discarded prior-period comparison read as a hole in the live ladder. The premise behind that item was mine, and it was wrong.

Month recovery had nothing to recover. Twenty-seven of twenty-eight year-only rows have no month printed anywhere in their company's corpus — but that measurement searched only each row's own quoted line. A hand-read of one filing later found the month stated in prose four hundred characters below the table: "dates are staggered from November 2027 through November 2033." The earlier conclusion, that a previous session's card had invented a month, was therefore wrong twice over: the month exists, and the old pipeline was reading it.

The fabrication, root-caused for the fourth time

Three fabricated rows were on a rendered ladder — an ABL balance of $708M that is actually zero (708 is a cash-flow line), and two junior-priority notes at $350M and $400M against real balances of $1,244M and $1,227M.

The chain, established by measurement:

The locator's coupon pattern requires a decimal point. A filing printing 6⅞%, 5¼%, 4¾%, 10⅞% is invisible to it.
Density clusters therefore formed around the redemption narrative below the table, which does use decimals.
The real table, forty-eight thousand characters in, was never spliced. The locator reported "found" with confidence throughout.
The model built a schedule from instrument names in prose plus figures it invented.

Same pattern as the previous three: wrong text in, invented rows out.

Verification did not contain it. Rows survived because co-occurrence matched a real instrument caption while the amount scan found 350, 400 and 708 somewhere across 183,000 characters. One check caught the result ($6.07B gap); the other tied, because captions and subtotals were both right while every row between them was wrong.

Group A — bounding verification to the thing it verifies

Amounts must now appear within the located note span and within a bounded distance of the instrument text they are claimed for. Co-occurrence requires identity and amount in the same region. A ladder failing its walk by more than a threshold renders the failure rather than presenting its rows as verified.

Two defects in the first cut, both caught by measurement before reporting:

First-occurrence resolution. A figure printed both in the note and on the balance sheet resolved to the wrong one, and correctly-transcribed rows were rejected as "outside the note" — costing three companies a real subtotal each and firing the new suppression on a ladder that was never wrong.
Proximity applied to 8-Ks. A pricing 8-K states each tranche's principal a paragraph above the sentence the model quoted; proximity alone dropped three real tranches. A single-event filing under the lead cap is its own bound.
Group B — the heading finds the note

All ten base filings now select via a real debt-note heading; 123 of 128 verified entries fall inside the located span, and the five outside are balance-sheet captions, which sit outside every note by definition.

Three heading false-positive classes were found by measurement and rejected structurally, never by word list:

Zero-padded cash-flow figures (02 ) Proceeds from debt) — a note number is never zero-padded.
MD&A prose (26. We have significant debt) — a note's table begins within about 1,200 characters of its heading.
Subtotal captions nested inside a note's own table (30 ) Total long-term debt) — a heading precedes its table, so a match inside an earlier heading's block is a caption.

A note continuing past a prose break now extends its host block instead of competing with it. Pins are emitted by the assertion rather than hand-written, so a pin cannot encode a wish, and they record whether selection was by heading or density so a silent fallback fails loudly.

A win that was not a win: one company's span moved 9,155 characters, and its model input was byte-identical. Its debt note sits inside the 40,000-character lead window that reaches the model regardless of the locator. That company's correctness never came from the locator at all.

Groups C–E, and one card returned
An em-dash amount is a stated zero, not an indeterminate scale — and the dash also breaks literal verification when the model omits the cell while transcribing a two-column row. Both faces, one rule. A repaid tranche now renders as repaid rather than dropped.
A located-but-misread note is a read failure that says so, and does not trigger the search-order fallback. One company went from a clean-looking eight-month-old ladder to no base ladder and an instruction to read the filing. Uncomfortable and correct.
A bare year cards when the whole year falls inside the window. The December-31 convention was always safe for excluding; the same arithmetic includes when January 1 and December 31 are both inside. Exactly one card book-wide, which is the right answer rather than a disappointing one.
Dedup: where an 8-K tranche and a note row are the same tranche, the note's row wins and carries the outstanding amount. Ten duplicate rows removed across five companies.
The balance-sheet anchor matches category rather than proximity. One company's sectioned note prints no combined rollup, so its section subtotals now sum to a total the filing never writes down — turning a fail into a pass on a $592M gap that was the entire short-term category.
Per-tranche identity is rate and own maturity. A bare-rate test would have relabelled the one genuinely aggregate filer as a real ladder.
The narration bump, and the guard corpus lesson

Three of four cards came back blank on the first attempt. The cause: two fields were added to the narration prompt and not to the corpus every bullet is checked against. The model stated the figure it was told to state; no single fact appeared to contain it, because the raw quoted line holds an unformatted number rather than the display form.

Two smaller ones, both mine: a modal test rejected "due May 2027" because may is also a month, and a token budget sized before the new content truncated a well-formed card mid-structure. The fix for a truncation stop is the budget, never the guard that noticed.

Cost ran $0.65 against a $0.07–0.15 quote. Four of five runs were repair cycles, and a failed briefing is deliberately never cached, so each failure re-billed.

One card remains withheld: it stated a figure appearing in none of its verified facts, twice, and the number guard rejected it rather than let a fabricated figure onto a card. Left alone. That is the guard working.

The review pass, and the artifact problem

The stage 2 review artifact was hand-written to show the run, and the boundary between rendered output and annotation was never marked. Several review items were therefore defects in the exposition rather than the product.

Grepped in three tiers: rule identifiers, re-extraction notes and a per-card cost figure exist only in that document; the extraction report is real product but sits inside a collapsed reasoning drawer; and five strings on the primary surface are deliberate financial vocabulary. Future review artifacts carry an explicit banner separating the two.

A guard reported as passing while its defect is on screen. The card-citation check was called only from its own test file — "zero gaps across the book" meant it never ran on a card. Even wired it could not have caught the case, because it filtered candidates to the card's own trigger and compared a date field that was null.

The real defect was on the table, where a paraphrase moved a date three months forward. The quote goes through verification; the paraphrase never did, and the paraphrase is what renders.

The two findings that outrank the review list

A partial call read as full, and the most callable thing on a company disappeared. An 8-K redeeming "4.500% senior notes due 2028" states no quantity and no partial wording; the note still reports that tranche at $396.9M, down from $792.0M. It was marked retired, and retired rows neither render nor card.

Rule: the note is the position. An 8-K wins only when it post-dates the note's period of report.

Six of nine rows on one company were three instruments counted twice. A revolver, other notes and finance leases carry no rate and no maturity, so they can never satisfy an identity match — they were declared vanished on every run and re-added as unconfirmed beside the identical live rows.

Rule: absence of a match is only evidence of absence when a match was possible.

Two judgment calls worth recording

A measure label was built and thrown away. The outstanding column is not one measure: one company's rows are par (a stated $118M par repurchase matches the delta exactly), another's are carrying value (a $700K move on an untouched fixed-rate note, with the next table printing "Face Amount" and "Net Amount" as separate columns). A structural classifier misread a third company, and a label wrong on a tenth of the book is worse on screen than no label.

What is decidable is the movement: accretion measured 0.076% to 0.2%, principal changes 6.1% to 10.0% — a thirty-fold gap with nothing in between. Sub-threshold moves now render with their size and state that they cannot be read as a repayment.

A bound chosen by measurement rather than argument. Two candidate date bounds were measured against the live book: filing date gave two true positives and one over-fire; period of report gave two true positives and four over-fires, flagging every legitimate subsequent event. The filing-date bound shipped, and its single over-fire is documented in code rather than tuned away.

Standing costs and constraints, measured

A full-book cold pass costs about $1.65 to $2.20. Fifty-nine percent of that is one three-way classification call that ships each company's full cited filings to answer a question with a 200-token budget. That is the standing cost lever, independent of any version change.

The answer cache keys on the filing catalog rather than the extraction text, so a locator improvement is inert until a version bump. Cache keys are per company, so a single company can be re-extracted for about $0.17.

Rules earned this session

These were drafted with their own numbering and DID collide, exactly as the
note here anticipated. Reconciled against the log's canonical `## Rule N`
headings: the first two were already logged under their own headings, and
the second two had no canonical heading until now.

- Drafted 8 (a guard's reach, and the first-occurrence corollary) → **Rule 5**.
- Drafted 9 (a field shown is a field the guards can see) → **Rule 6**.
- Drafted 10 (absence of a match) → **Rule 10**, promoted to its own heading below.
- Drafted 11 (a label wrong on part of the book) → **Rule 11**, likewise.

7, 8 and 9 belong to the render fixes from the same review. Session 19
continues from Rule 12.

---

## Rules 7, 8 and 9, from the stage-2 review's render fixes

Three defects were found on three specific lines. A fix that is correct on
the line it was found on while the rule stays unwritten has fixed nothing,
so each is stated here as the general rule and the file it lives in.

### Rule 7 — one fraction-glyph table, and every layer reads it

`lib/agent/verifyQuote.ts` owns `VULGAR_FRACTIONS` and exports both the
walker (`normalizeForMatch`) and the glyph set as a character class
(`VULGAR_FRACTION_CLASS`); no other file may write a glyph list.

The renderer was checked first and was clean — `portfolioTable.ts` imports
`normalizeForMatch` rather than carrying a copy, so the ladder's rate-dedup
uses the same walker verification does. The copy was one layer over:
`lib/fetch/debtNoteLocator.ts` had a hand-written glyph string for its
coupon regex, and the two lists had already drifted **in both directions**.
The locator knew six glyphs the normalizer did not (⅐ ⅑ ⅓ ⅔ ⅙ ⅚), so a
"6 ⅓%" coupon could be located and transcribed and then fail every
downstream comparison that needs to know it equals 6.3333 — verification,
rate matching, and the ladder's own dedup. The locator cannot use the
walker (it matches RAW filing text before anything is normalized, which is
what a locator is for), so it now imports the character class instead. One
list, two shapes, no drift.

### Rule 8 — a ladder line leads with the position, and history is a qualifier that may be dropped

`lib/events/portfolioTable.ts` /
`app/page.tsx`: the outstanding amount is always the leading figure and is
never suppressed; an original issue size read out of the instrument's own
name renders only as a trailing clause, and only when it renders
*differently* from the balance.

This follows from the note's row winning: the ladder states a position, not
a history. So when the display rule rounds the two together — one tranche
is named "$ 1,500 million" and carries $1,481 million, a real $19M gap that
one decimal place renders as $1.5B on both sides — the half that collapses
is always the issue size. The alternative would be to print "$1.5B, issued
at $1.5B", which asserts a distinction the reader cannot see, or to widen
the formatter for every figure on every surface to preserve a difference
that matters on two lines in the book.

### Rule 9 — verification matches loosely, render surfaces match exactly

`lib/events/numberGuard.ts` exports both: `strictFactTokensMatch` for
verification, `sameFactForDisplay` for anything that decides whether to
show something.

`strictFactTokensMatch` treats a bare year as matching any date inside it,
and that is correct where the question is "could this fact be the one the
filing states" — a filing printing "due 2027" must not fail against a claim
of "due December 2027". Where the question is the opposite one, "does this
line add anything the line above it didn't", the same permissiveness
inverts and calls two genuinely different things the same: a bucket line
whose only token was "January 2026" was reported as restating a line about
"the first half of 2026". Any comparison that gates display now requires an
exact-precision match — a year matches only a year, a month only the same
month, a day only the same day. Verification keeps the loose rule.

None of the three changed a rendered line on the current book; the whole
book was captured before and after and diffed byte-for-byte. They are the
rules the three fixes were instances of.


---

## Rules 10 and 11, promoted to canonical headings

Both were earned in the Session 18 review and recorded only inside that
entry's own numbered list. They are the log's rules, not that entry's, so
they get headings here. The rules themselves are unchanged.

### Rule 10 — absence of a match is only evidence of absence when a match was possible

`lib/events/position.ts`: the unconfirmed pass skips any prior
row that cannot satisfy an identity test at all.

An identity match keys on rate and maturity. An instrument carrying neither —
"Advances under revolving credit facility", "Other notes payable", "Finance
lease obligations" — can never match its own counterpart on the current
ladder, so it was declared vanished on every single run and re-added as
`unconfirmed` beside the identical live row. Six of nine rows on one company
were three instruments counted twice, each one accusing the filing of
dropping something it had not dropped.

The general form, which is why this is a rule and not a patch: a negative
result from a test an item was never eligible for is not a finding. Before
concluding "this is missing", the code has to be able to say what it looked
for.

### Rule 11 — a label wrong on part of the book is worse than no label

Where a classification cannot be made reliably, measure what IS decidable and
state that instead.

A measure label for the outstanding column was built and thrown away. The
column is genuinely not one measure: one company's rows are par (its own
prose states a $118M par repurchase, matching the ladder's delta exactly),
another's are carrying value (a $700K move on an untouched fixed-rate note,
with the next table in that same filing printing "Face Amount" and "Net
Amount" as separate columns). The structural classifier read a third
company's par rows as carrying value, because that filer prints its
principal total BEFORE deducting discount.

Right on nine of ten is not right. What was shippable instead was the
MOVEMENT: accretion measured 0.076% to 0.2% of the prior balance, principal
changes 6.1% to 10.0% — a thirty-fold gap with nothing in it. The ladder
states the movement and its size and says when it cannot be read as a
repayment, and the reconciliation walk shows the measure without anyone
having to assert it.

The temptation this rule exists to refuse: a classifier that is wrong on one
company in ten is nine parts useful and one part a confident lie, and the
reader has no way to tell which line they are looking at.

---

## Rules 12 and 13, from Session 19's run A

### Rule 12 — a version constant split out of a shared key path does not get a fresh namespace; it inherits the other constant's history

Numbers get reused. A prefix does not.

`proceedsUse` was keyed on `EXTRACTION_PROMPT_VERSION`, which is the wrong
constant for it — different model, different prompt, different input
contract — and the sharing made "one substantive change per paid run"
unachievable, since re-running it would also invalidate every base
classification. So it was given its own constant, set to 2.

Setting it to 2 read seven-day-old data. That path had interpolated
`EXTRACTION_PROMPT_VERSION` for its whole life, so `.../v2.json` already
existed for most companies, uploaded when THAT constant was 2 — same
fingerprints, different prompt, unbounded input. Two companies came back
with different values and were one step from being reported as the input
bound flipping their classification. It was a stale answer to a different
question.

The audit this rule requires, run across every key construction in the
codebase, found two more instances of the same shape and one duplication:

| key | namespace | constant | verdict |
| --- | --- | --- | --- |
| `answer/{cik}/base/{fp}/v{N}` | `base/` | EXTRACTION | sole occupant; built by one exported function |
| `answer/{cik}/dig/{fp}/{trigger}/{hash}/v{N}` | `dig/` | EXTRACTION | different path from `base/`; one constant governing two paths is correct — both are the same Haiku call |
| `answer/{cik}/proceedsUse/{fp}/pu-v{N}` | `pu-v` | PROCEEDS_USE | namespaced after the incident |
| `wording/card/nar-v{N}/{hash}` | `nar-v` | NARRATION | **was colliding.** Keyed on the pre-split `PROMPT_VERSION`, now on `NARRATION_PROMPT_VERSION` — same path, constant swapped. Less exposed than pu-v only because the hash also covered the card's context, so a collision needed the same number AND identical context. Namespaced. |
| `edgar/cik/`, `edgar/submissions/`, `edgar/filings/`, `edgar/filing-text-v2/` | content-addressed | none | no version constant participates; nothing to collide |

The duplication: the base-answer key was ALSO hand-built inside
`preflight.ts`. A preflight that constructs its own copy is checking a key
nothing reads the moment either drifts — and preflight exists precisely to
be believed about whether a run is free. One exported `baseAnswerKey`, used
by both.

### Rule 13 — every paid run has an expected cost shape derivable before it starts, and a result arriving cheaper than its shape allows is suspect before its values are read

The pu-v collision was not caught by reading the classifications. Two of
them changed, which is a perfectly plausible thing for a change to the
model's input to do; read on their own they looked like exactly the finding
the run was designed to surface. What caught it was arithmetic that could
not be true: eight companies whose cache key had just been invalidated
reported `$0.14 across 2 calls`. Eight forced misses cannot cost nothing.

So the cost shape is stated BEFORE the run and reconciled after, and the
reconciliation is a gate on believing the values at all. Run A's shape was
"eight fired companies, eight forced misses, eight calls"; the first attempt
returned two, and no value it produced was worth reading until that was
explained.

This applies with most force where cheapness is the expected result. Session
20's pre-warm is forty names whose whole purpose is to arrive cached, which
is the condition under which a collision is invisible — so it states its
expected miss count up front and reconciles against it before any of its
output is trusted.

## Rules 14, 15 and 16, from Session 19's run B and its corrections

### Rule 14 — a marker describes its provenance; it never asserts an identity

Text handed to a model is read as fact. `buildExtractionText` began marking
the located debt note with "the debt-schedule note was located here", which
is a claim the locator is not always entitled to make.

UHS is the case. Its locator has always landed on the **interest-expense
table** — the book's only `via=density` match, every other company matching
`via=heading`. Unmarked, the model read that span and correctly returned no
schedule. Marked as a debt note, it complied: five interest rows became a
debt ladder, each amount read out of the issue size in the row's own name.
Asserting a wrong locator result converts an honest failure into a confident
wrong answer, which is strictly worse than saying nothing at all.

The marker now states only what is true — that a region *matched* a locator,
that it may not be a debt schedule, and that the answer is an empty sequence
if it is not.

**Corollary, earned the same day:** every branch that hands input to the
model marks it identically. The marker existed on one of two branches, so
whether the model was told where the note was depended on where in the
filing the note happened to sit. A marker present only when one branch runs
is an accident, not a design.

### Rule 15 — an amount that verifies only inside the instrument's own label is not a verified balance

Filings name tranches by the size they were issued at. "$2,500 million 4.25%
Senior Notes due 2027" is the *name* of a note whose balance that same row
reports as $1,067 million; the two figures are different facts and only one
is a position.

Corroboration accepted the issue size as proof of the balance, on both its
paths — value equality against the row's own text, and the digit-group
fallback, which reaches the same label by another route. Closing one and not
the other closes nothing.

The tell was not the numbers. `columnReadFailure` went **true → false** as
the extraction got worse: a model that never reads the columns leaves no
column inconsistency to detect. **A guard can be bypassed without ever
failing, and a guard that stops firing is not evidence that a problem was
fixed.**

The render layer had drawn this line already, so a card would not read an
issue size aloud as a balance. Extraction had not, and one asymmetry cost a
whole company. One definition now, imported by both.

### Rule 16 — a stated deduction is negative, however it is punctuated

Tenet's note prints both conventions in one table: `Unamortized issue costs
( 85 )` and, two lines later, `Less: Current portion 160`. The walk read the
sign only from punctuation, added where the filing subtracts, and reported a
gap of exactly twice the figure — the signature of a dropped sign rather
than a missing row.

The label carries meaning the digits do not. This is the em-dash lesson
again.

**The scoping is the rule, not a footnote to it.** What makes this a reading
of the filing rather than a vocabulary guard is precisely that it is bounded:

- it keys on a **deduction convention the filing itself prints**, transcribed
  verbatim — not on how the model happened to word something, which is what
  the standing ban on vocabulary guards is about;
- **`adjustment` lines only** — a row is a position, never a deduction;
- the **marker must lead the label**, so "Notes issued at less than par" is
  untouched;
- **skipped when the amount is already negative**, so a filing that both
  labels *and* parenthesises is not double-negated back to positive;
- and every correction **logs**, because the cost of over-applying is a
  silently wrong balance.

State the rule without the scoping and it becomes "we key on the word Less",
which is the guard this project does not ship. The bounds are what make it
legitimate.

### Corollary to 14–16 — one normalizer, and the count is exhaustive

Three shape corrections now sit behind `normalizeScheduleSequence`, and
*every* reader calls it. This was verified by grep, not by memory, after the
Centene render defect — where the checks walked the normalized sequence
while the render walked the raw one — turned out to have a twin inside
`computeBalanceSheetCheck`, which normalized for the subtotals it matched
and read raw for the candidates it built. `scheduleIsAggregateDisclosure`
now normalizes internally rather than trusting callers, because "both
callers currently pass a normalized sequence" is not a property.

The two remaining raw reads are cardinality only (`.length`), which no
normalization changes, and they are named here so the exhaustiveness claim
is checkable rather than asserted.

### Session 20 carry — the composite `projectName`

Quest's v19 capex-program returned `projectName: "Project Nova and
automation/AI initiatives"` against a single `projectCompletionDate: 2031`,
while its `eventInstances` correctly separate Project Nova from the
automation programme. One scalar name blended across two projects, and one
date that belongs to at most one of them.

The consequence is bounded and visible: the trigger-level date is attributed
by name to the instance it names, so an unmatchable composite attributes to
nothing and both instances keep their own `standing` status. Nothing renders
a date it cannot own — but Quest's stated 2031 completion is currently not
rendered at all.

This is the one-slot problem one field over from where Session 19 fixed it,
and the fix is the same shape: the completion date belongs on the instance,
not on the trigger. It goes with Session 20's prose-instruments work rather
than being patched here, and it is logged rather than chased because the
session scope is frozen and no wrong number renders as a position.

## Session 20 scope, as frozen at Session 19's close

Three findings from Session 19, all diagnosed and none patched, plus the
work already queued. They are grouped because the first three share a cause
with the queued work rather than because they arrived together.

**1. The UHS locator, and what a debt note is.** UHS is the book's only
`via=density` match; every other company matches `via=heading`. Its locator
lands on the interest-expense table, and its real disclosure sits in a note
headed *"Treasury / Credit Facilities and Outstanding Debt Securities"* —
vocabulary the heading finder does not recognise. The fix direction is
structural: **a debt note is identifiable by what it contains, not only by
what it is titled.** It belongs with the prose-instruments work because
UHS's term loan and revolver live in that same note. Until then UHS renders
an empty schedule with its reason stated, which is honest and wrong-free.

**2. DaVita's current-portion soft spot.** v19 dropped the second unlabelled
total and the `Less current portion` adjustment, so Check 2 loses the
subtotal its balance-sheet captions anchor to and reports $66.5M
unaccounted. The internal walk still ties; the card is suppressed. Not
fixed, because every available fix is tuning rather than a rule. Revisit
when the prose-instruments and coverage work changes its path.

**3. Quest's composite `projectName`.** `"Project Nova and automation/AI
initiatives"` against a single 2031 completion date, while `eventInstances`
correctly separates the two projects. The date names no single instance, so
it is attributed to none and Quest's stated 2031 completion does not render.
The one-slot problem one field over from where Session 19 fixed it, and the
same fix shape: **the completion date belongs on the instance, not on the
trigger.**

Already queued and unchanged: prose-instruments, the coverage check,
liquidity, triangulation, and the pre-warm — which states its expected miss
count up front and reconciles against it before its output is trusted
(Rule 13), and budgets $0.105 per name for extraction (BRD 13.2).

Also carried, from Session 19 stage 1: a company that was attempted and
failed renders as a failed attempt on the primary surface, and the assessed
count counts attempts. That goes in as a rule, not a patch.

---

# Session 19 — close-out

**Shipped.** Branch `main`, `e5f2871 → 01df22c`, 14 commits, deployed and
live-verified. Spend **$3.82** against $5.00 authorized, across four paid
runs and one narration pass.

## What the session was for, and what it turned out to be about

The brief was the one-slot schema: Session 18 had fixed one slot for
debt-maturity, and the two defects that survived its review — CHS's second
divestiture and Centene's note-prose repurchases — were the same shape one
trigger over. A company had two of something and the schema had room for one.

That work landed. Six triggers return arrays, 28 instances across nine
companies; note-prose retirements return 9 across six; both confirmed
instances resolved as consequences of a class rule rather than as company
fixes. CHS renders both divestitures.

But the session's real subject turned out to be **the difference between a
guard that passes and a guard that was never asked.** Four of the five rules
earned are about that distinction, and the most expensive hour of the
session went to a "gain" that was a defect wearing a gain's clothes.

## The UHS sequence, which is the session in miniature

v18 turned UHS from zero ladder rows to five. It was reported as the
headline: the one company with no ladder finally had one. The verification
asked for before counting it — *are these five tranches verbatim from the
real note* — showed they were rows of an **interest-expense table**, with
each balance read out of the issue size printed in the row's own name.

Three things had to be true at once for that to happen, and each is now a
rule:

1. The locator had always landed on the wrong table (UHS is the book's only
   `via=density` match). Unmarked, the model read that span and correctly
   returned nothing.
2. The marker added in v18 *asserted* the span was a debt note, so the model
   complied. **Rule 14: a marker describes its provenance, it never asserts
   an identity.**
3. Amount corroboration accepted the issue size in a row's own name as proof
   of that row's balance. **Rule 15: an amount that verifies only inside the
   instrument's own label is not a verified balance.**

And the tell was not in the numbers. `columnReadFailure` went **true →
false** as the extraction got worse, because a model that never reads the
columns leaves no column inconsistency to detect. The guard did not fail; it
was bypassed. **A guard that stops firing is not evidence that a problem was
fixed.**

## Rules earned

- **12** — every cache key is namespaced; no two constants share a key path.
- **13** — every paid run has an expected cost shape derivable before it
  starts, and a result cheaper than its shape allows is suspect before its
  values are read.
- **14** — a marker describes provenance, never identity. *Corollary:* every
  branch that hands input to the model marks it identically.
- **15** — an amount that verifies only inside the instrument's own label is
  not a verified balance.
- **16** — a stated deduction is negative however it is punctuated, with its
  scoping as part of the rule rather than a footnote to it.
- *Corollary to 14–16* — one normalizer, and the count is exhaustive,
  verified by grep rather than by memory.

## What the guards caught, unprompted

Every regression this session was caught by the product rather than by
inspection, and none rendered as a position:

| | caught by |
|---|---|
| Molina blending two tables | bounded literal verification dropped all three composites |
| Centene's mistyped subtotal | Check 1 refused to tie |
| Tenet's dropped sign | Check 1, off by exactly 2× the figure |
| DaVita's missing adjustment | Check 2, $66.5M unaccounted |
| Cigna's nil rows re-typed | the book-wide re-typing log, on its first run |
| UHS's manufactured ladder | the verification asked for before counting the gain |

The last one is the exception worth naming: it was caught by a person asking
for a check, not by the system. That is why Rule 15 exists.

## The book, as shipped

Four cards (Tenet, Quest, Centene, Cigna). Nine of ten walks tie; UHS is the
tenth and states an empty schedule with its reason. DaVita's card is gone on
a known, logged extraction soft spot and its line renders honestly. Local
and live determinism both pass ×3 on the fixed harness; 23 offline suites,
0 failures.

## What I got wrong, for the record

- Reported Molina as "the model skipped rows" before reading the raw
  response. It had emitted all five; three were dropped downstream.
- Declared a control defined by *marker unchanged* rather than *text
  unchanged*, so a run with no true control was presented as having four.
  The correction is now the definition: when a fix necessarily touches every
  input there is no untouched control, only an attributable band.
- Claimed Quest's straddle had truncated 585 characters. They were in the
  lead all along; the note was split across a banner, not cut. The fix was
  still right — it prevented a marker that would have lied — but for a
  different reason than the one I gave.
- Reported UHS's 0→5 as the session headline before verifying it.

### Pre-registered prediction for Stage 3's coverage check (logged Session 20, Stage 1)

The flagged-items page's first run shows **Check 2 (balance-sheet anchor)
failing on three companies**, with these gaps at as-of 2026-08-31:

| company | Check 1 (internal walk) | Check 2 (anchor) | gap |
|---|---|---|---|
| Molina | ties | **fails** | $184M unaccounted |
| DaVita | ties | **fails** | $66.5M unaccounted |
| UHS | note found but read wrong | **fails** | no rows to anchor |

Molina and DaVita are almost certainly **prose instruments the itemized
ladder misses** — which is exactly what Stage 3 is built for. UHS may
resolve or transform under Stage 2's locator fix, so it is not a clean
test case for Stage 3.

**The prediction, registered before the work:** if Stage 3 lands and these
anchors still fail with the same gaps, the coverage check did not work.
Stated now so it cannot be reinterpreted afterwards as an expected
limitation.

Noted alongside: walk-tie reporting from here names WHICH check. "Nine of
ten walks tie" was true of Check 1 and silently not a statement about
Check 2 — the same shape as reporting "all four narrated" when one card
failed its structural check. Check 1 and Check 2 are separate facts and
are reported as two.

### Rule 13, refined — a declared shape must be one the mechanism can produce (Session 20, Stage 2)

Stage 2's result shape promised "nine companies byte-identical." That was
never available: a version bump ORPHANS every cached answer, so all ten are
re-asked, and re-extraction has never been byte-stable even on identical
input — v17, v18 and v19 each showed the same formatting drift ("$1,975,000
thousand" against "$ 1,975,000 thousands"). The shape was falsified by the
mechanism, not by the change under test, which makes it useless as a test.

The reference for a bumped run is therefore:

- **Span identity** — the located span, its provenance and its match count,
  which are computed offline at $0 and ARE byte-stable. This is the
  checkable claim.
- **Model variance** — a named band, not a failure: unchanged spans mean
  identical inputs, so output differences are re-ask drift. Report them
  attributed (formatting only / more complete / less complete) rather than
  as a pass-fail bit.

Same family as Session 19's invalid control: both were shapes stated in
terms of a property the mechanism does not hold, and both would have read a
correct run as a regression.

## Rules 17, 18 and 19, from Session 20's Stage 3

### Rule 17 — a bridge item is itemised, never tolerated by raising the line

Coverage's residual threshold was set by measuring the book, and the
measurement changed the design. The residual between stated total debt and
the note's rows at face runs 0.00% to 2.00% across the ten — and it is not
noise. Every figure IS the note's own discount / deferred-financing line,
printed in the same table: DaVita's $66.5M is "Discount, premium and
deferred financing costs (66,503)"; Molina's $31M is "Deferred debt issuance
costs (31)". Face exceeds carrying by exactly the unamortised cost.

So the bridge is SUBTRACTED before the residual is judged, and the threshold
covers only what remains. **When a future company's bridge exceeds the line,
the answer is to itemise the new bridge item, never to raise the line.**
Raising it trades a known, nameable reconciling item for blanket tolerance,
and every instrument smaller than the new line becomes invisible at the same
moment.

What makes a single threshold safe here is the separation between the two
populations: the largest measured bridge is 2.00%, and the smallest thing
the check must still catch — UHS's drawn revolver — is 4.6% of its total.
An order of magnitude, not a margin. Pinned in bridgeMeasurement.test.ts,
which IS the measurement rather than a record of one: the original
throwaway script disagreed with itself across rewrites and the figures were
confirmed by hand, which is not a basis anyone can re-derive.

### Rule 18 — a stated total that already includes a component must not have it subtracted again

Stated total debt sums the balance sheet's current-maturities caption AND
its long-term caption. Subtracting the note's own "less current portion"
line on top removes the current maturities twice.

It looked like noise and it was arithmetic: this double-subtraction is the
WHOLE of the apparent residual on DaVita, Tenet, HCA, CHS and Centene.
Adjustments are matched to captions BY CATEGORY, never by proximity or by
order in the table.

The general form: before subtracting a reconciling line, ask what the total
it is being subtracted from already contains.

### Rule 19 — same size is not same instrument

Dedup of prose instruments against table rows matches on category plus
amount. An earlier cut also collapsed PROSE against PROSE on the same key,
and it cost exactly $1B on the worked example: UHS issued three separate
$500 million senior notes (2029, 2032, 2034), which the rule read as one.

Two sentences describing instruments of equal size are two instruments. A
duplicate requires one side to be a TABLE ROW — that is the case where the
note has printed the same instrument twice, once in each form. Identity is
never inferred from size alone, in the same way it is never inferred from
name alone (a filing calls one facility "Eleventh Amendment" and "Twelfth
Amendment" in consecutive paragraphs).

---

## Session 20, Stage 4 — PRE-REGISTERED BEFORE SPENDING (Rule 13)

Written and committed at `6305627`, before the run. Anything outside this shape stops.

### Cost shape

| Call | Companies | Why it bills | Expected |
|---|---|---|---|
| Base classification (Haiku) | 10 | `EXTRACTION_PROMPT_VERSION` 22 → 23 orphans every cached base answer | **~$1.05** at the realized rate ($0.105/company), ±10% for span size |
| proceedsUse (Sonnet) | 0–8 | Keyed on `pu-v{N}-{inputHash}`, NOT on the extraction version. It re-bills only where the issuance trigger's own evidence/quote moved in re-extraction. | **$0.00–$0.51** |
| Narration | 0 | Not this run. Declared separately after the ladder is accepted. | $0.00 |
| **Total** | | | **$1.05 – $1.66** |

Session to date $3.91 of the raised $8.00 ceiling. Projected total **$4.96 – $5.57**, inside it. If the run projects past $8.00, stop and ask.

Two span-cost notes, both already measured: eight companies' note spans grew (Encompass 981→4,298 chars, Molina 941→3,417, DaVita 3,409→7,510, CHS 2,863→8,139, UHS 3,210→13,398), which adds roughly 7,400 input tokens across the book — cents. Against that, Cigna's anchor moves from a 518,211-char 10-K to a 147,094-char 10-Q, which is a reduction. `max_tokens` stays at 20,000.

### Result shape

**Expected — the acceptance test, actually run this time.**

1. **UHS extracts its five senior notes from the bullets** — $700M/1.65%/2026, $500M/4.625%/2029, $800M/2.65%/2030, $500M/2.65%/2032, $500M/5.050%/2034 — as five ladder rows from the **10-Q** (period 2026-06-30), plus term loan A at **$1.448 billion**, the revolver's **$225 million drawn**, and the **$68 million** of Trust financial liabilities the note states are "included in debt". Captured $4.741B against stated total debt of **$4,851,847K**, residual **2.28%**, inside the 2.5% line. Coverage ~98%.
   - The $1.155 billion figure is a trap and must NOT appear: the note prints it as what the term loan used to be ("from $1.155 billion previously").
   - Offline, this exact arithmetic is pinned as `coverage.test.ts [2a]–[2e]`.
2. **The three over-100% coverages drop to real percentages.** Molina 134% → ~101% (its $1.25B facility has nothing drawn); Tenet 115% → ~100% (drawn stated as $0). Both facilities still render, as capacity.
3. **The UHS term-loan duplicate collapses and the three $500M notes stay distinct.** Pinned offline as `[11a]`–`[11c]`.
4. **No company anchors on a filing older than its most recent 10-Q/10-K.** All ten anchor on their 10-Q.

**Declared consequences, so they are not read as surprises.**

- **Cigna's 38-row ladder goes to zero, and that is the rule working.** Its anchor is now its most recent 10-Q, whose entire debt note is four narrative paragraphs ending *"see Note 7 to the Consolidated Financial Statements in the Company's 2025 Form 10-K."* Following that cross-reference is what produced a December 31 2025 ladder beside a June 30 2026 balance sheet. Cigna should render **empty with reason**, with its captions readable for the first time (they sit at char 7,073 of the 10-Q, versus char 277,000 of the 10-K — outside every window the model was ever given, which is the real reason its captions were 0 at v22, not truncation).
- **Cigna's v21 captions were wrong, not missing.** They read `"Short-term debt 2,792   592"` and took **592** — the December 2025 comparative column — because the guidance section was naming December 31 2025 as the base period. Restoring them as asked would restore a wrong number.
- **Eight companies re-extract with wider spans.** Their ladders should be unchanged in substance; drift is possible and will be reported line by line, not waved at.

**Out of shape → stop.** Specifically: UHS not reaching its five notes; any company anchoring older than its newest 10-Q/10-K; any coverage above 105%; a ladder losing rows for a reason other than the anchor rule.

---

## Session 20, Stage 4 corrected (v24) — PRE-REGISTERED BEFORE SPENDING (Rule 13)

### Rule 20 — a backgrounded run persists its per-company cost, or Rule 13 cannot be checked

The v23 run was pre-registered under Rule 13 at $1.05–$1.66 and came in around $2.05. That figure is an estimate, and it has to be, because the run was moved to the background, its captured output was truncated to the last few kilobytes, and eight of the ten per-company cost lines no longer exist. The cost meter printed and stored nothing.

**A pre-registered cost that cannot be reconciled afterwards is not a control.** The meter now appends a JSONL record per company as each scope closes (`persistCompanySpend`, `baselines/cost-log.jsonl`), best-effort and append-only, so the record outlives the terminal it was printed in. The same applies to any future run: if it can be backgrounded, its cost must be on disk before it starts.

Sits with Rule 13 (declare the cost shape before spending) as its other half: declare it, then keep the evidence that lets someone check the declaration.

### Cost shape

This is the last paid run inside budget. It takes the session to approximately **$8.00, the ceiling.**

| Call | Companies | Expected |
|---|---|---|
| Base classification (Haiku) | 10 | ~$1.20 |
| proceedsUse (Sonnet) | 8 | ~$0.68 |
| Card narration | ~3 | ~$0.15 |
| **Total** | | **~$2.05** (range $1.80–$2.30) |

Session to date ≈$5.96. Projected total **≈$8.01**. Nothing further is spent after this run whatever the outcome.

Reconciliation this time is mechanical: `baselines/cost-log.jsonl` will hold one line per company.

### The change

**One rule, and it cuts both ways — which is what makes it safe.** An amount is copied in the unit the item itself prints. A table cell reading `700,000` under an "(In thousands)" caption stays `$700,000 thousand`; a bullet reading `$ 700 million` stays `$700 million`. Neither converts. A ladder drawing rows from a thousands table *and* from millions bullets carries both units exactly as each was printed — making them uniform is not tidying, it is altering the source.

**A second change, and it is not optional arithmetic.** Without it the acceptance test cannot pass, measured:

```
notes + term loan + revolver          $4.673B   residual 3.69%   FAILS
+ Trust financial liabilities $68M    $4.741B   residual 2.28%   PASSES
```

UHS's note states, in a sentence, that its balance sheets "reflect financial liabilities, which are included in debt, of approximately $ 68 million and $ 70 million, respectively". v23 did not extract it, because it names no facility and no lender. So: **a liability the note says is included in debt is an instrument**, and where one sentence gives figures for two dates, the anchor's own period wins — the same rule already applied to a comparative table's columns ($68 million at a June 30 2026 period of report, never $70 million).

### Result shape

1. **UHS's five senior notes read as printed, corroborate, and render** — $700M/1.65%/2026, $500M/4.625%/2029, $800M/2.65%/2030, $500M/2.65%/2032, $500M/5.050%/2034, from the 10-Q's own bullets.
2. **UHS reconciles to $4,851,847K within 2.5%** — captured ≈$4.741B, residual ≈2.28%, coverage ≈98%. The acceptance test, finally run.
3. **The eight table-reading companies are byte-identical on captured face**, pinned as literals in `lib/events/capturedFace.test.ts` at v23 values: DaVita 10,847,581,000 · HCA 50,169,000,000 · Tenet 13,333,000,000 · Encompass 2,634,000,000 · CHS 9,770,000,000 · Quest 5,674,000,000 · Centene 16,179,000,000 · Molina 3,800,000,000. Any movement there means the unit rule reached a table it should not have touched.
4. Cigna stays at 0 rows with its reason, its June captions, and 3% coverage.

**Out of shape → stop, and do not spend past the ceiling.** Specifically: UHS's bullets still dropped; UHS above 2.5% residual; any of the eight moving on captured face; any coverage above 105%.

---

## Session 20, Stage 4 corrected again (v25) — PRE-REGISTERED BEFORE SPENDING (Rule 13)

### Rule 21 — where a schema permits one fact in two fields, the two fields will eventually disagree

v24 added "typography is not the test" so that a sentence could be a schedule row. Every instrument in a prose note then had two legal destinations, and no amount of "do not duplicate rows already in the schedule sequence" wording constrained it. What came back was UHS's term loan in *both* fields, as `$1,448,000 thousand` in one and `$1,448 billion` in the other — the same instrument, a thousand-fold apart, because two fields were free to render it in two units.

The wording was never the fix. **The boundary has to be a property of the source, decided once**: what the note prints as a TABLE goes in `scheduleSequence`; what it prints as a BULLET or a SENTENCE goes in `proseInstruments`. Every instrument has exactly one destination and it is the filing that chooses, not the model.

Sits beside the standing convention "fix the shape, not the symptom" as its schema-level form.

### The free preview, run before spending (all offline, zero API calls)

**Does UHS's note contain a table at all?** Its six issue-size statements sit a **median 270 characters apart**; a real table's rows sit 60–90 apart. It contains no table. So `scheduleSequence` must come back empty and there is nothing for `proseInstruments` to collide with.

**Where does each instrument land?** All eight located inside the note span 40,819–54,217:

| instrument | unit as printed | at | destination |
|---|---|---|---|
| term loan A | billion | 43,312 | proseInstruments |
| revolving credit facility (drawn) | million | 42,989 | proseInstruments |
| 2026 Notes | million | 46,081 | proseInstruments |
| 2029 Notes | million | 46,350 | proseInstruments |
| 2030 Notes | million | 46,647 | proseInstruments |
| 2032 Notes | million | 46,917 | proseInstruments |
| 2034 Notes | million | 47,182 | proseInstruments |
| Trust financial liabilities | million | 50,311 | proseInstruments |
| *delayed draw term loan A* | — | 43,080 | proseInstruments (commitment) |
| *delayed draw short term loan* | — | 42,402 | proseInstruments (commitment) |

**Eight instruments, eight single destinations, zero schedule destinations.** The Trust sentence appears twice in the filing (27,721 and 50,311) — the lease note and the debt note — and only the second is inside the span, which is the one the verifier binds to.

**And the arithmetic, mechanically:** the exact shape above run through dedup and coverage gives captured face **$4,741,000,000** against stated **$4,851,847,000**, residual **2.28%**, inside the 2.5% line, 8 entries all from one field, 0 rows, 0 impossible, 0 stated-but-uncaptured, and the three $500 million notes staying three. Pinned as `coverage.test.ts [2a]–[2f]`.

### Also fixed, code-only and free, before the run

`proseInstruments` fed `computeCoverage` **and nothing else**. A company whose note has no table would have rendered an *empty ladder* beneath a coverage line reading 98% — a page contradicting itself, and an acceptance test that passed while showing an RM nothing. Prose instruments now render as ladder lines, labelled as stated in the note's narrative, with capacity marked as capacity on the line.

### Cost shape

| Call | Companies | Expected |
|---|---|---|
| Base classification (Haiku) | 10 | ~$1.30 |
| proceedsUse (Sonnet) | ~7 | ~$0.60 |
| Card narration | ~3 | ~$0.15 |
| **Total** | | **~$2.05** (range $1.80–$2.30) |

Measured against the v24 run's own persisted log ($1.64 across 17 calls plus ~$0.15 narration). Rule 20 applies: `baselines/cost-log.jsonl` is written per company as each scope closes, so this is reconcilable afterwards rather than reconstructed.

### Result shape

1. **UHS: eight prose instruments, zero schedule rows.** Five notes + term loan A $1.448 billion + drawn revolver $225 million + Trust liabilities $68 million = **$4.741B against $4,851,847K, residual 2.28%**, coverage 98%. Both delayed-draw facilities reported as $1.1B of capacity. The acceptance test, finally run.
2. **No instrument in two fields**, for any company.
3. **The eight table-reading companies unchanged to the dollar** on captured face — pinned as literals in `capturedFace.test.ts`. DaVita and Molina are pinned at their *v23* values; if they hold their v24 positions instead (DaVita $10.913B, Molina stated $3.953B) that is stated as a v24 carry-over, not silently accepted.
4. **Molina and DaVita keep flagging their real gaps.** Molina's $184M finance-lease caption and DaVita's $65M revolver row are genuine findings; they must stay visible, not be silenced.
5. Cigna stays empty-with-reason at 3%.

**Out of shape → stop, and reassess the approach rather than iterating.** Specifically: any instrument appearing in both fields; UHS above 2.5% residual; UHS's bullets absent again; any of the eight moving on captured face for a reason other than the v24 carry-over.

---

# Session 20 — close-out

**Shipped `7db4190` to `main`, deployed at https://coverage-signal.vercel.app.** Determinism ×3 on both books, local and live, byte-identical, plus the cross-book run 4. Offline suite 586 assertions across 33 files, 0 failures. tsc and `next build` clean.

**Spend: $9.90.** Six paid runs at v18→v25 plus one variance measurement, against a ceiling that moved from $5.00 to "spend what the project needs" as the work turned out to be deeper than the prompt assumed.

---

## Rules 1–3, filled at the close

The log has carried a numbered gap since Session 18: rules were numbered from 4 because the first three were standing conventions nobody had written down. They are the three this project actually runs on, and Session 20 leaned on all three harder than any session before it.

### Rule 1 — a structural test, never a vocabulary guard

A rule that works by knowing which words a filing uses will fail on the next filer, and it will fail silently, because a missing word looks exactly like a missing fact. A rule that works by arithmetic or by the shape of the document holds on filers nobody has seen.

Session 20's whole locator rests on this. The interest-expense table is rejected because *each row's amount is a median 1.16% of the principal its own label names* — a quarter's coupon cannot be a balance — and not because it says "interest" anywhere. UHS's bulleted note is accepted because *five stated amounts sum to a sixth the same passage states*, and a parts list with its own total is a schedule whatever it is titled. The note's boundary is read from *the successor heading the filing itself prints*, in the numbering style the matched heading states, and not from a distance constant. Capacity is separated from debt by *whether a drawn balance is stated*, which catches a facility type nobody has named yet. And an impossible amount is caught by *a component cannot exceed the total it is part of*.

Where a threshold is unavoidable, it is measured and the measurement is pinned as a suite (Rules 17 and its bridge test; the 2× impossible-amount bound, measured at 0.889× legitimate against 298× the error).

### Rule 2 — rules first, never instances

A fix aimed at the company in front of you is a fix that will need making again. UHS was the worked example of this session, and not one line of code names it. The anchor rule is keyed on "the most recent 10-Q/10-K", not on UHS; it caught Cigna, which nobody was looking at. The capacity rule is keyed on "is a drawn balance stated", not on Molina and Tenet; it will catch the next facility type on the same test. The bullets rule is keyed on typography, not on UHS's note.

The corollary, which cost this session two runs: **when a rule is right and the run still fails, the rule is not the thing to tune.** v24 was a correct rule (copy the digits as printed) that failed because a *second* problem was in the way. Tuning the rule would have broken the eight companies it was already right about.

### Rule 3 — never suppress

A line or a check that cannot resolve renders with its problem stated. Silence is not a valid output, because a reader cannot tell a book that was checked and found clean from one that could not be checked at all.

Session 20 found this violated by its own new work, twice, and both were caught before a reader saw them. **The coverage check was computed in Stage 3 and rendered nowhere** — a check that runs and is not shown is a check nobody can act on. **Prose instruments fed the coverage figure and never the page** — a note with no table would have rendered an *empty ladder* beneath a line reading 98% covered. Both are the same failure: the work was done and the reader was not told.

The rule's harder half is that it applies to the checks themselves. Cigna renders `empty with reason` and 3% coverage rather than a tidy stale ladder. UHS's impossible $1.448 trillion renders as *"IMPOSSIBLE AMOUNT, EXCLUDED … Read the filing; this is a transcription error, not a balance"* rather than being dropped quietly.

---

## What this session was about

The tool had been rendering a ladder. It had not been rendering a *position*.

Nothing checked whether the ladder came from the filing whose balance sheet was printed beside it, and nothing checked whether the ladder described the company's debt at all. Both checks that existed compared the note to itself. So a ladder eight months stale, or missing an entire term loan, passed everything.

Two companies were in that state and nobody knew:

- **UHS** assembled one rendered position from **three filings and three dates** — eleven rows from the February 10-K, balance-sheet captions read off the June 10-Q's *December comparative column*, and prose instruments from the March 10-Q.
- **Cigna** had been rendering a **38-row December 2025 ladder beside a June 30 2026 balance sheet** for as long as the ladder has existed. Its captions read `"Short-term debt 2,792   592"` and took **592** — the December figure, $415M light.

And the wrong-column reads were not the model's mistake. The guidance section names the base filing's period, the prompt says read the column matching it, and the guidance was saying December 31 2025. **The model did exactly as instructed.** Fixing the anchor fixed the columns; there was no column defect to chase.

---

## The arc, in the order it actually went

| stage | what it was | what it cost |
|---|---|---|
| 1 | Module consolidation, failed-fetch visibility, flagged-items page | $0 |
| 2 | Locator by content — disqualifier before qualifier | ~$1.55 |
| 3 | Prose instruments, revolver, coverage with a measured threshold | $1.84 |
| 4 (v23) | Anchor rule, note-boundary span, capacity, dedup | ~$2.05 |
| 4 (v24) | Copy the digits as printed | ~$1.79 |
| 4 (v25) | One instrument, one field | ~$1.68 |
| variance | Molina denominator, measured with CACHE_BUST | $0.48 |

Stage 4 took three runs and each failure was informative rather than repeated.

**v23** — the anchor rule landed book-wide, and the bulleted-schedule capability *worked*: the model transcribed all five of UHS's senior-note bullets verbatim, inside the located note, at offsets 46,083 / 46,352 / 46,649 / 46,919 / 47,184. All five were dropped, because it rendered the bullet's `$ 700 million` as `$ 700,000 thousand` and the amount is then not printed anywhere near its own row. Measured both ways against the real filing: as written, none corroborate; as printed, all five do.

**v24** — the unit rule was correct and provably safe (six of eight table companies byte-identical, no thousands table rescaled in either direction) and the run still failed, because making a sentence a schedule row created a *second* problem. The model transcribed the three sentences as rows, skipped the bulleted list, and returned the same three instruments in **both** fields in different units: `$1,448,000 thousand` as a row against `$1,448 billion` as prose. A misplaced decimal, $1.448 trillion, on a ladder line.

**v25** — the boundary became a property of the source, decided once. Previewed free before spending: UHS's note contains no table at all (six issue-size statements a median **270 characters** apart, where a table's rows sit 60–90), and all eight instruments plus both undrawn facilities locate inside the note span. Eight instruments, eight single destinations. The run confirmed it: **zero field collisions across the whole book.**

---

## The acceptance test

UHS, at its own anchor, hand-verified against the filing.

```
NO TABLE IN THIS NOTE — 9 instruments below are stated in the note's own
narrative rather than in a table, which is how this filer discloses.

0 rows + 8 prose instruments cover $4.74B of $4.85B stated total debt (98%),
against Current maturities of long-term debt + Long-term debt — plus $400M of
undrawn capacity NOT counted as debt

revolver reconciles — drawn + LCs + available = facility size

· $700 million    1.65% Senior Secured Notes due 2026 — due 2026-09-01
· $500 million    4.625% Senior Secured Notes due 2029 — due 2029-10-15
· $800 million    2.65% Senior Secured Notes due 2030 — due 2030-10-15
· $500 million    2.65% Senior Secured Notes due 2032 — due 2032-01-15
· $500 million    5.050% Senior Secured Notes due 2034 — due 2034-10-15
· $1.448 billion  Tranche A term loan, due 2029-09-26
· $225 million drawn under $1.5 billion Revolving credit facility
· $400 million    Delayed draw term loan A — committed but undrawn
· $68 million     Financial liabilities from failed sale leaseback with UHT
```

**$4,741,000,000 against $4,851,847,000. Residual 2.28%, inside the 2.5% line. Coverage 98%, from 0%.**

Every amount in the unit the filing prints it in. The `$1.155 billion` trap — which the note prints as what the term loan *used to be* — appears nowhere.

**First golden-file candidate.**

---

## The book, at v25

| company | rows | prose | captured | stated | coverage | residual |
|---|---|---|---|---|---|---|
| DaVita | 9 | 1 | $10.913B | $10.781B | 101% | 0.6% |
| HCA | 4 | 0 | $50.169B | $49.718B | 101% | 0.0% |
| Tenet | 11 | 0 | $13.333B | $13.248B | 101% | 0.0% |
| **UHS** | **0** | **9** | **$4.741B** | **$4.852B** | **98%** | **2.3%** |
| Encompass | 7 | 0 | $2.634B | $2.634B | 100% | 0.0% |
| CHS | 11 | 1 | $9.770B | $9.578B | 102% | 0.0% |
| Quest | 13 | 0 | $5.674B | $5.642B | 101% | 0.0% |
| Centene | 8 | 0 | $16.179B | $16.105B | 100% | 0.0% |
| Cigna | 2 | 1 | $1.000B | $31.878B | 3% | 96.9% |
| Molina | 5 | 1 | $3.800B | $3.769B | 101% | 0.0% |

Nothing above 102%. Undrawn capacity now reports as capacity: Tenet $1.90B, Molina $1.25B, CHS's ABL $1.00B, Cigna $6.50B, UHS $400M. **Zero field collisions.**

Two new category-completeness findings nothing previously asked: Encompass states a revolver we hold no amount for; Centene states a term loan we hold no amount for.

---

## Is the coverage percentage demo-ready?

**As a flag, yes. As a quoted decimal, no.**

For eight of ten companies the residual is 0.0% and the answer is exact. UHS is 2.28% and hand-verified. What is not settled is the **denominator**: stated total debt is the model's reading of which balance-sheet lines count as debt, and that reading is **prompt-sensitive**. Molina's `Finance lease liabilities $184 million` caption appeared at v24 and is absent at v23 and v25, moving its stated total between $3.769B and $3.953B and flipping Check 2.

That was measured rather than assumed. Three forced re-asks at v25 on the same filings (`CACHE_BUST`) returned the identical single-caption set — **so this is not run-to-run variance.** It is the model changing its reading when the prompt changes. Finance leases are either in stated total debt or they are not, and **the spec does not currently say which.** Until it does, quote coverage as "accounts for / does not account for", not as a percentage to a decimal place.

**Does the determinism harness catch it? No, and it structurally cannot.** Determinism replays the answer cache, so at a fixed version it re-reads one stored answer three times. `CACHE_BUST` is the only lever that re-asks the model at the same version, and it is what produced the answer above. This is worth stating plainly: *a determinism pass is a statement about the pipeline, not about the model.*

---

## Rules from this session

Numbered 17 onward, with 1–3 filled above.

- **Rule 17 — a bridge item is itemised, never tolerated by raising the line.**
- **Rule 18 — a stated total that already includes a component must not have it subtracted again.**
- **Rule 19 — same size is not same instrument.** Three real $500M notes are three.
- **Rule 20 — a backgrounded run persists its per-company cost, or Rule 13 cannot be checked.** A pre-registered cost that cannot be reconciled afterwards is not a control.
- **Rule 21 — where a schema permits one fact in two fields, the two fields will eventually disagree.** Wording does not constrain it; the boundary must be a property of the source, decided once.

Two more that earned their place without a number, as corollaries:

- **A control is defined by text unchanged, never by marker unchanged** (Session 19, restated here because Stage 2 leaned on it): when a fix necessarily touches every input there is no untouched control, only an attributable band.
- **Two surfaces deciding one thing is the same defect as two fields holding one instrument.** The revolver line said "capacity, not debt" while coverage counted its drawn balance. `debtContribution` now decides for both.

---

## What was found and deliberately not fixed

Ten items, carried to Session 21 and recorded in BRD §13.2b. The three that matter most:

1. **Tier 2 — the post-anchor events layer**, designed in full and not built. One ladder, two rendered tiers, never blended; Tier 1 carries the coverage percentage and Tier 2 never does; nets rather than stacks; keeps an intended-but-unconfirmed repayment marked *pending*; uses nothing from a 424B "as adjusted" column as position. UHS's $700M notes maturing September 1 2026 with a prospectus-stated takeout are the worked example.
2. **Molina's prompt-sensitive denominator** — the first fix item, because it is the one thing standing between coverage and being quotable.
3. **UHS renders no card.** Its $700M notes mature *today*, the most urgent item in the book, and produce nothing — card candidates are built from the position's rows and UHS's ladder is entirely prose. It also failed to card at v22 when it *did* have eleven rows, which is a second cause not yet diagnosed.

---

## What I would tell the next session

The two runs that failed did so for the same underlying reason, and it took both to see it: **a schema that permits two answers will produce two answers, and no amount of instruction closes that.** v24's "do not duplicate rows already in the schedule sequence" was in the prompt, in capitals, and the model duplicated anyway — not from carelessness, but because both fields were legal destinations and nothing in the *shape* of the request said which.

The fix that worked was not better wording. It was removing the choice: the filing's own typography decides, and the model reports rather than judges. That is Rule 4 (fix the shape, not the symptom) arriving at the schema layer, and it is probably where the next three defects live too.

The other thing worth carrying: **the free preview earned its keep.** UHS had surprised us twice, and the third time we located every instrument in the filing, proved the note contained no table, and ran the arithmetic offline before spending a dollar. It cost nothing and it caught a false miss in the diagnostic itself. When a company has surprised you twice, measure before you spend.

---

### Rule 22 — a field the model may fill must be a field the source structurally has

Availability is decided by measurement of the span, not by instruction to the
model. UHS's routing proved the difference: the prompt said one instrument has
one legal destination, and it *was* one legal destination — but which one the
model chose varied between runs on byte-identical instructions (v26: nine
prose instruments and 98% coverage; v27: one, and 10%). The rule held;
compliance with it did not. A schema that offers a field the source does not
have is an invitation, and instructions do not close it.

### Rule 23 — a hand-verified state is a golden-file candidate only after it reproduces on independent re-asks

One run is one observation. UHS's 98% was hand-verified against the filing and
called the first golden-file candidate on the strength of a single extraction;
the next run at the same prompt returned a different instrument set. The
verification was real and the reproducibility was never tested, and only the
second makes a state a fixture.

### Rule 24 — a measurement is only as clean as the region it runs on

Session 20 widened the note span to the whole note, for good reasons, and that
widening is what made "is this note tabular" unanswerable a session later: all
thirteen comma-grouped figures in UHS's span belong to a foreign-currency
table and a cash reconciliation that share its Treasury note. Three separate
framings — density, maximum figure, adjacency — each placed a prose-only note
firmly inside the tabular band. A boundary chosen to include everything
relevant will include things that are not, and the fix is the boundary, not a
threshold tuned around it.

**Corollary (owed from the same session, logged here):** a boundary narrows
what a region is *called*, not what the model can *see*. The debt-note
boundary sets the span the tabular/prose measurement runs on and the extent
of the note marker; the text past it stays in the corpus as ordinary filing
text. A boundary that removed text from the model's view would be a
suppression wearing a measurement's clothes — the model would lose facts to
make a classification cleaner, which is the trade this project never makes.

### Rule 25 — an event with no amount in its own confirming filing is rendered, and nets nothing

A filing can say a thing happened without saying how much. UHS is the worked
example: two 8-Ks state that the underwriters' affiliates "will receive a
portion of the proceeds of the transactions as a result of the repayment of
the outstanding borrowings under the Issuer's revolving credit facility", and
neither prints a figure. The $225 million is in the 10-Q, where it describes a
June 30 *balance*, not an August repayment.

Both halves render: the event with its date, its filing and its verbatim
sentence, and the gap in those exact words — "amount not stated in the
confirming filing". The effect is zero. Sizing it from a document that does
not state the event is a stitch, not a reading.

**Correction to the Stage 4 brief, logged as the correction it is.** The
brief called UHS's revolver repayment a *confirmation* with no amount. It is
not. Scanned across every UHS 2026 filing, the only two sentences about it
are the identical underwriters'-conflicts disclosure in the 8-Ks of August 13
and August 21, and both are future-tense — "will receive ... as a result of
the repayment". Nothing in the corpus states the repayment as done. UHS is a
**stated-but-unsized intention**, one status away from where the brief placed
it, and it takes the pending path rather than the confirmed one. Building it
as a confirmation would have been fitting the rule to the expectation.

Two reasons an event can net zero, and they are **not** the same reason:
*unsized* means we do not know how much; *unconfirmed* means we do not know
that it happened. An event can be both, and "unconfirmed" binds the
arithmetic while the surface still states the second gap. The rolled total
names both counts, because a roll-forward that silently omits a real event
reads as complete when it is not.

### Rule 26 — a row the note's own subtotal never counts stays a row, with its exclusion stated

Check 1 proves that the rows *inside* a subtotal reconcile to it. It can say
nothing about a row no subtotal ever closes over: that row accumulates into a
running sum nothing is ever compared against, so it passes in silence while
being counted in the ladder and in coverage.

Decided once, book-wide: such a row **renders as a row**, with its exclusion
stated on the surface. It is not quietly moved to the prose field. Moving it
would take it out of the walk — the one check that could ever find it — and
prose instruments are deduped against table rows, so a row-shaped fact in the
prose field risks being silently *dropped* rather than flagged. Suppression by
relocation is still suppression.

**Measured across all ten at v28: zero.** The Session 21 brief named DaVita's
$65 million revolving-line row as the instance; at v28 that row sits inside
its "Senior Secured Credit Facilities" section and inside the rollup that ties
exactly at $10,847,516,000. The premise held at an earlier extraction version
and does not hold now. So this ships as a **guarantee rather than a repair** —
a detector, a rendered line, and a book-wide gate asserted empty, which will
state the problem out loud the first time a filer or a prompt version produces
one.


### Rule 27 — a derived line is arithmetic over a verified field, and it declares what it computed

Cards state facts; what makes a fact a call is the arithmetic beside it. Four
lines — months to maturity, the company's own refinancing pattern, the next
tranche up, and the liquidity sitting next to the maturity — are computed in
code from fields already extracted and already verified, and rendered outside
the narrated body. **No model call, so no narration bump**, and Rule 6 in its
strongest form: a field the model is never shown cannot drift from what the
guards see.

Each line declares two things. **`inputs`** is the verified source text the
arithmetic ran over, verbatim. **`computed`** is the one value the line
exists to state. Every money, percent and date figure in the rendered text
must trace to `inputs` at the same scale, or BE `computed`. Nothing else
renders — and a line the guard rejects is reported with the untraceable
figure named, never blanked.

Three things a derived line may not do, each of which the first draft did:

- **Print a figure it did not source.** A derived line does not restate an
  amount the card and ladder already carry: two surfaces stating one number
  is this project's oldest defect, and an extracted field's display form
  ("$1,067 million") legitimately differs from the bare cell its filing
  prints ("1,067") — a guard strict enough to catch a guessed scale must
  reject that difference, so the line does not print it.
- **Compute a month count from a bare year.** The same rule the narration
  prompt has carried since Session 17. Tenet's 5.125% states only "2027"; the
  line states the year and states why there is no count. It applies to the
  GAP between two tranches as well as to a single maturity.
- **Take the sign from a rounded count.** `monthsBetween` rounds, so a
  tranche that matured three days before the as-of returns 0 and a `months >=
  0` test reads it as upcoming. UHS's 1.65% notes matured 2026-09-01 and the
  first draft rendered "0 months out". Past or future is decided by the
  dates.

**Nothing about markets, rates, or timing**, permanently. That is the
unsupported-inference class Session 19 removed and it does not return through
a side door labelled "derived". The liquidity line carries the boundary in
its own text: *capacity, not a plan — the filing states what is available,
never what will be used.*

### Rule 28 — a refinancing is dated by its issuance; a redemption is not dated at all

`RedeemsClaim` carries no date. The only date available is the issuance's own
`eventDate`, which dates the OFFERING. Writing "last retired debt on <that
date>" asserts a retirement date no filing states — the amount-join defect
one field over, confirmation and date joined across sources on nothing.

The first draft did exactly that: Encompass's 8-K prices its 2034 notes on
2026-05-29, and the line read as though its 4.50% 2028 notes were called that
day. A refinancing IS the issuance and the retirement is what its proceeds
did, so the line says **"last refinanced … an issuance dated X whose proceeds
retired Y"**, and states no retirement date. Where the retired tranche's
maturity is structurally available, the months-ahead figure is measured from
the issuance date, which is what the text now claims.

The join to that maturity is **rate AND the row's own maturity year,
together, never a substring** — measured on this book, a loose substring
match paired CHS's 5.625% claim with its unrelated 6% row, because "6" is a
substring of both "6.250" and "5.625".

**Worked example 1 — the issuance date as the redemption date.** Encompass's
8-K prices its 2034 notes on 2026-05-29. The first draft of the refinancing
line rendered "Last retired debt 3 months ago, on 2026-05-29 — 4.50 % Senior
Notes due 2028", asserting that the 2028 notes were called on the day the new
notes priced. No filing says that. `RedeemsClaim` carries no date, the
issuance's `eventDate` dates the offering, and joining the two produces a
fact neither source states — the same shape as UHS's $225 million, where the
confirmation lives in an 8-K and the figure lives in a 10-Q describing a
different date. The line now names the issuance as the issuance.

**Worked example 2 — the sign taken from a rounded count.** `monthsBetween`
rounds to whole months, so a tranche that matured three days before the
as-of returns 0, and a `months >= 0` test reads it as upcoming. UHS's 1.65%
notes matured 2026-09-01 and the first draft rendered "0 months out" on
2026-09-04 — a matured, unrepaid obligation presented as a future one, which
is the single thing that line exists to get right. Past or future is decided
by comparing the dates; the month count is only ever how far. Both examples
are pinned as assertions in `lib/events/derived.test.ts`.

### Rule 29 — the liquidity line places two figures side by side and draws no ratio between them

The line first rendered available capacity as a percentage of the maturity —
"$1.900 billion of undrawn revolver capacity, 127% of this maturity". Wrong
twice. It implies **coverage**, a judgement this tool does not make; and it
divides **non-substitutes**, because a revolver is liquidity and is not how a
term maturity gets refinanced. A ratio between two things that do not
substitute for each other reads as an answer to a question nobody asked, and
the reader cannot tell it was the tool's arithmetic rather than the filing's.

So the line states the maturing tranche's amount and the undrawn capacity
with its own as-of date, and stops. It is the one derived line that computes
nothing by design, and it is still a derived line: it assembles two figures
from two separate disclosures onto one row, and the guard still holds both to
a source sentence. Applied book-wide and confirmed: **0 cards state a ratio
or coverage phrasing on the liquidity line.**

### Stage 5 findings — three, all surfaced by building the lines rather than by looking for them

1. **A third and fourth clock.** `app/page.tsx` called `buildEvents(results)`
   with no date inside a `useMemo`, constructing a fresh `new Date()` on
   every re-render while the surface displayed the `asOfDate` pinned when the
   run started. The Session 18 two-clocks defect, fixed inside the position
   layer and still live at the call site. **Fixed**: the pinned date is
   passed to `buildEvents`, to `assemblePosition`, and to the derived lines.
   `app/api/run/route.ts` has the same shape server-side (its own
   `buildEvents([result])` per company, for narration) — **not fixed**, it
   needs an as-of on the request, and it is latent rather than active since
   the clocks only diverge across a day boundary mid-run. Carried.

2. **Encompass's stated revolver availability appears in no sentence it
   cites.** `available: "$824 million"`, against a `sourceLine` reading "As
   of June 30, 2026, $200.0 million was drawn under the revolving credit
   facility with an interest rate of 4.9%." The derived guard withheld the
   liquidity line and named the figure; `checkRevolverArithmetic`
   independently reports the same revolver as not reconciling
   (200 + 46.3 + 824 = 1,070M against a stated $1B facility). **Two checks
   agreeing from different directions**, which is the strongest evidence
   shape this project has. The underlying cause is that a revolver's
   sourceLine is verified as a sentence while its individual amount fields
   are not verified against it — the same shape as the "amount not printed
   near its row" guard, one field over. Carried; the line withholds correctly
   in the meantime.

3. **A `redeems` claim can verify on a sourceLine that does not state the
   redemption.** Encompass's claim retires "4.50 % Senior Notes due 2028" and
   cites a sentence about issuing the 2034 notes. Verification checks that
   the cited sentence exists in the filing, not that it states the claim. The
   retirement is real (the note carries $396.9M against a prior $792.0M), so
   this is a weak-evidence finding rather than a wrong number. Carried, and
   deliberately not second-guessed by the derived layer — a line that
   overrode the pipeline's own verdict would be two surfaces deciding one
   thing.

---

## Carried to Session 22 — render items, both found at Stage 4

Neither is a wrong number. Both are facts the pipeline already holds and the
surface does not say, which is the same class as Stage 3's Tier 2 before it
was rendered.

**1. `proceedsUse` is classified for every company and rendered nowhere.** A
Sonnet call per company returns `refinancing_only` / `partly_unapplied` /
`unstated`, and the only consumer is card eligibility. UHS's issuance is
classified `refinancing_only` — its $1.1B of new notes are a refinancing —
and the refi surface shows two issuances ADDING $1.1B with nothing saying
so. **The surface never distinguishes a refinancing from net new debt**,
which for an RM is the difference between a call worth making and one that
is not.

**2. A drawn revolver shows no capacity line; an undrawn one does.** Measured
across the book: Tenet ($1.900B), CHS (ABL, no figure) and Molina ($1.25B)
each render a capacity line because nothing is drawn. DaVita ($65M drawn) and
Encompass ($200.0M drawn) render none — their drawn balance becomes a ladder
row and their available capacity, which the filings state, appears nowhere.
This is inverted from what matters: the headroom beside a drawn facility is
the live question, and the two companies that have one are the two that do
not show it.

**0. The as-of date becomes a required argument, everywhere.** Stage 5 found
the two-clocks defect at a *fourth* call site — `app/page.tsx` building events
against a fresh `new Date()` inside a `useMemo` while the surface displayed a
pinned one — and fixed it at the page level. Its server-side twin in
`app/api/run/route.ts` is still there. Patching call sites is the wrong shape
of fix: this is the fourth one found by accident. **The structural fix is to
make `asOf` a required parameter with no default** on `buildEvents`,
`assemblePosition` and everything downstream, so pinning stops depending on
any caller remembering to pass it. `buildDerivedLines` is already written that
way and is the model for the rest.

**3. The UHS revolver line and the amount-join** (carried from the Stage 4
diagnosis, unbuilt by decision). A repayment may be confirmed by one source
and sized by another, each verified independently, joined only on matching
instrument identity, never stitched across unverified text. Adding UHS's line
today would mean loosening a debt-removing field to gain a non-netting
render, and the rolled total's "EXCLUDES 1 that no filing confirms as done"
already states the incompleteness honestly. Also carried: the nominalization
widening (measure first — it admits Tenet's demotion sentence), and the XBRL
text-block anchor as the location fix for Cigna. Session 22 opens with a $0
pre-check: how many of the ten have a non-empty debt text-block tag.


---

## Session 21, Stage 6 — golden files, and what pins them

### Rule 30 — a golden file is pinned to its filing set, and a moved set is not a failure

A company's answer is a function of the documents it was built from, and
those change on their own. The filing-LIST cache carries a **24-hour TTL**
(`FILING_CACHE_TTL_MS`), deliberately, so a run picks up new filings within a
day. That means the corpus a golden file was signed against can move without
anyone touching the code.

It moved during this session, which is how the rule got its worked example.
Cigna read 4 rows and 0% coverage on 2026-09-03 at corpus fingerprint
`14a9ac9c`; on 2026-09-04 it read 6 rows and 3% at fingerprint `813c7d6b` —
both fully cached, both $0.00, no re-extraction. The list cache had expired,
EDGAR was re-pulled, and its 8-K window shifted. The failure reason changed
with it, from "the anchor's debt note yields no transcribable ladder" to
"every transcribed row was verified against a filing OTHER than the anchor,
so none states the anchor's own position" — a different and more precise
statement of the same underlying gap. Quest moved from 12 rows to 13 for the
same reason.

So the comparison is **filing set first**. Same documents in, same answer out
is the whole claim a golden file makes, and it makes no claim about a
different corpus. A moved set returns **not-applicable**, names the documents
added and removed, and says the pin must be re-signed against the new corpus
rather than compared against it. A stale pin has to read as stale; if it read
as red, the failures would be ignored within a week.

**Within a session, the book is stable**: two warm passes over all ten,
compared field by field, produced zero divergences.

### Rule 31 — divergence fails by name, and a golden file carries its own input

"The ladder changed" is not actionable. Every comparison names the field, the
expected value and the actual one — `rows["4.50% Notes due 2028"].amount:
expected "$396.9 million", got "$792.0 million"` — and a row that vanished is
reported as MISSING while a row that appeared is reported as UNEXPECTED,
because a pin that only catches shrinkage is half a pin.

A golden file commits the `CompanyResult` it was signed from alongside the
signed state. The offline suite re-derives from that captured input and
compares, so the golden check needs no network and no model call and is a
real regression test on the derivation layer — position assembly, coverage,
Tier 2, the derived lines — which is the layer that actually changes between
sessions. A live run's own filing set is checked against the same files in
the live path.

**Nothing is written without a signature.** The writer runs only under an
explicit `--sign`, with a named signer and a stated basis, and the suite
rejects a file carrying neither. A writer that ran by default would turn
"whatever the last run produced" into "the pinned correct answer" without
anyone looking, which is the opposite of what a golden file is for.


---

# Session 21, Stage 6 — the nine-criterion golden definition

## The definition (verbatim, and it goes into the BRD as written)

A golden file pins **one company's position as of one named anchor filing**
(period of report and filing date), and is written only when all nine hold:

1. every row's amount, maturity, and instrument correct against the filing;
2. every amount in the unit the filing prints and with its basis stated
   (face / carrying / outstanding);
3. every row cited to the anchor filing, or to a post-anchor 8-K for Tier 2;
4. the note's own subtotals tie;
5. stated total triangulates to the filer's XBRL tag, or is labelled
   model-read;
6. coverage passes both tests, category-complete and residual under
   threshold;
7. capacity separated and excluded from the debt sum;
8. structure faithful to the note in tranches, priority class, and instrument
   type;
9. Tier 2 events status-corroborated and source-verified, and the whole state
   reproduces on three independent re-asks.

**Cards and derived lines are never pinned.** Every criterion is a failure
this build actually had, and each is asserted by name in
`lib/events/goldenCriteria.ts`, with the defect it defends against recorded
beside it.

**Computed versus attested.** Criteria 1, 8c (instrument type) and 9b (three
re-asks) cannot be computed: a tool comparing its own output to itself proves
nothing about whether it matches a filing, which is the whole reason
verification sheets exist and a person reads them. Those three are ATTESTED,
recorded with who confirmed what and when. Pretending to compute them would
be false assurance on the one artifact that exists to carry confidence.

## Rule 32 — the section string is for arithmetic; the class string is for display; neither is structure

**Confirmed on request.** `section` is read in exactly four places —
`computeWalkChecksum`, `rowsOutsideSubtotal`, `computeBalanceSheetCheck`, and
subtotal display. Ordering is `maturitySortKey` alone. No priority class is
derived, normalized, or used for ordering.

**Correction to the Stage 6 brief:** a class string IS rendered.
`app/page.tsx:482` puts `LadderRow.seniority` — verbatim from the note's own
section header — on every ladder line as a prefix, and it is populated on
Tenet (10 of 12 rows: "Senior secured first lien notes", "Senior unsecured
notes") and DaVita (7 of 9: "Senior Secured", "Senior"). Quest, Centene and
Molina carry none on any row.

So Tenet and DaVita do not LOSE the class. What is missing is that it is
**unnormalized** (two filers, four different spellings), **incomplete** (2 of
12 and 2 of 9 rows carry none, which renders as an absence of seniority
rather than an absence of disclosure), carries **no instrument type**, and is
**not structural** — the ladder is one flat maturity-ordered list where the
note prints separate sections. The hold on criterion 8 stands on those
grounds. The Session 22 item is *normalize, complete, add type, make it
structural*, not *add the field*.

## Two findings that block writing, both reported rather than worked around

**A. Criterion 9b is not demonstrated for Quest, Centene or Molina.** Only
UHS has three independent CACHE_BUST re-asks. The two warm book-wide passes
run this session prove the PIPELINE is deterministic and say nothing about
the model — which is exactly the distinction Rule 23 was learned from. Under
the definition's own terms those three cannot be written yet.

**B. Criterion 4 excludes every prose-only filer, including the signed one.**
UHS's debt note prints NO subtotal — it is the prose-only worked example the
whole Rule 22 chain exists for — so "the note's own subtotals tie" cannot
hold for it, and the criteria evaluate its already-written golden file as
DOES NOT HOLD. This is a genuine tension in the definition, not a defect in
UHS: for a note with no printed subtotal there is nothing to tie, and Check 2
(balance-sheet anchor) and Check 3 (coverage, 2.28% residual) are what carry
the weight. Reported for decision rather than softened, because widening a
criterion to fit the one filer it excludes is precisely the move this project
forbids.

## Three smaller findings from the same pass

**1. Molina's revolver renders as a generic facility.** "Credit Facility,
capacity" — the amount is correct ($1.25 billion) and correctly held out of
the debt sum, but its TYPE is nowhere stated, and the note's own seniority
language sits unused inside the located span. The instrument-type half of
criterion 8, with a named instance.

**2. DaVita's "stated but not captured: revolver" flag is FALSE.** Its
revolver is on the ladder at $65,000,000. `categoriesMissing` builds "stated"
from `debtMaturity.revolver` and "captured" from prose-instrument categories,
so a revolver captured as a TABLE ROW carries category `table-row` and the
test cannot see it. It misfires on exactly the filers whose revolver is drawn
and tabulated — DaVita and Encompass, the only two in the book. Not a wrong
number; a wrong flag. Fix in Session 22.

**3. `amountBasis` is dropped when a prose instrument becomes a row.** It is
read by `debtContribution` to decide debt-versus-capacity and then discarded,
so the row a golden file pins — and the row the ladder renders — states no
basis, even though the extracted instrument does. Criterion 2 asks for the
basis to be stated; upstream it is, on the row it is not.

## The golden set as it stands

| company | disposition | why |
|---|---|---|
| UHS | **signed, criterion 4 in question** | prose-only note prints no subtotal |
| Quest, Centene, Molina | **held on 9b** | no three-re-ask reproducibility yet |
| Tenet, DaVita | **held on 8** | class unnormalized/incomplete, no type, not structural |
| HCA | **held on 8a and 5** | one aggregate line, no tranches; denominator model-read |
| Encompass, CHS | **held** | revolver amount fields verified as a sentence, not against it |
| Cigna | **held** | anchor unreadable; filer-directed roll-forward |


---

## Criterion 4, amended — and why the amendment is not a widening

As first written, criterion 4 read **"the note's own subtotals tie"**. Applied
to the book it declared the already-signed UHS golden file DOES NOT HOLD,
because UHS's debt note prints no subtotal at all — it is the prose-only
shape the entire Rule 22 chain exists for.

**A criterion that can never hold for a shape that really exists is not
strict; it is blind to that shape.** The amendment states what "subtotals
tie" always meant: a check that only exists where subtotals do. Where a note
prints none, the stated total triangulates instead — the balance sheet's own
captions against the filer's own XBRL tag — and Check 2 plus coverage carry
the weight.

And triangulation is the **stronger** tie, not the weaker one. A subtotal is
the note checked against itself. Triangulation is two independent statements
by the same filer agreeing. UHS: captions sum $4,851,847,000 against an XBRL
stated total of $4,851,847,000, to the dollar, with a 2.28% residual.

Recorded beside the criterion in `goldenCriteria.ts`, in the BRD at 8.8, and
asserted in both directions — `[5e]` that a prose-only note satisfies it by
triangulation, `[6d]` that with nothing to triangulate against it fails and
names which half failed.

## Rule 33 — a cost delta measures the wrong thing when the meter resets

The criterion-9b harness first measured each re-ask as
`spend_after − spend_before`. `beginCompanyCostScope()` resets the meter at
the start of every `runAgentLoop` call, so `before` held the PREVIOUS run's
total and every re-ask after the first reported **$0.0000** on a run that
had just billed real money. Nine billed re-asks would have been logged as
one.

The meter after a run IS that run's cost. Reconciled from
`baselines/cost-log.jsonl`, which `runAgentLoop` persists per company and
which was right all along: **$1.2889 across nine billed re-asks** (Quest
$0.5052, Molina $0.4693, Centene $0.3144), against a declared $1.90–2.20.

A wrong number in a cost log is worse than no cost log: Rule 20 exists so
Rule 13 can be checked afterwards, and a log that under-reports by two thirds
defeats both.

## Criterion 9b — nine re-asks, all reported

| company | re-asks | verdict | spend |
|---|---|---|---|
| Quest Diagnostics | 3 | **3/3 reproduces** — all nine hold | $0.5052 |
| Molina Healthcare | 3 | **3/3 reproduces** — all nine hold | $0.4693 |
| Centene Corporation | 3 | **VARIANCE — does not golden** | $0.3144 |

**Centene's variance, stated exactly, because it is not what it looks like.**
Its position reproduced perfectly across all three: eight rows, the same
instruments, the same figures, captured $16.179B against stated $16.105B,
residual 0.00%, on every re-ask. Two things diverged:

1. **Whitespace in the amount string.** Re-ask 1 returned `"$1,067 million"`
   where re-asks 2 and 3 returned `"$ 1,067 million"` — on all eight rows.
   Same value, same unit, a different space after the dollar sign.
2. **The filing set moved mid-measurement.** Re-ask 3 saw one document more
   than re-ask 1: the 24-hour filing-list TTL turned over DURING the run, so
   the comparator correctly returned *not-applicable* rather than a
   divergence.

Under the rule as given — three-for-three or it does not golden — **Centene
does not golden**, and that is the disposition taken. Neither cause is a
position error, and neither is silently normalized away: the comparator
compares amount strings exactly, deliberately, because "copy what is printed,
in the form it is printed" is the em-dash lesson. Whether an amount should be
compared by parsed value plus printed unit rather than by exact string is a
real question and it is a Session 22 question, not a thing to change while a
signature is being written against the current behaviour.

## Session 21 — close-out

**Golden set: UHS, Quest, Molina.** Three of ten pinned, each satisfying all
nine criteria, each carrying its own signature, attestation and criteria
evaluation.

**Held, every one mapping to a Session 22 item:**

| company | held on | Session 22 item |
|---|---|---|
| Centene | 9b — whitespace variance, corpus moved mid-run | amount comparison semantics |
| Tenet, DaVita | 8 — class unnormalized/incomplete, no type, not structural | semantics item 1 |
| HCA | 8a and 5 — one aggregate line, model-read denominator | roll-forward item 3 |
| Encompass, CHS | revolver amount fields verified as a sentence, not against it | reading item 6 |
| Cigna | anchor unreadable | roll-forward items 3 and 4 |

**Rules added this session: 25 through 33.** 25 unsized events, 26 rows
outside the subtotal, 27 derived lines, 28 refinancing dated by its issuance,
29 the liquidity line draws no ratio, 30 a golden file is pinned to its
filing set, 31 divergence fails by name, 32 the section string is for
arithmetic and the class string for display, 33 a cost delta measures the
wrong thing when the meter resets. Plus the Rule 24 corollary and the
criterion 4 amendment.

---

# The card review — read as an RM, after Session 21 closed

Four cards, Tenet / Encompass / Quest / Centene, read against their filings
the way a relationship manager reads them rather than the way a test reads
them. Wording cache hit 4/4, nothing drafted, **$0**.

**The facts all hold.** Every figure on every card traces to a verified fact,
every clause has a source sentence, and there is no wrong number anywhere in
the four. That is the checkable half, and it passes.

**The stories are weak on three of four, and it is one root cause.** The tool
knows *what each number is* and does not know *what it is for*. A revolver is
found only when it is drawn, because being drawn is what puts it in a table.
A term loan sits on the ladder with no maturity, so the one instrument a
relationship bank most wants to talk about never cards. Cash growth becomes a
reason to call. An at-maturity repayment reads as early refinancing. None of
those is an extraction failure — each is the absence of a semantics layer
that says what an instrument is and what a fact is evidence of.

## What the review found, and where it went

Nine items, all logged in **BRD 13.2d** as rules over the class with the named
company as worked example only. Ordered there by dependency:

| # | item | layer | order |
|---|---|---|---|
| 9 | render hygiene — leaked eligibility reason, house number format, plurals, month convention | render | **first, $0** |
| 1 | facilities located by their own content, every field verified, arithmetic checked | semantics | then |
| 2 | facilities carry a maturity and card like a bond | semantics | then |
| 3 | liquidity is cash + undrawn, computed, one figure | semantics | then |
| 4 | a drawn balance is operational and never a refi signal | semantics | then |
| 7 | use of proceeds is an array | one-slot class | with the others |
| 5 | cash is never a refi rationale on its own | analysis | after goldens |
| 6 | read the kind of retirement, not only its date | analysis | after goldens |
| 8 | a verified event on the card's own tranche *is* the why-now | analysis | after goldens |

**Item 1 supersedes and absorbs two carried items.** 13.2c item 6 (revolver
amount fields verified as a sentence rather than against it) is the
verification half of item 1's per-field rule. 13.2c item 8 (a drawn revolver
shows no capacity line, an undrawn one does) is the same defect from the
other direction — both are consequences of locating facilities by their
balance row instead of by their own content. Recorded rather than left as
three items that would be fixed once and closed three times.

## Two things worth stating precisely

**The Quest line is not an arithmetic error, it is a semantic one.** The card
reads *"refinanced 1 month ahead"*. The dates are right: Quest issued
2026-05-06 against a 2026-06-01 maturity. The filing's own sentence says
*"repay in full **at maturity**"*. Pre-funding a maturity by 26 days and
taking a bond out 21 months early are opposite behaviours, and the line
renders them in the same words with only the number differing. The fix is a
closed grammatical class on the retirement sentence, the same shape as the
tense gate — not a change to the arithmetic.

**Encompass's "20 months" is a convention that was never named.**
`monthsBetween` divides elapsed days by 30.44 and rounds — the same
approximation behind Rule 28's second worked example. 2026-05-29 to
2028-02-01 is 20 months and 3 days by anniversary counting and 21 months by
month-boundary counting; the code prints 20. Neither reading is wrong and
that is the problem: nothing states which one the surface means. Calendar
arithmetic against a named convention, stated once.

## Parked, explicitly not Session 22

Deriving a month from a stated range floor where a single note uniquely
occupies it (Tenet, November 2027), and "already refinanced" verbiage on a
tranche partly taken out (Encompass). Low value against a new failure
surface, and neither before the 40-name run.

**Session 21 stays closed.** Nothing here changes what was built, signed or
pinned; the golden set is still UHS, Quest, Molina.

## Rule 34 — a cost guard reads whether a call will bill, never detects that it did

Session 22, Stage 1. A measurement stage declared $0 asserted the cost meter
*after* each company:

```ts
const result = await runAgentLoop(company);
const cost = currentCompanySpend().totalUsd;
if (cost > 0) { console.error("ABORT — this stage is declared $0"); process.exit(1); }
```

That is not a guard. It is a receipt. Tenet's answer cache had gone cold
overnight — a new pricing 8-K entered its catalog on 2026-09-08 and moved the
corpus fingerprint — so the run re-asked the model and billed **$0.1759**
before the check fired. The abort limited the damage to one company and
prevented none of it.

The guard a $0 stage needs asks the question BEFORE the call, from inputs
that are themselves free. Every ingredient of the answer-cache key already
is: the filings catalog is cached EDGAR metadata, and the prompt version is a
constant. So the key can be built and READ — `readCache(baseAnswerKey(cik,
corpusFingerprint(filings)))` — and a miss reported as "this would bill"
rather than discovered as "this did".

`lib/cache/s22warmcheck.ts` is that check, and every measurement harness now
runs it first and skips what is cold by name. The post-hoc meter assertion
stays underneath as a second line of defence, which is what it always was.

**The corollary, which is the part worth carrying:** a cold cache is not a
fault, it is news. A miss means the filing catalog moved — a new document
exists that this company has never been extracted against. Reporting it as
an error to be suppressed would have thrown away the most useful thing that
happened that day, which was that Tenet had announced the takeout of the
exact tranche the demo opens on.

### Related: a naming defect this session demonstrated on itself

`GoldenState.residualFraction` holds a **percentage**. `golden.ts:139` writes
`cov.residualFraction * 100` into a field whose namesake on `CoverageResult`
is a true fraction. Two fields, one name, different units — Rule 21's exact
shape. It bit within minutes: the re-signature packet applied the fraction
convention and printed UHS's 2.28% residual as **228.00%**. Reported rather
than quietly divided, because the fix is a rename that rewrites the pinned
files and those are only ever written on a signature.

## Rule 35 — a figure is verified against the sentence that states IT, never against a sentence that came with it

Session 22, Stage 3. Session 20 gave the revolver four figures and ONE
`sourceLine`, and verification checked that single sentence. So a figure was
accepted because a *different* figure's sentence was found in the filing.

Encompass is the measured cost. v28 returned size $1B, drawn $200.0M, LCs
$46.3M and available $824M, all resting on:

> "As of June 30, 2026, $ 200.0 million was drawn under the revolving credit
> facility with an interest rate of 4.9 %."

That sentence states the drawn figure and none of the other three. The
$824 million was a real-looking number attached to a real quote by nothing at
all — the composite-fabrication class in its purest form, and worse than a
wrong number because every visible sign of provenance was present.

**The rule:** every extracted figure carries the sentence stating that
figure, and is verified against it independently — (1) the sentence appears
in a filing this answer cites, and (2) the sentence contains the figure's own
discriminating digits. Both, or the figure is dropped and the reason
recorded.

**A rejected figure never erases its instrument.** A facility whose size
verifies and whose availability does not is a real facility with an
unverifiable availability, and renders that way. Deleting the facility to
avoid rendering the gap would suppress a verified instrument to hide an
unverified number — Rule 3, and the opposite of what a refusal is for.

**And the arithmetic is reported, never repaired.** A figure that would make
`drawn + LCs + available = size` reconcile is still rejected when the filing
does not state it. A check that can be satisfied by inventing its own input
is not a check. Pinned as `[5a]` in verifyFacility.test.ts.

**Corollary, learned the same day: a missing component means no conclusion.**
The first draft treated an absent letters-of-credit figure as zero and
printed "DOES NOT TIE" on a gap the filing never stated. We cannot tell "there
are no letters of credit" from "they are not stated here" — Rule 10 — so an
incomplete set is *not checkable*, and says which part is missing.

### What it caught on its first live run

Seven rejections across two companies, and **all seven confirmed fabricated**
by checking each sentence against every fetched document:

- **Quest, six.** Including `$600 million` receivables facility size,
  `April 2030` revolver maturity and `$750 million` facility size — sentences
  that read like Quest's 10-K, which is not in that run's fetched set. The
  figures are plausibly true of Quest in the world. They are not in these
  filings.
- **Encompass, one.** `$1 billion` facility size, from *"In summary, the 2026
  Credit Agreement provides for a revolving credit facility of $ 1 billion…"*
  — present in none of its four documents, 10-K included.

Zero false refusals. The failure mode the guard exists for is a model
reconstructing what it KNOWS about a company instead of copying what the
document in front of it SAYS, and every instance was reconstruction.

**And the withheld figure was not merely unverifiable — it was wrong.** With
the liquidity section in view, Encompass's own 10-Q states *"approximately
$746 million available to us under our revolving credit facility"*. v28 had
printed $824 million. The refusal that looked like the tool being unhelpful
was the tool declining to publish an incorrect number.

## Rule 36 — a golden file pins a derivation, so it also pins the schema that derivation reads

Rule 30 settled that a moved FILING SET makes a golden file not-applicable
rather than failed: the pin claims "the same documents in, the same answer
out", and different documents are a different question.

A moved SCHEMA is the same event. A golden file's `sourceResult` is a
captured input, and when extraction changes shape, the same bytes answer a
different question: v28 results carry one `revolver` object where v29 code
reads a `facilities` array. Measured on the signed UHS file — its revolver
read as capacity instead of debt, captured face fell $225M, and the residual
went 2.28% to 6.92%, taking coverage from pass to fail.

Nothing regressed. Reporting that as a divergence would have sent a reader
hunting for a bug in code that was working, which is worse than saying
nothing — the same reason Rule 30 exists.

**The rule:** a golden file records the extraction version its input was
captured at, and a comparison across versions returns not-applicable, names
both versions, and says to re-sign against a fresh capture.

## Rule 37 — "the filing does not say X" may only be concluded from a corpus that was loaded

Session 22, Stage 3. Six occurrences, and the sixth stopped being a reporting
defect and started deleting instruments:

1. Session 21's check sheet — one failed `getFilingText` rendered six HCA
   facts as unplaceable.
2. `categoriesMissing`, misfiring on drawn-and-tabulated revolvers.
3. `factsReferencedIn`, attributing on any-token match.
4. Stage 0's probe — totals divided by ten while one company was never
   fetched.
5. `checkWarm` — a blob read that THREW became `warm: false`, which every
   caller read as "cold, this would bill".
6. `verifyFacilities` — checked each sentence against the model's
   self-reported `citedUrls`. Centene reported none. The check ran against
   nothing, rejected all eight of its facility figures, and **deleted every
   credit facility a real company has** — six of those sentences being
   verbatim in Centene's own anchor 10-Q.

Each was found, each was fixed in place, and none of the fixes fixed the
class — because the class is a SHAPE, not a bug. A function that answers
"is X in here?" with yes/no cannot express "I could not look", so every
caller silently reads the second as the first. Writing the note down five
times did not help: occurrences 4, 5 and 6 were each written days or hours
after the previous one was logged, by someone who had just read the note.

**The rule:** a lookup over documents returns THREE outcomes — present /
absent / undetermined — and `absent` is unreachable unless the corpus was
fully loaded. A partially loaded corpus can still confirm PRESENCE (one
document suffices) and still cannot conclude absence (the missing sentence
may be in the one that failed). `lib/agent/corpus.ts` is the primitive; every
guard and probe that asks a document a question routes through it, and a
caller cannot reintroduce the defect without deleting code.

**The corollary about scope, learned in the same hour:** the corpus a claim
is checked against must be the corpus the model was SHOWN, never a list the
model supplied about itself. `citedUrls` is a self-report; using it as the
denominator of a verification makes the model the judge of its own evidence.

**And it caught me twice more while being fixed.** Both throwaway probes
written to diagnose occurrence 6 built their document sets from citations,
loaded zero documents, and dutifully reported every sentence as "ABSENT —
the guard is right". I nearly reported both. The verdicts they produced were
retracted: Quest's six "fabrications" were checked against four documents
instead of its catalog, and Encompass's one was real. What made this
recoverable was printing the corpus size next to the finding — `fetched:`
empty is visible in a way that a wrong conclusion is not.


## Rule 38 — a group statement reaches only what its own words scope, and a normalized label is not those words

Session 22, Stage 3 (finish). The debt note's group seniority sentence —
"Each of these notes are senior unsecured obligations" — was extracted and
verified at v29 and nothing consumed it, so Molina's ladder went on reporting
"class not stated on this row" six times over a sentence sitting in its own
note. Wiring it in took three passes, and each failure was the same mistake
in a different place: **reading a sentence as if every word in it were about
its subject.**

**1. The class a seniority sentence asserts is not the only class it names.**
A ranking sentence names what is above and below its subject by construction.
Measured on the three the book actually contains, a whole-sentence match is
wrong on one:

  UHS  "...guaranteed on a SENIOR SECURED basis by all of our ... subsidiaries
        that guarantee our Credit Agreement, other FIRST LIEN obligations, or
        any JUNIOR LIEN obligations."

The lien classes belong to the GUARANTORS. Because the class patterns are
ordered most-specific-first, a whole-sentence read returns `first-lien` for a
senior secured instrument — two notches wrong, in the unsafe direction, on a
demo name. So the class is read from the sentence's HEAD, the span before the
first connective that hands the sentence to a new subject, and the head must
name exactly one class or the sentence classes nothing.

**2. A normalized type label cannot serve as scope identity.** The first
wiring asked whether the row's `InstrumentType` equalled the scope's. That
type maps every line containing "notes" to `senior-note`, so Encompass's "the
Senior Notes" reached its **"Other notes payable"** line — a residual
catch-all for acquisition and miscellaneous notes, and emphatically not one of
the four tranches the sentence describes. **This is Rule 35's failure in the
class column:** a real sentence and a real row, joined by nothing. Rule 35
caught it for figures; nothing was watching the same join in prose.

The fix compares the filer's own words on both sides: every significant word
of the scope phrase must appear in the row's own name. "senior" is in the
scope phrase and in all four tranche names and is not in "Other notes
payable". Molina's "Each of these notes" covers its five note rows and does
not cover its Credit Facility, on the same ladder under the same note — so
five of six clear and the sixth does not. **Widening the scope so all six
clear would have been the rule bent to fit the instance**, and the instance
was the one explicitly asked for.

**3. The refusals must not swallow the assertion.** Encompass writes its class
as "senior, unsecured obligations" — with a comma — which fell past the
specific pattern onto bare `senior`, reporting "security not stated" about a
sentence containing the word "unsecured". That is Rule 1's inverse: Rule 1
refuses to infer unsecured from the ABSENCE of "secured", and this refuses to
ignore it when it is present. Normalizing punctuation between two coordinate
adjectives is the same kind of change as matching case-insensitively, and it
was proved inert against all 172 row names and headings in the book before it
was kept.

**The rule:** a statement about a group is evidence about exactly the members
its own words name, read from the span that is still about its subject. Where
either the scope or the assertion is ambiguous, the row keeps "class not
stated on this row" — the failure direction is always toward not stating, and
never toward a class the row was not shown to have.

**And the corollary that found two of the three:** none of these was found by
reasoning about the rule. Each was found by re-measuring **the whole book**
after the change and reading the rows that moved. The wiring was asked for on
one company; two of its three defects were on other companies, one of them a
demo name.

## Rule 39 — two fields for one idea do not stay in sync; the model decides which one to fill, per company

Session 22, Stage 4. Rule 21's shape, found in the extraction schema and
costing the demo opener.

The debt-note schema carried the same idea twice: `section` ("the note's own
section heading it sits under") and `seniority` ("verbatim from the debt
note's own section header"). Same source, same words, two fields, because one
was added for the checksum's grouping and the other for the class label.
Measured at v29 across all ten companies:

```
section only        26 rows   Tenet's 10, DaVita's 9, and others
seniority only       8 rows   all CHS
both, DISAGREEING    4 rows   all Encompass
both, agreeing       0 rows
```

**Zero rows agree.** The model does not duplicate a value into two fields; it
picks one, and which one it picks changes per company. So every consumer
reading one field is wrong somewhere, and no choice of field is right.

**What it cost.** The classifier read `seniority`. Tenet's class landed in
`section`. Ten rows whose class the filing prints directly above them —
"Senior secured first lien notes:", "Senior unsecured notes:" — rendered
"class not stated on this row", the ladder had nothing to sort by, and the
demo opener degenerated into the flat list the whole semantics layer exists to
replace.

**And it was misdiagnosed first.** The Stage 4 gate reported "Tenet has lost
its section headings at v29", three CACHE_BUST re-asks returned 0/11 every
time, and that was read as a systematic extraction regression needing a prompt
fix and a version bump — roughly $1.8 of re-extraction. The measurement was
correct and the conclusion was wrong: 0 of 11 in the field being counted, 10
of 11 in the field next to it. **The model had been reading the heading the
whole time.** What saved the spend was checking the sibling field before
buying the fix, and the tell was that `section` is the field the CHECKSUM
depends on — a field load-bearing for arithmetic does not silently empty.

**The rule:** one idea, one field. Where two fields already hold one idea,
every reader merges them into one ordered input rather than choosing between
them — a heading that names no class costs nothing, which is what makes
merging safe and choosing unsafe. And before paying to re-extract a "missing"
field, read every other field that could hold the same thing.

**Corollary — a gate assertion must not demand a violation.** The gate's first
form required a class on EVERY Tenet row, which would have demanded one for
"Finance leases, mortgages and other notes" — printed outside both sections,
with no class stated anywhere. Rule 1 forbids inventing it. The assertion was
rewritten to the honest condition: no row whose filing STATES a class is left
without one, checked by re-reading the sources for each unclassed row.

## Carry items — open, diagnosed, deliberately not fixed in Session 22

1. **`capturedFace.test.ts` — DaVita, thousands-table units.** Captured face
   $10.848B against a stated $10.781B; a table stated in thousands still reads
   as thousands. Pre-existing, confirmed unrelated to the Stage 3/4 work (fails
   identically with those changes no-opped). Its own item — audit or Session 23.

2. **`PRIORITY_CLASSES` orders `junior-priority-secured` ABOVE
   `senior-secured`.** Found while merging the class sources. With the
   cross-source refinement applied, CHS's senior-priority notes resolve to
   `senior-secured` (rank 3) and its junior-priority notes to
   `junior-priority-secured` (rank 2), so its ladder still renders the junior
   tranches first. A junior lien on the same collateral ranks BELOW a senior
   one; the stack order is wrong. Pinned as-is by assertion `[9e-known]` in
   instrumentClass.test.ts so that fixing it breaks loudly there rather than
   silently re-ordering a ladder. CHS is not a demo name, and folding an
   unrelated re-ordering into a targeted fix is how a targeted fix stops being
   reviewable.

### Dispositions, recorded at the Stage 4 boundary

**Rule 20 note — an estimate sized off a partially-cached log line understates.**
The Stage 4 declaration put UHS at $0.1309 per CACHE_BUST run, taken from its
v29 cost-log entry. It ran $0.2035, ~55% high, because that v29 entry was
itself partly a cache hit and so recorded less than a cold ask. Tenet and
Encompass, whose v29 entries were fully cold, matched their declarations
exactly. A cost line is only a basis for a cold-run estimate if the run it
came from was itself cold — otherwise the declaration under-promises the
spend it is supposed to bound.

**Carry item 2 (junior-above-senior) is required before the 40-name run.**
Not merely an audit tidy: junior debt rendered as more senior than senior debt
is visible, backwards, and wrong on screen, and it reaches every filer with a
split-lien structure. Stays pinned by `[9e-known]` in the meantime so it
breaks loudly rather than quietly re-ordering a ladder. CHS is not a demo
name, so it does not block the demo — it blocks the widening.

**The v30 schema collapse is an audit item, not a pre-demo bump.** Collapsing
`section`/`seniority` into one field (so the concept cannot re-split) and
scoping the prose statement per row (retiring the unresolved "these notes"
reading) are both recurrence-prevention: the merge already fixed the symptom,
and neither changes anything an RM sees. A bump that changes no output does
not earn a pre-demo re-extraction. "No two fields for one concept" is exactly
the shape of an audit cleanup.

## Rule 40 — a facility matures like a bond, and the ladder must carry the date the filing states for it

Session 22, Stage 5. Measured before anything changed: **18 facilities, 16
stating a maturity, and 5 whose ladder row carried one.** Eleven committed
obligations with dates the filer printed, invisible to every gate that reads a
maturity.

Centene is the named case — its facility states March 5, 2030 and its ladder
row stated nothing — and Quest is the one it cost: its secured receivables
credit facility matures **November 2027, thirteen months out and inside the
refinancing window**, and carded nowhere at all. The strongest conversation on
that name did not exist, because an undrawn facility has no balance to
tabulate and therefore had no line in the debt note to hang a date on.

**Three refusals make it safe, and each was earned:**

*A stated maturity is not always a date.* HCA's facility says "five years";
UHS's says "364 days after funding". Both are real disclosures measured from
an event the filing does not date here. They resolve to `relative`, never to a
date, and never to "no maturity stated" — which would be false about the
filing. Three outcomes, the same reason `corpus.ts` has three.

*Only where the row states none.* A maturity the debt note itself prints is
never overwritten by the liquidity section's. The note is the position.

*Only an unambiguous match, and only to a facility-shaped row.* This one was
caught writing wrong dates onto real instruments. `matchFacility`'s last
resort is a CATEGORY fallback — right for its original caller, whose row was
already known to be a revolver, and catastrophic asked of every row: any
company holding one revolver matched ALL its unmatched rows. **DaVita's
"Acquisition obligations and other notes payable" took the revolver's November
24, 2030, and CHS's "Finance lease and financing obligations" took June 5,
2029.** The gate is now structural — the row's own `instrumentType` must be a
facility type — plus name-only matching, and the fallback is opt-out.

**The rule:** a committed facility is an instrument on the ladder, carrying
the maturity its filing states and nothing else. It renders whether or not it
is drawn; it contributes nothing to any total; and it cards on its own
maturity.

### The revolver-semantics correction that came with it

"Capacity never cards" was written about a BALANCE and was being applied to
the INSTRUMENT. A drawn balance is operational and is never a refinancing
signal — a revolver is borrowed and repaid in the ordinary course. The
facility's own expiry is a different conversation entirely, and the rule was
swallowing it. Capacity is now held back only where there is no in-window
maturity to talk about, and nothing downstream reads a drawn balance as a
reason.

### Liquidity is computed, not juxtaposed

The old line was never a liquidity figure: it was ONE facility's headroom,
chosen because the schema had one slot, and it silently said nothing for the
four filers carrying several. Liquidity is now cash plus undrawn capacity
across every facility, one sum, **with both halves as-of dated and the dates
required to agree** — a total summed across two dates is true at neither,
which is the mixed-clock error the anchor rules exist to prevent. Never
derived from size minus drawn: that subtraction is exactly the
computed-not-read figure the facility guard rejects.

### Read the kind of retirement, not just its date

"Refinanced N months ahead of maturity" is a claim about behaviour — the
company went to market early, before it had to. Quest's filing says the
opposite in as many words: proceeds "were used to repay **in full at
maturity** the outstanding indebtedness under the 3.45% Senior Notes due June
2026". The arithmetic was not wrong; the word for it was. A closed
grammatical class of timing words — the same standing as `SCALE_WORDS` and
`PARTIAL_REDEMPTION_RE` — now makes that line read "pre-funded and repaid at
maturity", and no month count is printed, because the count is the thing that
would be misread.

## Rule 37, seventh occurrence — the redemption guard

Found while chasing why Quest's pattern line said "no verified redemption in
this corpus" about a company whose filing states one in plain words. The
redemption verifier asked whether the sentence appears in a filing **the model
said it cited**:

```
const verified = !!claim.sourceLine && (v.citedUrls ?? []).some(...)
```

Quest's sentence is real, verbatim, in a filing the run fetched, and was
marked UNVERIFIED because it was not in the model's own citation list. This is
the guard that decides whether a claim removes debt from the ladder.

Routed through `corpusOf(textByUrl)`. Widening a denominator can only turn
"unverified" into "verified", and a verified claim can retire a tranche — so
this is the direction that needed measuring rather than assuming. Measured
across all ten: **every previously-unverified claim is now verified, zero
"could not be checked", and no tranche was newly retired**, because the
claims that changed state are all `intended` and the corroboration gate still
holds them on the ladder.

## Rule 41 — a rising count is not correctness; read the rows, not the total

Session 22, Stage 5. Caught in my own change, one step before it shipped.

Applying facility maturities to ladder rows, the summary count moved exactly
the way success looks:

```
before   5 of 16 facilities' ladder rows carry a maturity
after   15 of 16
```

Ten rows gained a date, the gap list shrank from eleven to one, and every
number on the report improved. The per-row output said something else:

```
DaVita  "Acquisition obligations and other notes payable"  maturity=2030-11-24
CHS     "Finance lease and financing obligations"          maturity=2029-06-05
UHS     "Financial liabilities from failed sale leaseback" maturity=2029-09-26
```

Those are not facilities. `matchFacility`'s last resort is a CATEGORY
fallback — "if exactly one facility has this category, it is the match" —
which is correct for its original caller, whose row was already known to be a
revolver, and catastrophic when the question is asked of every row on a
ladder: any company holding one revolver became the match for ALL of its
unmatched rows. The count rose because wrong answers count the same as right
ones.

**The rule:** a metric that only moves in the direction of success cannot
detect a change that is wrong in the same direction. Every count reported here
is a count of rows, and the rows are what gets read before the count is
believed. This is the third time in Session 22 that reading the individual
rows caught what the summary hid — the others being the Molina wiring (two of
its three defects were on other companies) and Tenet's "lost" section headings
(0 of 11 in the field being counted, 10 of 11 in the field beside it).

**Corollary, and it is the practical form of the rule:** when a change makes a
number better, the check is not "did it improve" but "name the rows that
changed and say why each one is right". A count cannot answer the second
question and a row list cannot avoid it.

## Rule 42 — a guard corpus built by reflection covers only the field TYPES it reflects over

Session 22, Stage 5, item 4. The same repeat-offender class as `citedUrls`
(Rule 37) and measured-vs-unreachable: a check that silently answers a
narrower question than the one it appears to answer.

`factOwnText` builds the corpus that decides what a card may state, by walking
every field on a `VerifiedFact`:

```ts
for (const [key, value] of Object.entries(f)) {
  if (typeof value === "string") parts.push(value);
  else if (Array.isArray(value)) for (const item of value) ...
}
```

Strings and string arrays. **An object-valued field is skipped without a
word.** `trancheEvent` is one, so the moment it reached the prompt, the model
was shown Centene's own repurchase sentence and then rejected for stating the
figures in it:

```
stated a number, rate, or date not found in any given fact ($ 118 million, $ 1,147 million)
```

**Rule 6 inverted.** Rule 6 says a field the model is shown must be a field the
guards can see; this is a field the guards could not see reaching the model
anyway, and the failure mode is worse than a leak — the card does not render
at all, and the reason names the filer's own figure as unverifiable.

**And the assertion written to catch exactly this passed the whole time.**
`narrationIntegrity.test.ts`'s coverage probe compares what `formatFact` shows
against what `factOwnText` returns, sentinel by sentinel. It set
`trancheEvent: null`. **A null field renders nothing, leaks nothing, and
proves nothing** — the probe could only test the fields it populated, and a
newly added field defaults to null in a fixture like any other. So the guard
that exists to prevent this class was structurally incapable of seeing the
newest instance of it.

The probe now populates the field, and the fix was confirmed by deliberately
re-breaking `factOwnText` and watching it fail (`leaked:
trancheEventEvidence`) before restoring it. **A coverage assertion that has
never been seen to fail is not known to work.**

**The rule:** a guard corpus assembled by reflection must reflect over every
field TYPE the surface can carry, and its coverage test must populate every
field — because both the corpus and the test degrade silently and in the same
direction. Named explicitly rather than fixed by a generic nested walk here: a
generic walk would sweep in `sourceFiling.url` and every citation's metadata,
quietly widening what a card may assert. **Audit item: make the corpus
type-complete by construction rather than by enumeration.**

### The cost, and it is v13's lesson billed twice in one item

`promptVersion.ts` already records, at v13: "A guard and the instruction it
enforces are one change." This item repeated it twice — the instruction
shipped, the distinctness corpus was left behind ($0.17 of failed
narrations), that was fixed and the accuracy corpus was left behind ($0.20).
Total $0.6620 against a declared $0.30–0.60.

What ended it was refusing to keep guessing: the guard was reproduced
**offline, at $0**, against a hand-written candidate why-now, and named the
cause on the first try. A structural check that can be run without the model
should be, before any run that bills.

## Carry item 3 — Quest's facility card cannot narrate

`1 keyPoints bullet(s) name more than one interest rate` — the
one-instrument-per-bullet rule (v13), met by a card that **did not exist until
Stage 5 created it**: Quest's secured receivables credit facility, maturing
November 2027. Correct behaviour, not a regression — the card fails LOUD
rather than rendering something wrong, and no card lost a why-now it had
before. It is the only card in the book without one. Stage 7 or audit.

## Rule 43 — a cost meter read before the calls it should cover is not a cost figure

Session 22, Stage 5 close. Found twice in one hour, in my harness and in the
product, and they are the same defect.

**In the reproducibility harness.** It read `currentCompanySpend()`
immediately after `runAgentLoop` and BEFORE its own narration loop, so three
demo names reported "$0.0000" for runs that billed $0.2230. The number was not
wrong about extraction; it was answering a narrower question than it appeared
to answer — the same shape as `citedUrls` (Rule 37) and as `factOwnText`'s
string-only reflection (Rule 42).

**In the product, and this one persists.** `persistCompanySpend()` is called
at the end of `runAgentLoop` (lib/agent/loop.ts). Narration runs AFTER
`runAgentLoop` returns, records into the same company scope via `recordUsage`,
and nothing persists again. So **`baselines/cost-log.jsonl` is an
extraction-only record**: it reported $3.7049 for a session that had actually
spent $4.5899, understating by the entire $0.8850 of Sonnet narration.

This matters beyond bookkeeping. Rule 20 exists so per-company cost is a
persisted fact rather than a remembered one, and every cost estimate in this
session is sized off that log — including the Stage 4 declaration, whose UHS
line was already known to understate for a different reason. An estimate drawn
from a log that cannot see narration will always under-promise a run that
narrates.

**The rule:** the meter is read, and persisted, after every call a run will
make — not after the phase that happens to own the meter. A cost guard reads
whether a call WILL bill before it happens (Rule 34); a cost RECORD covers
everything that did. **Audit item: persist after narration, and backfill the
log's meaning in the docs so past figures are not read as totals.**

## Carry item 4 — the presentation still does not reproduce, and that is known

CACHE_BUST x3 on the three demo names, with the card bodies captured for the
first time:

```
ladder      identical across all runs, all three names
card wording  MOVED between runs (Tenet, Encompass)
why-now       no run rests on a balance, all three names
```

Session 21 established this in as many words — "the position reproduces, the
presentation does not" — because determinism here comes from the WORDING
CACHE, not from the model: re-ask Sonnet and the verb moves ("Refinance" /
"Redeem" / "Refinance", and one run adds "16 months out"). Nothing regressed;
the run simply measured the presentation layer for the first time, which the
earlier Stage 4 repro did not.

What v10 promised does hold across re-asks: **the REASON is stable even where
the wording is not.** Every Tenet run cites the September 8, 2026 pricing;
every Encompass run cites the $400 million par redemption; none of the six
why-nows rests on a balance. That is the right level for the claim, and
byte-identical narration was never the promise.

**A counting artifact, recorded so it is not mistaken for a finding:** the
harness's substance counter splits card records on " :: " and mis-scored
Encompass as 2 why-nows across 3 runs. Direct inspection shows 3 of 3
narrated, none failed. The counter is unreliable and its output was discarded
rather than reported.

## Carry item 5 — the headline VERB is the call, and it is currently generated

Session 22, Stage 5 close. Across three CACHE_BUST re-asks, Tenet's callAbout
moved:

```
run 1   REFINANCE the $1.5 billion 5.125% senior secured first lien notes due November 2027.
run 2   REDEEM    the $1.5 billion 5.125% senior secured first lien notes due November 2027.
run 3   REFINANCE the $1.5 billion       senior secured first lien notes due November 2027.
```

Dropping the coupon between runs is presentation, and this codebase has
already decided presentation may vary. **"Refinance" and "redeem" are not.**
They are different actions: one raises new money against a maturity, the other
retires the tranche with money already in hand. The headline verb IS the call,
and an RM who opens on the wrong one is describing a transaction the company
is not doing.

So it belongs where every other meaning-bearing decision in this pipeline
already lives — computed from a classified fact, not generated per run. The
tranche's own event already carries what is needed (`trancheEvent.kind`, plus
the redemption/issuance fields the position layer has verified): a stated
redemption reads "redeem", an issuance whose proceeds replace the tranche
reads "refinance", and a tranche with no event stated keeps whatever neutral
form the absence supports. Same move as the priority class, the month count
and the liquidity sum: take the decision out of the model's wording and leave
the model the sentence around it.

Small, and it makes the one word carrying the call deterministic. **Stage 7 or
audit.** The rest of the card wording stays model-generated and is expected to
vary.

## Rule 44 — the citation is the document the quote was found in, not the one the model named

Session 22, Stage 7. The fourth occurrence of Rule 37's corollary, and the
first where the cost was a company that could not be signed at all.

`narrowCitationsToBackedFilings` NARROWS the model's self-reported
`citedUrls`. An empty list therefore stays empty. Centene supplies an empty
list for every trigger, so:

```
Centene: 5 triggers fired, every one verifiedQuote=yes, 0 citations
```

Every quote had been FOUND in a fetched filing. The pipeline knew which
filing. It cited nothing — because verification read the corpus while
citation read the self-report. Two sources for one question, and only one of
them had the answer.

**What it cost.** `filingSetOf` is the union of citations, and the filing set
is a golden file's IDENTITY — "same documents in, same answer out". Centene's
was EMPTY, which pins an answer to no documents: every future run matches it
trivially, and a pin that cannot fail is not a pin. Centene was unsignable,
and the reason had nothing to do with Centene's filings being unusual. It is
the same defect that deleted its facilities (Rule 37) and that marked Quest's
real redemption unverified (Rule 37, seventh occurrence).

**The rule:** where the model cites nothing and the quote verified, the
citation is the document whose text contains it. That is a fact this pipeline
established rather than one it was told. Measured after: Centene 5 of 5
triggers cited, filing set 0 → 3 documents; Molina and Tenet unchanged at 3,
because a model that does cite correctly is not second-guessed.

## The criteria were reading fields the code had moved past

Stage 7's audit found four criteria measuring something other than what they
name. **None was lowered; three were pointed at the right field and one was
given its second, always-intended route.**

**8b — priority class.** Read `r.seniority`; Stage 4 merged the concept into
`classification` (Rule 39). It reported "no row carries a priority class"
about Tenet's ladder while that ladder rendered ELEVEN of twelve with one —
passing vacuously on the name it exists to protect. Repointed, AND the test
tightened to what it actually defends: **every row either carries its class or
explicitly states it has none.** All-or-none was never the property; silence
defaulting to "unsecured" was. A partial count with honest unclassed rows is
faithful. The failure that remains is the one worth catching — a row whose own
sources state a class the ladder dropped.

**2 — amount unit and basis.** Counted rows with no printed unit. A row
carrying NO FIGURE AT ALL is not the bare-cell-at-a-guessed-scale this
defends against; there is nothing to misread. Now each no-amount row is
CLASSIFIED from data the guard already produced: a facility whose size was
claimed and then rejected is a real miss and still fails (Centene's
`$4,000 million`, rejected as appearing in no fetched filing); a facility
whose size was never stated is honest and passes (DaVita's bilateral LC
facility). Same principle as 8b — do not punish honesty, and do not let a
silent absence pass as one.

**4 — triangulation.** Had exactly one route, the balance sheet's captions,
so a filer whose CAPTIONS are missing failed a criterion about whether its
TOTAL is corroborated. UHS's captions are empty at v29 while its residual ties
at 2.28% against the filer's own XBRL tag. Either route now suffices; the
caption emptiness is a real v29 extraction gap, logged as one, and is not
evidence the total is uncorroborated.

**7 / 6 — capacity.** Fixed in the CODE, not the criterion: see below.

## Rule 45 — capacity has one source, and it is the ladder

Stage 5 put committed facilities on the ladder as capacity rows. Coverage
built its capacity list from `proseInstruments` alone, so the two surfaces
disagreed about the same instruments: DaVita's ladder showed one undrawn
facility and Quest's showed two, while the rendered line said **"plus $0M of
undrawn capacity NOT counted as debt"**. A wrong number on screen, beside a
ladder that contradicted it — my Stage 5 regression, fixed on sight rather
than carried to the audit.

The position's capacity rows are now passed INTO coverage
(`ladderCapacityFor`) rather than re-derived there, because re-deriving with a
second copy of the rule is the defect and not the fix. It cannot move a
residual: capacity contributes nothing to captured face on either path.

**And the same shape, one layer over.** A facility the ladder carries as DEBT
was also reported missing — DaVita's revolver is on the ladder as "Revolving
line of credit", a real note row counted in captured face, while
`categoriesMissing` read the facility's category against a table row whose
category is "table-row". Two vocabularies for one instrument, and the ladder
is the one that knows. `facilityCategoriesOnLadder` now clears them.

## Rule 46 — a figure is shown beside the sentence that states IT, on every surface, including the one used to sign

Session 22, Stage 7 (A1). Rule 35 was written for extracted facility figures.
This is the same rule discovered missing two layers away — in the signature
packet, and beneath it in the prose-instrument assembly.

**Found by a reader asking the obvious question.** "For Tenet's revolver
maturity 2030-11-04, what sentence in what filing states it?" The review page
answered with the anchor 10-Q's SIZE sentence, which states $1.900 billion and
no date at all, and attributed the maturity to the anchor. The date is real
and correctly sourced upstream — to the 10-K, seven months older. The page
paired a real figure with a real quote that does not contain it, on the one
surface whose entire purpose is letting a person check figures against
filings.

**The self-check passed throughout.** It verified that every instrument and
every amount APPEARS in the rendered sheet. Both halves were present; they
simply did not belong together. **A check that confirms two things separately
can never detect that they do not belong to each other** — the same shape as
Rule 41's rising count, and as Rule 42's probe that could not see a field it
left null.

**The rule:** every displayed figure carries its own sentence, its own
document and its own placement, and a check asks whether that sentence STATES
that figure — reusing `sentenceStatesFigure`, never a second weaker copy. Run
over the book it found **15 such pairings across seven companies**, against
the four that were expected.

### And two classes came back that must not be conflated

```
COMPOSITE          the sentence carries no form of the figure          real
SCALE-NORMALIZED   the sentence states it AS PRINTED while the packet
                   displays it NORMALIZED                              not a defect
```

Tenet's `"$1,900 million"` against the filing's own `"$ 1.900 billion"`, and
CHS's `"$ 42 million"` against a bare table cell `"42"` whose unit came from
the table's governing declaration, are the standing constraint working:
**verify as printed, display normalized.** `sentenceStatesFigure` is right
about the as-printed value and was NOT weakened to make them pass — the packet
was comparing the wrong side. Reporting one number for both would have
manufactured six defects that do not exist.

### The defect underneath was older than the packet

All five composites on signable names were maturities, and every one had
`maturityFromFacility` unset: `note-narrative` rows whose date came from the
prose instrument's own `maturityDate` while its `sourceLine` is a different
sentence. **Rule 35 for prose instruments**, which the facility guard received
at v29 and prose instruments never did. It predates Stage 5 and it renders on
the product ladder, not only the review page.

Fixed at $0 by verifying the prose maturity against its own sentence — reusing
the redemption matcher's date-token comparison rather than a second date
parser — and withholding it where that sentence does not state it, with the
claim recorded rather than dropped.

**What it changed about the CLAIMS, which is the question worth asking:**

```
rows whose claimed maturity its own sentence does not state:  6
...rescued by the facility's own maturity sentence:           6
...now rendering "not stated":                                0
cards lost because the date cannot be sourced:                0
```

**No date stopped being shown and no card was lost.** The dates were right;
the citations were wrong. Every one now points at the sentence that states it,
in the document that states it — which for Tenet is the 10-K, and is now
labelled as outside the anchor.

## Rule 47 — name a column for what the tool knows, not for what a reader will assume

Stage 7 (B2). The ladder's class column was labelled "priority class", which
claims a LIEN RANKING. The tool reads the filing's grouping label and the
instrument's own name; it never reads the credit agreement's intercreditor
terms, and senior secured notes may or may not be pari passu with a senior
secured term loan — only the agreement says. Asserting a ranking from a
heading is the same move as reading a security status out of a missing word,
which Rule 1 already forbids one layer down.

The column is **facility type**: the instrument's kind in the filer's own
words, with the filing's grouping label beside it. True lien ranking across
instruments is a v2 capability and is now deliberately not claimed.

**And the grouping label carries the instrument word.** A heading was quoted
whole; a NAME contributed only the class words, so "4.625% Senior Secured
Notes due 2029" grouped as "Senior Secured" — dropping the noun that says what
the instrument is. Extended through an immediately-following instrument noun,
still one contiguous span of the filer's own text, and never composed: where
the noun is absent the span is not extended.

---

# Session 22 — close-out

**Rules added: 34 through 47.** Every one is a rule over a class; the named
company is the worked example only.

```
34  a cost guard reads whether a call WILL bill, never that it already did
35  a figure is verified against the sentence that states IT
36  a golden pins a derivation, so it pins the schema that derivation reads
37  "the filing does not say X" is concludable only from a loaded corpus
38  a group statement reaches only the members its own words name
39  two fields for one concept do not stay in sync; the model fills one
40  a facility matures like a bond and the ladder carries its stated date
41  a rising count is not correctness; read the rows, not the total
42  a guard corpus built by reflection covers only the field TYPES it walks
43  a cost meter read before the calls it covers is not a cost figure
44  the citation is the document the quote was found in, not the one named
45  capacity has one source, and it is the ladder
46  a figure is shown beside the sentence that states IT, on every surface
47  name a column for what the tool knows, not what a reader will assume
```

**The through-line.** Thirteen rules, and almost all of them are one
principle: *name and cite things for exactly what the tool knows, never more.*
Rules 37, 42, 43 and 44 are the same defect wearing four coats — a check that
silently answers a narrower question than it appears to. Rules 35, 46 and 47
are the same discipline applied to a figure, a surface, and a column heading.
Rule 41 is why any of them were found: **a count cannot tell you which rows
changed, and the rows are where the answer is.**

## What this session actually cost, and what the log says

```
persisted cost log (extraction only)   $6.0326
narration, metered but never persisted ~$1.09  (a floor, see below)
TRUE SESSION SPEND                     ~$7.1 of $10 authorized
```

**Corrected after the fact, and visibly.** This block first read
`$3.7049 / $1.0900 / ~$4.79`. That figure was true when it was written and was
written before the session reopened: Stage 7's signature runs, the CACHE_BUST
x3 passes on six names, and the Tenet/Molina close-out all billed after it. The
persisted log for 2026-09-09 onward now sums to **$6.0326**. Left as a
correction rather than an overwrite because a cost number nobody can see move
is a cost number nobody can check — which is the whole of Rule 20.

The gap is Rule 43: `persistCompanySpend()` runs at the end of `runAgentLoop`,
and narration runs after it returns. **Every estimate this session was sized
off a log that cannot see narration**, which is why the declarations kept
under-promising any run that narrated. Fixing the persistence point is an
audit item; until then, any figure drawn from that log is a floor, not a
total.

## Three things the session got wrong and caught

1. **Tenet's "lost" section headings.** Measured correctly (0 of 11 in the
   field counted), concluded wrongly, and nearly bought a ~$1.8 re-extraction
   to fix. The class was in the sibling field, 10 of 11, the whole time. What
   saved the spend was checking the adjacent field before paying — and the
   tell was that `section` is load-bearing for the checksum, and a field an
   arithmetic depends on does not silently empty.

2. **v13's lesson billed twice in one item.** "A guard and the instruction it
   enforces are one change" is written in `promptVersion.ts`, and the why-now
   bump shipped the instruction against two stale guard corpora in succession
   ($0.37 of failed narrations) before the guard was reproduced OFFLINE at $0
   and named the cause on the first try.

3. **The facility-maturity near-miss.** A summary count moved 5 → 15 and every
   number on the report improved, while three of the new matches were wrong
   instruments — DaVita's acquisition notes and CHS's finance leases wearing a
   revolver's maturity. Caught by reading the rows. This is Rule 41's origin.

## The signature surface earned its own rule

The review artifact was published, and the first question asked of it — "for
Tenet's revolver maturity, what sentence in what filing states it?" — found
the page answering with a sentence that states the facility's SIZE and no
date, attributed to the wrong filing. The self-check had passed throughout: it
verified that the figure and the sentence each existed, which is not the
property that matters. **Rule 46 exists because a reader asked the obvious
question of a page built to answer it.**

## Session 23 — first item: reproducibility, and it is the schema-as-fact problem one instrument type over

**Tenet, the demo opener, gains a whole instrument in one run of three.**

```
CACHE_BUST x3 at v29, 2026-09-17
  run 1   12 rows
  run 2   13 rows  — adds "Letter of Credit Facility | $200 million"
  run 3   12 rows  (identical to run 1)
```

Runs 1 and 3 agree exactly. Run 2 additionally transcribes amounts in a
different style — `$ 1,500 millions` against `$1,500 million`, `senior` against
`Senior` — which is the same figures and belongs to the as-printed class, not
to this. What matters is the row: a $200 million letter-of-credit facility
that exists in the filing either way, and that the model routes into the
`facilities` array on some re-asks and not others.

**This is the model-routing instability the schema-as-fact work was for, one
instrument type over.** The same defect shape produced Rule 39 — one concept
split across `section` and `seniority`, the model filling whichever it chose
per company — and Rule 44, where a citation existed in the corpus and not in
the field the reader trusted. Here the fact is real, present in the filing, and
lands in a different place per run. A ladder row is not a stable identity when
whether it exists depends on which call answered.

Tenet renders stably in the demo because the demo reads the cache, which is
deterministic by construction. The instability is only visible when the model
is re-asked — which is exactly what criterion 9b re-asks for, and exactly why
9b is not a formality.

**Molina is the smaller cousin, and it is naming, not routing.** Its facility
row is `revolving credit facility` in one run and `Credit Facility` in two —
the filing uses both, and the model picks either. Amounts and classes are
identical across all three. `ladderRowId` is built from
`instrument::rate::maturity`, so a name the model renders two ways makes one
instrument into two identities, and a golden pinned on one run reports a row
removed and a row added on the next.

The fix shape differs from Tenet's: Tenet needs the routing decision to stop
being the model's, Molina needs row identity to survive the filer's own
synonyms. **Neither should be fixed by normalizing names into a house
vocabulary** — that is the vocabulary guard this codebase does not do. Identity
has to key on something the filing states about the instrument rather than on
what it happens to call it in a given sentence.

Both block a golden and neither blocks the demo.

---

# Session 22, reopened — the two reproducibility rules

Both names that failed criterion 9b are closed, code-only, and both fixes are
book-wide rules rather than repairs to a company.

## Rule 48 — a letter of credit is not borrowed money, so it has no ladder row

Tenet's $200 million letter-of-credit facility became a 13th ladder row in one
CACHE_BUST re-ask of three. The facility is real and in the filing either way;
which structure it landed in was the model's choice that run.

An LC is a **contingent undertaking**: nothing is owed unless it is drawn. Its
only effect on the position is that LCs outstanding reduce what remains
available under the facility they sit against — which is a liquidity fact, and
the only place it now appears.

**The fix removes the destination rather than instructing against it.** With no
ladder row for an LC facility to become, there is nothing to route it into on
one run and not another. That is the same move as schema-as-fact (Rule 39),
one instrument type over: an instability that no prompt wording can close
because the model is choosing between two valid-looking places to put a real
fact, closed by deleting one of the places.

**And the liquidity line now deducts them.** Available-to-draw is
`size − drawn − LCs` — a $100M facility with nothing drawn and $20M of LCs has
$80M available. Computed only where the filing states the components and not
the total; **where the filer states availability outright, that figure wins**,
because a stated availability is normally already net of LCs and deducting
them again would understate the company's liquidity while looking more
conservative.

Book-wide effect: one row changed, DaVita's "bilateral secured letter of credit
facility", correctly. Tenet's ladder is 12 rows in all three re-asks.

## Rule 49 — row identity keys on what the filing states about the instrument, never on the label a run chose

Molina's revolver is "revolving credit facility" in one re-ask and "Credit
Facility" in two. The filing uses both; the model picks either. Keyed on the
label, one instrument became two identities, and a golden pinned on one run
reported a row removed and a row added on the next — while its amount, its
maturity and its class were identical in all three.

*"Revolver, $1.25B, matures 2030-11-20" is one row whatever it is called.*

**No house vocabulary and no name normalization.** Mapping the filer's synonyms
onto a canonical label would make the tool's naming authoritative over the
filing's. The label still renders exactly as stated; it simply stops deciding
whether two rows are the same row, and a change in it is reported as a
**rename** rather than as a disappearance and an arrival.

### Two near misses in getting the key right, both caught by the suites

**The type is not in the key, though it was the obvious candidate.**
`instrumentType` is derived from the name — "revolving credit facility" reads
as `revolver`, "Credit Facility" as `credit-facility` — so it inherits exactly
the instability it would be there to cure. A key is only as stable as its least
stable input.

**And rate-plus-maturity alone is too weak.** UHS's "Tranche A term loan" and
its "Revolving credit facility" both state no rate and both mature 2029-09-26:
the key merged two entirely different instruments and the golden reported a
rename and a $1.448B-to-$225M "amount change". **A key too weak to tell real
instruments apart is worse than the label it replaced.** Size joins the key —
and the consequence is handled where it belongs rather than by weakening the
key: a tranche whose BALANCE moved no longer matches exactly, so
`compareToGolden` falls back to a rate-and-maturity match, accepting it only
when exactly one row on each side is left holding that looser key. Ambiguity is
not a match (Rule 19), and "this row's amount changed" is the thing a golden
exists to say.

## And the harness was measuring the old definition

Both names still reported MOVED after the fixes, because the reproducibility
harness compared `instrument | amount | class` as strings — the label, the
as-printed whitespace, and the verbatim class casing. Aligned to the same
identity the golden uses: facts for the position, value-and-unit for amounts,
the NORMALIZED class for the class, and the label and its verbatim compared
separately as drift.

`"senior secured"` against `"Senior secured"` is one class written two ways. It
drives the same rank and the same sort position, and calling it a position
change would have held a signature over a capital letter.

**A gate that measures the old definition of the thing it gates reports the fix
as a failure.**
