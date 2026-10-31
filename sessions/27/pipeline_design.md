# Session 27, Stage 2: one build-a-card pipeline (design only)

Status: **draft, revised with Akshay's Stage 2 decisions of Oct 29** (§10 records them). Nothing here is built and nothing bills. Every cost figure comes from `baselines/cost-log.jsonl` or from pre-call counts.

## 0. What Stage 1 taught, applied here

| Lesson (Session 27) | Where it lands in this design |
|---|---|
| **A refresh triggers on the anchor filing.** An earnings 8-K alone (Items 2.02, 7.01, 9.01) is not a refresh (ruling of Oct 29). | §5 separates the *refresh trigger* (a new anchor) from the *cache key* (the read set). |
| **Re-tastes are bound to the canonical read set.** A "re-taste" taken on a moved corpus is a new extraction (Encompass and CHS, Oct 28). | §4: the three samples of a cold build share one resolved read set, fixed before the first call. Each sample re-checks it before billing. |
| **The gate drops names whose filings moved** (`s27reextract`, at run time, not at pricing time). | §2 stage 6 and §6: the read set is re-resolved immediately before each billed call. If it moved, the call is refused, with nothing billed. |
| **Spend is gated before the call** (`guardedCreate`: count the input tokens, price the worst case, refuse). The fill overran its ceiling once because spend was only metered afterwards. | §6: every cap is enforced by the same count-then-price guard. |
| **Declared ceilings are rounded up, never down.** DaVita's narration was priced at "$0.0331"; the exact worst case was $0.033147, and the gate correctly refused it. | §6: declared figures are rounded *up* to the cent's next ten-thousandth. |
| **A billed answer can be lost on write** (Encompass #2: a DNS outage, then a `WriteFailedError`, cost $0.1135). | §7: a billed answer is spooled durably before the blob write, and a write failure never leads to a re-bill. |
| **Reads fail closed** (`ReadFailedError`: at most 2 retries, never a different source). | Every stage's "fails" column. |
| **A broken coverage tie is a check failure, not an alternate reading** (ruling 1(c)). | §3: "Checks passed" requires the tie, and §4 stability counts only samples whose tie holds. |
| **The debt table decides** (letters of credit are never debt; a description supplies a row only where the table has none). | §2 stage 8 (post-extraction rules); its failures surface as checks, not as extra rows. |
| **What the document prints is read from the document.** A model sample dropped a printed subtotal label (DaVita) and a printed heading (Molina). | §2 stage 8: printed headings and subtotal labels are recovered from the anchor's text in code (`textHeadingBefore`, `recoverSubtotalLabels`). |
| **A label the reader sees is built from identity, not from model wording.** Cigna's samples worded one repayment two ways. | §2 stage 8 and §4: deltas are matched by identity (amount, date, coupon, maturity) and labelled from it (`deltaIdentityOf`, `deltaLabelOf`). |
| **Signing a name re-captures its card input**, so a signature changes the committed card wherever the signed answer cites differently (Tenet's and Encompass's re-signatures, Oct 29). | §9 Ring 1: a signature is a card change, shown as a diff before it is cleared. |

## 1. Entry point

`buildCard(query: string, opts: { userId; caps; asOf? }): Promise<BuildOutcome>`

- **`query`** is a name, a ticker, or a CIK (all digits, padded to 10).
- **Resolution** goes through EDGAR's `company_tickers.json`, cached as today in `edgar/company_tickers.json`.
  - **A CIK** resolves directly, and the submissions API confirms it exists.
  - **A ticker** resolves by exact match, case-insensitively.
  - **A name** resolves through the normalised title. **Every** match is collected: exact, prefix, and all-tokens.
- **One match:** proceed.
- **More than one match:** return `{ kind: "choose", matches: CikMatch[] }` and stop, at $0. Never guess.
  - **This changes current code (agreed, Oct 29).** Today `resolveCik` (`lib/fetch/cik.ts:42`) returns the *first* match and caches it under the name's slug. That is a guess, and the cache makes the guess permanent. The resolver returns **every** match, and **never caches a guess**: the per-name cache stores only the user's pick.
- **No match:** `{ kind: "could-not-build", reason: "No SEC registrant matches \"…\"" }`.

`BuildOutcome` is one of:
- `choose`
- `card` (the card, with its trust state and the breakage panel)
- `could-not-build` (a plain-language reason)
- `needs-approval` (a cold build's expected cost, shown before anything bills; §6)

## 2. Stages, in order

| # | Stage | Reads | Writes | Costs | Fails how |
|---|---|---|---|---|---|
| 1 | **Resolve the company** | `company_tickers.json` (blob cache, else sec.gov) | the ticker cache; the user's pick | $0 | sec.gov unreadable after 2 retries: `ReadFailedError`, giving **Could not build**: "SEC's company list could not be read". |
| 2 | **Fetch the filing list** | EDGAR submissions API (`getRecentFilings`: 8-K, 10-Q, 10-K) | the filing list cache, keyed by CIK and fetch date | $0 | `ReadFailedError`, giving **Could not build**. Never a stale list without saying so. |
| 3 | **Choose the anchor** | the filing list | none | $0 | No 10-Q or 10-K in the window: **Could not build**: "no quarterly or annual report on file". |
| 4 | **Decide the read set** | the filing list, through Stage 1's one function (`readSetOf`, `anchorOf`, `digCandidatesOf`, `readSetFingerprint`) | none | $0 | Deterministic; cannot fail on its own inputs. |
| 5 | **Check the cache** | `answer/<cik>/base-rs/<fp>/v<EXTRACTION_PROMPT_VERSION>.json`, plus the referenced-note, dig and proceeds-use keys | none | $0 | A **read failure** is `ReadFailedError` and stops the build. It is never treated as a miss, which would bill. Only a confirmed "not found" is a miss. |
| 6 | **Extract on a miss** | the read set's documents (EDGAR text cache, fail-closed) | the answer (§7) and ledger lines | Haiku base call; the ledger shows **$0.124 to $0.233 per sample** across the six (Oct 22 canonical run) | Every call goes through `guardedCreate`. Refused: **Could not build** "cost cap reached", with nothing billed. The read set is re-resolved before the call; if it moved, the call is refused and the build restarts at stage 4. |
| 7 | **Referenced-note call** (Rule 66) | the referenced 10-K when the anchor directs to it (Cigna's shape) | the note answer, cached on its own key | worst case $0.0634 from pre-call counts (Cigna, the one name that takes it) | As stage 6. A note that cannot be read is a named check failure ("the referenced note could not be read"), never a model guess. |
| 8 | **Post-extraction rules** | the answer; the read set's text | none (pure) | $0 | Pure functions: `assemblePosition`, `fundedProse`, the Rule 58 provenance, the Rule 76–78 dates (`dateHeldToSentence`), the canonical zero, the name rule, the retirement rules, printed headings and subtotal labels recovered from the anchor's text, delta identity and labels. They do not fail; they mark. |
| 9 | **Automated checks** | the result of stage 8 | the check list | $0 | Each check is pass, fail or not-applicable, with its figure and source (§3). |
| 10 | **Render** | stage 8 and 9 outputs; the documents' text (`textByUrl`); XBRL cash; the period sentence; filings since the last build | the card JSON; the brief log line | $0 from cache; narration is a separately approved Sonnet call (Tenet $0.0281, DaVita $0.0287) | A narration failure renders the card without narration, as today's integrity checks already do, and names it in the panel. |

Stages 6 and 7 are the only stages that bill. Everything after them is pure and replays at $0.

## 3. Trust states (decided by rule, shown as a badge on every card)

Rules apply in this order. The first that applies decides the badge.

1. **Could not build.** The pipeline stopped before a card existed. The reasons are a closed list:
   - no SEC match;
   - no 10-Q or 10-K;
   - a filing unreadable after retries;
   - the cost cap reached;
   - more than one match (shown as a picker, not a badge).

   It shows a plain-language reason and the stage it stopped at.
2. **Signed.** A golden exists for this CIK whose `extractionVersion` equals the current version, whose filing set equals this build's position identity (Rule 66 acceptance applies), and against which `compareToGolden` returns `matches`. Tolerated differences are recorded, as today.
3. **Checks failed.** At least one check in the list below fails.
   - The card renders anyway, with a **breakage panel** at the top. Each failed check gets one line: the check's name, the figure, and the source document and sentence.
   - A failed figure renders **withheld** ("withheld: <reason>") or **flagged**. It is never shown as a clean number.
4. **Checks passed.** No golden applies, and every check passes.

**The checks** (each already exists as code unless marked new):

| Check | Passes when | Source |
|---|---|---|
| Coverage tie | `coverage.residualPasses`; on a rolled position, both the base tie and the roll tie | `computeCoverage`, `rolledCoverage` |
| Every figure stated by its sentence | `unsupportedAmountRows` is empty; every facility figure passes `verifyFacility` | Rule 58 |
| No false "not stated" | every "not stated" is backed by a search of its read set that found no stating sentence. **New as a named check:** today the property is enforced piecemeal (`statedZero`, `undrawnOf`). | Rules 35, 58 |
| Dates at stated precision | every shown date is supported at its granularity | Rules 76–78, `sentenceSupportsMaturity`, `dateHeldToSentence` |
| Names verbatim or plain type | `nameIsVerbatim`, or the plain-type fallback | name rule |
| Stability | 3 of 3 samples reproduce (§4) | `compareToGolden`, `countsToward9b` |
| Narration integrity | the existing narration integrity suite on the card's text | `narrationIntegrity` |
| Every stage on this anchor | every section's stage read the card's own anchor; otherwise the section says "not yet read from [filing]" and asserts nothing | `missingStage.test` (Oct 30) |

## 4. Stability on demand (Akshay's decision: three samples)

- **A cold build is three samples: the canonical plus two re-tastes.** Each is an independent ask under its own `CACHE_BUST` tag, on **one read set resolved once**, before the first call. All three record that fingerprint. A sample whose read set no longer matches at its own call is refused before billing (lesson 2).
- **Concurrency.** The three base calls run concurrently. They share the read set's fetched text, which is fetched once and cached.
  - The referenced-note call and the dig, where they occur, run per sample, after that sample's base call.
  - Proceeds-use follows its sample's base answer.
- **Identity.** Each re-taste is compared against the canonical, with the identity rules and acceptances 9b uses:
  - Rule 66;
  - re-transcribed source lines;
  - whitespace and footnote markers;
  - case in labels;
  - deltas matched by identity (amount, date at stated precision, coupon, maturity), label word choice tolerated where both labels pass the name rule;
  - the withheld-figure class.
- **Agreement.** A sample counts only under `countsToward9b`, so a broken tie never counts. "Checks passed" needs 3/3.
- **A figure that differs across samples** is shown **withheld** ("differs across stability samples") and listed in the breakage panel with all three readings. The rest of the card renders.
- **Expected cost per cold build, from the ledger:**
  - Three samples cost three times the per-sample cost: **$0.37 (CHS-shaped) to $0.70 (Tenet-shaped)**.
  - Add narration, about $0.03 per narrated card, when approved.
  - **The worst case declared before the build, from counts:** Molina's refresh is $1.5353. That includes the full dig budget (5 digs, $0.2759 per sample); Molina's Oct 22 canonical run dug 0 times. The worst case is what the user is shown and what the cap holds.
- **Expected time:**
  - The Oct 22 sequential canonical run spaced the six names 1.1 to 3.6 minutes apart (fetch plus one Haiku call of about 60k to 100k tokens in and up to about 12k out).
  - Back-to-back re-tastes ran about 2 minutes each.
  - Run concurrently, a cold build is **about 2 to 4 minutes of wall time**. That is bounded by the slowest sample, not the sum.
- **A cached rebuild is $0.** All three samples' answers are cached under their `(cik, read-set fp, version, bust)` keys. A rebuild re-renders from cache. `assertFree` runs before any rebuild, and the release check `goldenThroughLoop` already proves this path for signed names.

## 5. Quarterly refresh: the same pipeline

- **The triggers (decided Oct 29).** A refresh happens on either of:
  - **a new anchor:** a 10-Q or 10-K that `anchorOf(readSetOf(filings))` now returns;
  - **an 8-K carrying a debt item:** 1.01, 1.02, 2.03, 2.04 or 8.01.
- **An 8-K with only Items 2.02, 7.01 or 9.01 does not trigger a refresh,** even though Item 7.01 is in the read set (ruling F2). It is picked up at the next trigger.
- **Between triggers, the card is served from its last build**, with the filings since that build listed in the card's header. Nothing bills.
- **The trigger and the key are different functions.** The *key* (stage 4) moves whenever the read set moves, which keeps cached answers honest. The *trigger* (`refreshTriggered(filingsSinceBuild)`, one function, its item list the one above) decides when a stored card is rebuilt.
  - So a name whose key moved on an earnings 8-K (Encompass and CHS, Oct 28) keeps its last build, lists the 8-K in its header, and does not bill.
- **A refresh re-runs every billed stage on the new anchor (decided Oct 30).** That is the base extraction (canonical plus two re-tastes), the referenced-note call where Rule 66 directs, the dig, proceeds-use, **and the verified-facts extraction** (`capture/facts.ts`). A card never renders a section from a prior anchor, and never drops one silently. The refresh's declared cost includes every stage, priced from pre-call counts.
- **A section whose stage has not run on the current anchor (decided Oct 30)** renders "not yet read from [filing]", naming the anchor filing. It never asserts absence. "No debt moves stated this year" was false on Molina's first refresh render: the Feb 4 amendment is this year, and the facts stage that reads moves had not run on the Oct 22 10-Q. Each stage records the anchor it read (the facts record its `anchorUrl`); the card compares that with its own anchor, section by section.
- **On a refresh:**
  1. The card rebuilds as a cold build (§4) on the new read set, every stage included.
  2. The badge drops from **Signed** to the automated result. The golden no longer applies, because its filing set moved (Rule 30's "not-applicable").
  3. The old signed card stays available as **the prior quarter**, read-only, with its signature.
- **Moves "awaiting confirmation"** (rule (c): an announced redemption) are re-evaluated against the new filing by the same `classifyRedeemsClaims`.
  - If the new anchor's table no longer carries the tranche, or a filing states it done, it becomes a retirement.
  - If not, it stays pending, with its original sentence.
  - Tenet's Sept 23 redemption is the first case.
- **Molina was the first live test (run Oct 29, approved worst case $1.5353, billed $0.6165).**
  - Canonical plus two re-tastes, bound to one read set (`s27molina.ts`): **3/3**.
  - The position date moves from Jun 30 to **Sep 30, 2026** (the Oct 22 10-Q). The same five notes and the $1.25B revolver. Captured face $3,800M against $3,771M tagged (was $3,769M), residual 0%: the tie holds. The printed heading "Non-current long-term debt" is now recovered.
  - Not yet signed; the diff is in `sessions/27/molina_refresh_diff.txt`.

## 6. Cost controls

- **Caps (decided Oct 29), all checked pre-call:**
  - **$2.00 worst case per build.** The declared worst case of a cold build (canonical plus two re-tastes, from counts) must fit under it, or the build is **Could not build: "cost cap reached"** before any call.
  - **$10 per day per user.**
  - **$25 per day, global.**
- **All are enforced in one place, before every call:** `guardedCreate` counts the input tokens and prices the worst case. It refuses if the call would cross any cap, with remaining = cap minus spent, read from the ledger.
  - This extends `setSpendLimits({ perRunUsd, totalUsd })` with a per-user dimension.
  - The day and user totals are read from the ledger, not held in process memory, so two processes cannot each spend the full cap.
- **Before a cold build starts**, the pipeline returns `needs-approval` with the expected cost (the ledger range for a name of this shape) and the worst case (from counts, in price-only mode, at $0).
  - A cached build never asks: `assertFree` proves it is $0.
- **Declared figures are rounded up to the cent** (lesson 5; Akshay, Oct 29).
- **Rule 68:** every billing path is inside `withCostScope`, and every narration call writes a "(narration)" ledger line.

## 7. Concurrency and cache writes

- **Leases are not on Vercel Blob (decided Oct 29).** Our Oct 21 403 was a read straight after an overwrite, so Blob cannot be trusted for a lock. Leases live in **Upstash Redis** (Vercel Marketplace): `SET lease:<key> <owner> NX EX 600`. Blob keeps the answers and the spool data.
- **One build per key.** Before stage 6, a build takes the lease on `(cik, read-set fp, version, bust)`. `SET … NX` succeeds for exactly one caller; the lease records an owner and expires after 10 minutes. A Redis read failure is `ReadFailedError`: the build stops, and never proceeds as if the lease were free.
  - A second build of the same key finds the lease, waits, and polls the answer key.
  - When the answer appears, it is served at $0.
  - When the lease expires with no answer, it may take the lease.
  - **Two builds can never both bill for one key.**
- **Answers are write-once.** The answer write also uses no-overwrite. If a second writer loses the race, it reads the winner's answer and discards its own (it cannot exist, given the lease, but the write is still guarded).
- **Spool before write (lesson 6).** A billed answer is written first to a durable local spool (`spool/<key>.json`), then to the blob store.
  - If the blob write fails after retries, the build stops with `WriteFailedError` naming the spool path.
  - The next build of that key promotes the spool to the blob store **before** checking for a miss, so a write failure never causes a re-bill.
- The ledger stays append-only, and stays out of every working-tree operation (the Session 26 rule).
- **The test (decided Oct 29):** two concurrent cold builds of one name produce **exactly one set of billed calls**: one canonical and two re-tastes in the ledger, both builds serving the same answers. Control: with the lease disabled, the same test bills twice and fails.

## 8. What the card needs that snapshots supply today

Today `lib/cards/inputs/<cik>.json` supplies the following, captured once and committed. Here is each item and how the pipeline supplies it live:

| Snapshot field | Live source |
|---|---|
| `result` | stages 5–8 |
| `docs` (the text of every cited document, by URL) | the read set's fetched text (stage 6's documents), plus any referenced 10-K; the EDGAR text cache, fail-closed |
| `cash` (XBRL value plus the printed balance-sheet line) | `fetchXbrlCash(cik, anchor.reportDate)` and the line locator over the anchor's text |
| `periodSentence` | the anchor's cover line, found in its text |
| `laterFilings` | filing list entries since the last build, shown in the card header (§5) |
| `corpusFingerprint`, `sourceCommit`, `capturedOn` | replaced by the read-set fingerprint, the build's commit, and the build time, all recorded on the card |
| `facts` (verified card facts) | `cachedCardFacts`, on its own key |

Committed snapshots remain the test fixtures for Ring 1. The product never reads them.

## 9. Test plan

**Ring 1: the six signed names (definition decided Oct 29).**
- **Determinism:** a card rendered from a cached answer must be **byte-identical**, every time, at $0.
- **A fresh extraction** is compared with the recorded tolerated classes (`compareToGolden` through `s27compare`), never byte for byte.
- Each name must come out **Signed** once re-signed at v33 on its read set. The release check `goldenThroughLoop` is the Ring 1 gate.
- Status, Oct 29:
  - **Signed at v33:** Tenet; Encompass (its pre-Oct 28 read set).
  - **DaVita:** 3/3, refused by its signing condition. Its card from the v33 canonical differs from the committed card on 136 lines of cited sentences: no figure, date or label differs.
  - **Cigna:** 3/3 since deltas match by identity; held on criterion 2 (a rule proposed).
  - **Molina:** refreshed on its Q3 10-Q, 3/3, not yet signed.
  - **CHS, and Encompass's refresh:** wait for their Q3 10-Qs.

**Ring 2: UHS, HCA, Quest, Centene.** The expected breakage, from what is recorded:

| Name | Expected | Why |
|---|---|---|
| UHS | **Checks failed** (Rule 58) | the $700M row's cited sentence ("364 days after the date of funding…") states no amount; golden at v29. `fundedProse` now suppresses its duplicate term-loan description (coverage [12d]). |
| HCA | **Checks failed** (Rule 58); possibly no tagged-debt denominator | all four ladder rows cite a table label with no figure (schedule-row provenance is deferred). Its company facts lag the anchor by a quarter (`fetchXbrlDebtTotal`'s "data does not reach the anchor"). |
| Quest | **Checks passed** likely | 15 rows, reproduces, no blocker recorded; never through a signing pass. Watch the matured-row zero question. |
| Centene | **Checks passed** likely | 9 rows; Rule 72 narrowed its identity to the anchor. History: it failed 3/3 fresh attempts on an earlier prompt (promptVersion notes), so stability is the risk. |

**Ring 3: any name.** Run a sample of names outside healthcare. Every card must reach one of the four badges, and none may render a clean number that a check failed.

**The accuracy scorecard** (Akshay fills in one per name):

| Item | Correct | Wrong | Honestly flagged | Note |
|---|---|---|---|---|
| Total debt (captured face) | | | | |
| Stated denominator / residual | | | | |
| Liquidity (undrawn, cash) | | | | |
| Next maturity | | | | |
| Each ladder row (amount, maturity, class, name) | | | | |
| Each facility figure (size, drawn, letters of credit, available) | | | | |
| Each event card's headline figure | | | | |

"Honestly flagged" means withheld or flagged with a reason that is true. A flagged figure with a false reason counts as **wrong**. The badge is scored too: was it the right one of the four?

## 10. Decisions (Akshay, Oct 29, 2026)

1. **Refresh triggers:** a new anchor (10-Q or 10-K), or an 8-K carrying a debt item (1.01, 1.02, 2.03, 2.04, 8.01). An 8-K with only 2.02, 7.01 or 9.01 does not trigger; it is picked up at the next anchor. Between triggers the card is served from its last build, with the filings since listed in the header. (§5)
2. **Caps:** $2.00 worst case per build, $10 per day per user, $25 per day global, all checked pre-call. (§6)
3. **Leases:** Upstash Redis with `SET NX` and an expiry, not Vercel Blob. Blob keeps answers and spool data. Tested by two concurrent cold builds of one name producing exactly one set of billed calls. (§7)
4. **Ring 1:** a card rendered from a cached answer is byte-identical (determinism); a fresh extraction is compared with the recorded tolerated classes. (§9)
5. **`resolveCik`:** return every match and never cache a guess. (§1)
6. **Quotes round up to the cent.** (§6)
7. **A refresh is every stage** on the new anchor, the verified-facts extraction included. A card never renders a section from a prior anchor, and never drops one silently. (§5; Oct 30)
8. **Missing-stage rendering:** a section whose stage has not run on the current anchor renders "not yet read from [filing]" and never asserts absence. (§3, §5; Oct 30)
9. **Standing terms vs balances (Oct 30):** Rule 66 governs balances (amounts stated as of a date). A standing term (facility maturity or size, a sub-limit, a note's coupon and maturity) stated only in the latest 10-K renders with the "10-K" tag, unless a later filing in the read set amends that facility or instrument (an 8-K Item 1.01, 1.02 or 2.03, or a 10-Q stating an amendment). In that case the term comes from that filing, or shows "not stated".
10. **Serving from the last build:** `READ_SET_AS_OF` reads the filing list as of a build's brief date, so a card served between triggers, and its Ring 1 check, use the read set that build used. (§5, §9; Oct 30)
