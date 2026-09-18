# Coverage Signal — Business Requirements Document

Version 1.7 · September 2026 · Status: Session 22. The ladder now names what each instrument IS — facility type, from the filer's own words — carries every committed facility whether drawn or not, and shows each figure beside the sentence that states it. Six names are signed as golden files. **The demo opens on names whose position reproduces; the standing cost figures below come from the persisted cost log, which does not capture narration (Rule 43), so every estimate drawn from it understates any run that narrates.**

**Addendum, added after Session 21 closed:** the four demo cards were read against their filings as an RM reads them. Every fact is correct and sourced; three of the four stories are weak, and every story failure has one root — the tool knows what each number is and not what it is for. Nine rules follow, logged in 13.2d. Session 21 itself is unchanged and stays closed.

**What changed in 1.6:** the ladder splits into Tier 1 (the anchor position, the only tier with a coverage percentage) and Tier 2 (events since the anchor, netted not stacked, with a rolled total that names what it excluded) (8.6); an event whose confirming filing states no amount renders in full and moves nothing (8.6); a row no subtotal in the note ever counts renders as a row with its exclusion stated (8.6); the denominator comes from the filer's own XBRL tags where they reach the anchor's period, and is labelled model-read where they do not (8.0, 8.6); derived lines on cards are arithmetic over verified fields, computed in code and never narrated (7.1); and a **golden file** is defined by nine criteria, written only when all nine hold (8.7).

**What changed in 1.5:** the coverage check joins the guards as the third check, with its own definitions block and a measured threshold (8.5); the anchor is the most recent 10-Q/10-K and never falls back to an older filing (5.2, 6.0); the anchor rule covers every position-bearing field, not the schedule alone (6.0); debt is the drawn balance of a facility and undrawn commitment is capacity, reported separately (6.0); one instrument belongs to exactly one field, decided by how the filing prints it (5.2); standing costs restated from a persisted per-company cost log (13.2).

**What changed in 1.3:** the debt note is located by its own heading (5.2); verification is bounded to the row it verifies and covers the amount as well as the quoted line (8.3); the position layer treats an 8-K as authoritative only when it post-dates the note's period (6.0); identity matching states when a match was possible at all (6.0); the outstanding column is deliberately unlabelled and movement is classified instead (7.2).

**What changed in 1.2:** the checksum is two independent checks over a nested note, not one sum against one total (8.1); a four-state verdict replaces pass/fail (8.2); verification checks the amount as well as the sourceLine, and scale is derived in code from the filing's own declaration (8.3, 8.4); the base filing is searched for rather than assumed (5.2); partial redemptions no longer retire a whole tranche (6.0).

**What changed in 1.1:** debt extraction returns the whole schedule instead of one fact (5.2); a new deterministic position layer assembles the current ladder before the gate (6.0); a stated-amount test replaces topic-matching for treasury and capex triggers (5.2, 6.2).

---

## 1. What the product is

A weekly call sheet for a commercial banking relationship manager. The RM types the names of the public companies in their book. The tool reads each company's recent SEC filings, checks 15 trigger signals, and returns two things:

1. **Cards** at the top. The few events worth a call this week, each with what to call about, why now, the supporting facts, and the filings they came from.
2. **A portfolio table** below. Every company across four buckets (refi, new debt, treasury, hedging), one line per verified fact, source on every line, empty buckets shown explicitly.

Everything on screen traces to a filing the RM can open in one click.

### 1.1 The problem

An RM covers 30 to 50 names. Nobody reads every 10-Q and 8-K every week, so client needs get noticed late or by a competitor. The scarce thing in coverage is not information about a client. That exists everywhere. It is noticing the moment a client develops a need.

Second, the insider problem: RMs are lending-trained, so they systematically under-call treasury and deposit opportunities, which is where the bank's margin actually sits.

### 1.2 What we are not building

A research or summary tool. Those exist and are the incumbent category. Coverage Signal detects trigger events; it does not answer "tell me about company X."

### 1.3 Who it is for

- **Primary:** commercial banking RMs covering public companies.
- **Demo audience:** Gabriel Stengel, co-founder of Rogo. The architecture has to survive a founder's technical questions, not just look good.
- **The real version (told, not built):** the same framework fed by bank-internal signals (idle balances, escrow wires, on-book maturities, FX volume). The public tool proves the framework; the internal one is where it is worth something.

---

## 2. Stack and deployment

| Layer | Choice |
|---|---|
| App | Next.js + TypeScript |
| Hosting | Vercel (serverless, read-only filesystem except /tmp) |
| Data | SEC EDGAR (company_tickers.json, submissions API, filing text) |
| Extraction model | Claude Haiku, temperature 0, forced tool-use |
| Narration model | Claude Sonnet, cards only |
| Storage | Vercel Blob (document cache, answer cache, wording cache) |
| Access | Passphrase gate, per-IP rate limit (10 runs/hour), 12-company cap |

---

## 3. The design principle everything hangs on

**The model reads. Code decides.**

The model labels what a sentence already says ("we redeemed" vs "matures on"). Code applies the rules (is that date inside 18 months, is 30% QoQ met). Every time this line blurred, the product broke:

- Sonnet reading filings and narrating in one step: good event judgment, invented numbers.
- Judgment moved to code without the fields to judge with (no event date, no status): every figure real, wrong events carded.
- Model re-asked on every click: different cards per run on the same commit.

Three standing rules earned from those failures:

1. When a fix moves a responsibility from one component to another, test the responsibility, not just the fix.
2. A guard that scans vocabulary instead of claims will reject the sentences that say the opposite of what it fears. Structural or semantic tests, never word lists.
3. Test the machine you ship, not a fixture of it.
4. Fix the shape, not the symptom. The guard stack grew to police a bad data model: evidence-blob sentences forced a condenser, which forced a scrape guard, splice detection, and figure-type binding. Structured rows delete most of that machinery. The test for any addition is whether it makes a claim checkable or patches a symptom. Corollary earned the hard way: **four occurrences of one bug class means it belongs in code, not in the prompt.** Dates were solved that way and stayed solved; scale took four attempts to reach the same conclusion.
5. A worked example in a prompt is data, not just instruction. Given the wrong input, the model fills the gap from its own instructions. Never put real figures in an example.
6. A guard that checks the label but not the value proves nothing. Captions are generic across filings; the numbers beside them are not. Verify the thing that varies.
7. Never fix the instance. Company names in a spec are worked examples of a rule, never the target. A change that satisfies one case while the rule stays unimplemented has fixed nothing, and no test catches it because no test was written about the shape.
8. A guard's reach must be bounded by the thing it is guarding. "Does this number appear in this filing" is not a question about a row. *Corollary:* a bound is only as good as the position it is measured from.
9. A field the model is shown must be a field the guards can see. Adding one without the other is a regression, not a partial fix.
10. Absence of a match is only evidence of absence when a match was possible.
11. A label wrong on part of the book is worse than no label. Where a classification cannot be made reliably, measure what is decidable and state that instead.

---

## 4. Pipeline

```
Company names typed in
  → resolve to SEC CIKs                          [lookup, no AI]
  → fetch filings                                [document cache, full text]
      2 most recent 10-Q, 1 most recent 10-K, up to 6 high-signal 8-Ks
      8-K item filter: 1.01 1.02 1.03 2.01 2.03 2.04 2.05 2.06 3.02 7.01 8.01
  → corpus build: first 40k of every filing (LEAD_CHARS), plus a spliced
      excerpt around the located debt note when the filing runs longer
  → per company: Haiku reads corpus, 15 triggers [answer cache, permanent]
      every filing must produce an answer: this event, or none
      base filing = newest filing yielding verified entries, searched backwards
  → verification: sourceLine + amount located in the cited filing
  → scale derivation: from the filing's own governing declaration [code]
  → fact guard: event date must appear in text   [deterministic]
  → position assembly: current debt ladder        [deterministic]
  → check 1 internal walk + check 2 balance-sheet anchor  [deterministic]
  → gate: bucket + card/table decision            [deterministic, golden-tested]
  → Sonnet writes card text                       [wording cache, permanent]
  → number guard audits every figure              [deterministic]
  → render: cards above portfolio table
```

### 4.1 The three caches

**The insight the whole cache design rests on:** a filing never changes. A 10-Q filed 2026-07-28 says the same thing today, next week, next year. So the *answer* about it can never legitimately change either. Earlier versions cached the document and threw away the answer, which is why the same book on the same commit produced different cards per run. v3 stopped trying to make the model deterministic and instead asks it once per question.

| Cache | Key | TTL | Why |
|---|---|---|---|
| Document (filing list) | CIK + form type | 24h | Companies file weekly. A stale list hid a real card (Concentra's 98% QoQ cash build) for weeks. |
| Document (filing text) | filing URL | permanent | Content at a URL never changes. |
| Answer | company + corpus fingerprint + promptVersion | permanent | A filing's content never changes, so the answer about it never should. This is the determinism fix. |
| Wording | hash of the gated-fact context Sonnet sees | permanent | Same event, same card sentence, every run. Never caches a failure. |

`promptVersion` in every key is the escape hatch. A cached wrong answer is otherwise permanently wrong. Decision pending Session 17: split into an extraction version and a wording version, so a narration change does not invalidate the facts.

Missing blob token or any read/write failure throws. No disk, tmp, or in-memory fallback exists. Silent degradation is the failure mode that hid the Session 13 bug for three sessions.

---

## 5. Signals

### 5.1 The 15 triggers

The taxonomy (`docs/trigger_taxonomy.md`) is the source of truth. Each trigger carries an id, name, the signal it looks for, the banking need it maps to, a need type (credit / treasury / distress), detectability (PUBLIC / INTERNAL), and 8-K item hints. Triggers referenced in the build history:

| Trigger | Bucket | What it looks for | Card condition |
|---|---|---|---|
| debt-maturity | Refi | A tranche coming due | dated, ≤18 months out, not bare-year |
| new-debt-issuance | New debt | Notes, term loans, credit agreement amendments | completed issuance cards only if proceeds partly unapplied and <90 days old |
| revolver-utilization | New debt | Drawn vs available | table (standing) |
| acquisition | New debt / Treasury | Announced deal, financing undisclosed or bridge | just_announced, <90 days |
| capex-program | New debt | A named, discrete project | newly announced; ongoing capex → table |
| dividend-buyback | New debt | Authorization | newly increased or announced; ongoing → table |
| asset-sale / divestiture | Treasury | Proceeds that need a home | pending/live, <90 days |
| capital-raise | Treasury | Equity or debt proceeds | completed → card only on proceeds test |
| cash-balance | Treasury | QoQ cash movement | code-computed >30% QoQ from two 10-Qs; else table |
| floating-rate-debt | Hedging | Unhedged floating exposure | standing → table, flagged |
| fx-exposure | Hedging | Foreign revenue / FX | card only if attached to a new dated event |
| commodity-exposure | Hedging | Commodity inputs | same as FX |
| covenant / going-concern | Distress flag | Breach, waiver, liquidity warning | never a card, never scored; shown as a relationship flag |
| new-subsidiary / entity | INTERNAL | Entity formation | `dataAvailable: false` in public version |
| (remaining triggers) | per taxonomy | | |

Distress triggers are relationship flags, never sell signals. INTERNAL triggers are assessed and shown as "searched, no public signal" rather than hidden. Those blanks are the argument for the internal-data version.

### 5.2 What extraction returns, per trigger

```
fired:              true | false
eventDate:          "2027-11-15" | null       copied, never computed
dateGranularity:    day | month | year        bare year stays bare
eventStatus:        upcoming | just_announced | completed | standing
figure:             "$1.5 billion"            unit always attached, or null
proceedsUse:        refinancing_only | partly_unapplied | unstated   (Sonnet, not Haiku)
verifiedQuote:      one contiguous sentence, verbatim, must carry the figures
evidence:           prose sentence the gate and renderer read
citations:          { form, date, url }[]
```

#### Debt-maturity returns a schedule, not a fact

`debt-maturity` stops selecting one tranche. It transcribes the long-term debt note **in printed order**, preserving its nesting:

```
scheduleSequence: [
  { kind: "row" | "adjustment" | "subtotal",
    section,                    // the printed section heading, verbatim, or null
    label,                      // verbatim, or null where the filing prints none
    instrument, rate, seniority, amount, maturityDate, dateGranularity,
    columnPeriod,               // the column header this amount came from
    sourceLine }                // verbatim, verified — see 8.3
]
```

Transcription, not judgment. Copy every row. Do not select, rank, summarize, or reposition. `seniority` and `section` come from the note's own printed headers. Where the filing states neither, the field is null, never guessed.

The one-answer-per-trigger schema is why HCA and Cigna rendered a false `no signal found`: ten tranches existed, one slot was available, and the model filled it with whichever tranche a newly issued bond had attached. No prompt wording lifts a one-slot limit.

**Worked examples in the prompt carry impossible placeholder figures**, never real ones. Given the wrong input the model fills the gap from its own instructions, and a real figure in an example becomes a fabricated row that verification of a generic caption will pass. See rule 5.

#### The base filing is searched for, not assumed

The debt schedule is always inside a titled note, and a filing that abbreviates its debt note is normal rather than a failure. So: search the newest 10-Q, then backwards by filing date through the prior 10-Q and the 10-K, stopping at the **first** filing that yields verified entries.

- The base filing's form and date render in the output, so an older-sourced ladder is visibly older-sourced.
- There is no scoring across filings. A tidier old ladder can never beat a real newer one — preferring whichever reconciles most cleanly is exactly what check 2 exists to catch.
- Every filing's first `LEAD_CHARS` (40,000) reaches the model regardless of the locator, so the locator only matters for notes beyond that point.

**A located-but-misread note is not an absent one.** Where a note is found and transcribed but every row carries a period other than the filing's own period of report, that is a read failure. It is reported as such, and it does **not** trigger the fallback — substituting an older filing's ladder would render a months-old position looking current. Only a genuinely absent schedule falls back.

#### The heading finds the note (v1.3)

The locator selects by the note's own printed heading — an optional literal `NOTE`, a number ≤ 30, a separator, then a words-only title containing "debt" — and falls back to coupon density plus magnitude only where no heading survives stripping.

Three false-positive classes, all rejected structurally rather than by word list:

- A note number is never zero-padded, which excludes cash-flow figures (`02 ) Proceeds from debt`).
- A note's table begins within about 1,200 characters of its heading, which excludes MD&A prose.
- A heading precedes its table, so a match inside an earlier heading's block is a caption, not a heading.

A note continuing past a prose break extends its host block rather than competing with it. The located span must contain a table, not merely a heading — a span with the heading and no table is the failure that produced fabricated rows.

**Known limitation:** the coupon-density fallback prefers fair value over carrying amount wherever both are candidates, because fair value systematically equals or exceeds carrying amount. The exposure is any note beyond the lead window sitting near a fair-value disclosure.

#### Issuances say what they retire

`new-debt-issuance` gains:

```
redeems:          verbatim description of the notes named as being redeemed
                  or repaid, or null
```

Copied, never inferred. This is what lets the position layer remove a retired tranche instead of leaving a card pointed at dead debt.

#### The stated-amount test

Treasury and capex triggers were firing on topic rather than cash. A pharmacy launch, a JV formation, and a held-for-sale classification all read as cash events because they mention money. Two fields fix it:

```
cashAmount:       the amount the filing states for this event, or null
projectName:      the discrete project the filing names, or null
```

`cashAmount: null` means table, never card, for every trigger. Direction is not extracted; the trigger's bucket already carries it, and a second source of truth can disagree with the first.

`projectName` separates a named project (UHS's Miller Medical Plaza, 80,000 sq ft, completion Q4 2026) from a period total (Tenet's $348M of six-month property purchases). Amount plus name is a project. Amount with no name is period spend.

Extraction rules: copy dates, never compute. Bare year stays bare. One contiguous sentence, never two welded together. Money keeps its unit. "Not found" is a valid answer.

---

## 6. The gate

Deterministic. No model. Golden-tested against cached facts, which is what the app itself reads.

### 6.0 Position assembly (new in v1.1)

Until now no component held "here is this company's debt as of today." Extraction returned independent per-filing answers and the gate judged each one alone. That job was smeared across three places that could not do it: the extraction prompt implicitly picked the most important tranche because the schema fit one; the condenser reconstructed a ladder from a run-on sentence and appended "+N more tranches"; the gate guessed that a refi fact and a new-debt fact were the same event because they shared a citation.

`position.ts` replaces all three. Pure code, no model calls, reads only cached answers, so rebuilding a position is free.

**Algorithm**

1. Start from the newest 10-Q or 10-K `debtSchedule`. That is the base ladder.
2. Apply every 8-K dated after that filing, newest last. An issuance with `redeems` naming a tranche removes that row and adds its own.

   **Partial redemptions.** A row is marked retired only when the redeemed amount equals its outstanding balance. A partial redemption reduces the balance and the row stays live. The full-versus-partial test is scoped to the clause naming that row's own tranche, because one 8-K sentence routinely carries both a full redemption of one tranche and a partial redemption of another — a sentence-level test answers about the wrong tranche half the time. Ambiguity fails safe toward keeping the row: wrongly retiring silently deletes real debt, while wrongly keeping shows a row the filing itself lists.
3. Newest filing wins per tranche. Match on instrument description, rate, and maturity together, never on amount alone (two same-size same-year tranches can be distinguished only by lien).

   **Authority (v1.3).** The note is the position. An 8-K overrides a note row only when it post-dates the note's period of report. An 8-K describing a redemption the note has already reflected must not retire a row the note still reports as outstanding — that reads a partial call as a full one and deletes a live tranche from the ladder. A retired row neither renders nor cards, so this failure removes a company's most callable event silently.

   **Identity requires that a match was possible (v1.3).** A row carrying no rate and no maturity can never satisfy the identity test, so its non-match is not evidence that it vanished. Where identity cannot be established either way, the row carries forward unchanged rather than being declared missing and re-added as `unconfirmed` beside itself — treating an impossible match as a disappearance manufactures duplicates.
   **A note-prose retirement never adjusts a balance (v1.4).** The partial-redemption rule above was written for 8-K retirements, and it is correct there for a reason worth naming: an 8-K that post-dates the note describes an event the note's figure cannot yet reflect, so the balance must be adjusted or the ladder reports a number stale by exactly the redeemed amount.

   A retirement stated in the debt note's own prose (Session 19) is the opposite case under the same rule. The note's table is as-of the period end; the note's prose describes what happened during the period leading to that table. The figure is already net. Centene prints $1,067M outstanding and states $118M repurchased in the quarter — $1,067M is the balance *after* that repurchase. Subtracting again reports $949M, a number in no filing.

   - An **8-K** retirement adjusts the balance, because it post-dates the note's figure.
   - A **note-prose** retirement never adjusts the balance, because the note's table is already net of its own prose.

   The same authority rule produces opposite arithmetic, and that is the reason, not an exception to it: authority is about which document speaks last about a given period, never about which field a retirement arrived in. A note-prose retirement supplies the *cause* of a movement the ladder already shows, attached to the row as evidence.

   Consumption keeps the three outcomes above exactly, with only the arithmetic changed:

   - **Full** (the amount equals the row's stated outstanding): status `repaid`, with the note's own sentence attached — in place of a row that would otherwise drop with nothing explaining it.
   - **Partial**: the row stays `live` at the note's own figure, *unchanged*, with the prose attached as the movement's cause.
   - **Ambiguous**: nothing attached, nothing changed, the row kept. Fails safe toward keeping, as above.

4. Mark each row: `live` · `retired` (an 8-K names its retirement) · `repaid` (the filing itself states a nil balance, or the note's own prose retires it in full) · `matured` (the stated maturity date has passed) · `unconfirmed` (no longer listed, no filing explains it). Only `live` cards.
5. Sort by maturity date.

**Rules**

- An `unconfirmed` row never cards. It renders in the table with its status stated.
- A `retired` row never cards and renders only where it explains a live one (Tenet's Nov 2025 redemption as a KEY POINT).
- The ladder's completeness comes from the checksum (section 8), not from the position layer. Ordering an incomplete list produces a tidy wrong answer.

**Deleted by this layer:** the condenser's tranche-clause picker, the "+N more tranches to YYYY" suffix, and the same-citation refi/new-debt dedup. Three approximations out, one deterministic module in.

### 6.1 Bucketing

Fixed lookup, trigger id → one of four buckets: Refi, New debt, Treasury, Hedging.

### 6.2 The card test

One rule, applied identically to all four buckets. No scoring, no cross-bucket ranking.

| Outcome | Condition |
|---|---|
| CARD | dated, and either maturity ≤18 months out, or announced <90 days ago |
| TABLE | completed · standing · no verifiable date · bare year · >18 months out · announced >90 days ago |

Two universal hard rules run before any per-trigger logic: standing → table always; completed → table always, except new-debt-issuance which runs the proceeds test.

**Unchanged in v1.1.** The rule is the same rule. What changes is what the gate is allowed to look at.

Three conditions added, all restrictions:

- A tranche cards only if the position marks it `live`. `unconfirmed` and `retired` never card.
- `cashAmount: null` never cards, any trigger.
- A completed event older than 12 months sorts to the bottom of its bucket and renders its age (`Mar 2025 · 17 months ago`). Never suppressed. Suppression is the A1 mistake: deleting a line asserts something false.

### 6.3 After the test

- **Dedup per event.** Multiple triggers citing the same filing collapse into one card.
- **Sort by time-to-event only.** Live/pending first, then nearest date.
- **0 to ~8 cards. No per-company cap.**
- **Refi/new-debt duplication:** removed in v1.1. A newly issued tranche is a row on the ladder like any other, so it cannot double-render. The same-citation guess is deleted.

### 6.4 Why company scoring was removed

v1 scored companies (need value × recency, treasury 1.5×, call threshold 1.2). Dropped because: the number meant nothing to a viewer, a 12-month refi scored like a 5-year one, one real event fired as three opportunities, and "is treasury more urgent than refi" is the RM's call. The treasury skew now lives in the taxonomy: these triggers exist at all, and most tools would not look for them.

---

## 7. Output

### 7.1 Card

```
REFI · DEBT MATURITY                    Tenet Healthcare Corp

CALL ABOUT   Refinancing the $1.5B 5.125% notes due November 2027,
             15 months out.

WHY NOW      [two sentences max, connects the event to why it is live]

KEY POINTS   · $1.5B due Nov 2027; 9 more tranches run to 2033
             · Priced $1.5B + $750M of new notes Nov 2025 to redeem
               an earlier maturity
             · Cash $2.17B at Jun 30, down from $2.88B at Dec 31

SOURCE       10-Q 2026-07-29 ↗ · 8-K 2025-11-18 ↗
```

- CALL ABOUT: the action, imperative, must name an amount or date (enforced).
- WHY NOW: two sentences, connects at least two facts, or it is not a card.
- KEY POINTS: 2 to 4 bullets. First bullet is the fact that triggered the card. One fact + figure each. No bullet asserts a relationship between two facts. (Replaced OPEN WITH, which produced unverified connective claims.)
- Every figure carries its unit. A figure with no determinable scale is dropped, not guessed.
- Cites every filing any field draws on.

### 7.2 Portfolio table

```
DAVITA INC.                          no action this week

Refi          · 4.625% notes due June 2030, 46mo out        10-Q 2026-08-04 ↗
New debt      · $500M Term Loan B-2 added June 2026          8-K  2026-06-08 ↗
              · $2B buyback authorization increase           8-K  2025-08-20 ↗
Treasury      · no signal found
Hedging       ⚑ $4.3B floating-rate debt, worth raising      10-Q 2026-08-04 ↗
```

- One line per verified trigger, under its own bucket, built from that trigger's own evidence prose. No model in the table.
- All four buckets always shown. "no signal found" proves the framework ran.
- Hedging flag as a marker, not a sentence.
- Condenser rules: debt-maturity picks the clause matching the fact-guarded event date, never position, and appends "(+N more tranches to YYYY)"; new-debt-issuance summarizes deal total + lead tranche, only a total the filing states; multi-period comparisons show most recent period only.
- Bare lines forbidden: "no figure disclosed" with its source instead.

### 7.3 Empty state

> No actionable events this week. 4 buckets checked, 15 triggers run, 12 found no signal.

Reads as rigor. A blank reads as broken. Matters most for low-debt names.

### 7.4 Other surfaces

- **Banner:** "This week: N cards" above the cards.
- **As-of line:** run date, "based on filings retrieved from SEC EDGAR."
- **Company names** link to their EDGAR page.
- **Agent trace:** collapsed by default, kept behind a toggle. Shows the loop reasoning line by line. Kept as the architecture evidence for the demo.
- **Methodology panel:** collapsed, plain-English explanation of the scan and the card test.

---

## 8. Guards (what protects the output)

| Guard | What it checks | Failure mode it exists because of |
|---|---|---|
| Fact guard | Event date appears in the cited filing text, anchored to fact-specific words | UHS "due 2026" verified a fabricated 2026-12-31 that appeared elsewhere in the same 10-Q |
| Quote verification | Quote is one contiguous sentence in the source and carries the deal figures | Haiku spliced two true sentences 1,169 characters apart into one |
| Number guard | Every figure on screen appears in a cited filing, correct scale | Hallucinated figures, Encompass "$17.9" off by 1,000,000× |
| Scrape guard | Structural test (terminal punctuation, numeral-to-word ratio) blocks raw table fragments | Concentra's raw balance-sheet scrape reached the UI |
| Figure-type binding | Currency vs per-share vs count; wrong type dropped | Ownership % read as asset value, dividend per share read as buyback size |
| Structural card guard | CALL ABOUT names figure or date; no derived sums | Centene's self-computed "$2.0 billion" |
| Loud failure | Narration failure renders a banner, never silent template prose | Three silent template fallbacks across three sessions |
| Determinism tripwire | Same book ×3, byte-identical, local and live | Session 13 live runs disagreed with each other |
| Golden tests | Card/table assertions locked to real cached facts; live count is the number that matters | Session 10 shipped the eligibility layer with zero semantic tests |
| Annotation scan (Session 17) | Pattern scan of rendered output for dev markers | Five dev notes rendering live |
| **Check 1 — internal walk (v1.2)** | Each printed subtotal reconciles against the rows under its own section heading, plus any earlier subtotals it rolls up | HCA and Cigna rendering false `no signal found` while holding real maturities |
| **Check 2 — balance-sheet anchor (v1.2)** | The note's figures reconcile to the balance sheet's own debt captions | CHS's sequence carrying another company's figures; a stale note ties internally on its own |
| **Position consistency (v1.1)** | No card references a tranche marked `retired` or `unconfirmed` | A card pointed at debt an 8-K already retired |
| **Stated amount (v1.1)** | A carding treasury event has a `cashAmount` from the filing; `capex-program` is exempt when `projectName` is present | Pharmacy launches, JV formations, and held-for-sale classifications firing as cash events |
| **Debt-note heading (v1.2)** | The located span contains a debt-note heading | The locator selecting an interest-expense or fair-value table that reconciles perfectly on its own |
| **Column binding (v1.2)** | Every amount comes from the same period as the base filing's period end | A prior-period column read as current; a wrong-column row can sum to a wrong-column subtotal and pass check 1 |
| **Check 3 — coverage (v1.5)** | The ladder plus the note's prose instruments account for the anchor's own stated total debt | UHS rendering $1.1B against $4,851,847K with Checks 1 and 2 both silent, because both only compare the note to itself |
| **Anchor exclusivity (v1.5)** | Every schedule row, balance-sheet caption, prose instrument and revolver figure cites the anchor filing | UHS assembling one position from three filings and three dates; Cigna rendering a December ladder beside a June balance sheet |
| **Capacity is not debt (v1.5)** | A facility contributes its drawn balance; an undrawn commitment is reported as capacity and never summed | Molina's $1.25B facility (nothing drawn) and Tenet's $1.900B (drawn $0) both counted as debt, reading 134% and 115% coverage |
| **One instrument, one field (v1.5)** | An instrument is in `scheduleSequence` or `proseInstruments`, never both; the filing's typography decides | The same term loan returned as "$1,448,000 thousand" in one field and "$1,448 billion" in the other |
| **Impossible amount (v1.5)** | No single entry exceeds twice the total it is a component of | A misplaced decimal put $1.448 TRILLION on a ladder line |
| **XBRL denominator (v1.6)** | The coverage denominator is the filer's own tagged debt total where its company-facts data reaches the anchor's period end; where it does not, the balance-sheet captions as read, labelled model-read on the surface | A denominator nobody could name, and a filer silently dropping to model-read on a transient fetch failure — "we could not read it" collapsed into "this filer tags nothing" |
| **XBRL maturity buckets (v1.6)** | Where the filer tags maturity buckets, they render as a floor beneath the ladder; where it tags none, the ladder stands alone and no floor is fabricated | A ladder with no way to show that it is missing a whole band of maturities |
| **Unsized event (v1.6)** | An event whose confirming filing states no amount renders in full and nets zero; the rolled total names how many it excluded, and why | An 8-K confirming a revolver repayment with no figure, and a 10-Q figure describing a different date, would otherwise be joined into one number neither filing states |
| **Row outside the subtotal (v1.6)** | Every ladder row is closed over by some subtotal in its own note; one that is not renders as a row with its exclusion stated | Check 1 ties on the rows it can see and says nothing about a row no subtotal ever counts, while coverage counts it |

### 8.1 The two checks — what each proves

A debt note is **nested**, not a flat running total. Each subtotal covers the rows under its own printed section heading, and higher subtotals roll up earlier ones. A single-section note walks flat; a note with "Short-term borrowings:" and "Long-term debt:" does not, because the long-term subtotal excludes what is printed above it. Rows are never repositioned; each carries its heading verbatim.

**Check 1, the internal walk.** Proves completeness — no row was dropped. It is arithmetic over subtotals the company itself prints, so it needs no second model and no human. It does not prove field accuracy: a row copied with the right amount and the wrong maturity year still sums. That stays the fact guard's job.

**Check 2, the balance-sheet anchor.** Every 10-Q and 10-K carries debt captions on its balance sheet. Reconciling the note against them catches what check 1 structurally cannot: a stale or wrong note ties internally on its own. The captions are read as present, never as a fixed formula — finance leases sometimes sit outside `long-term debt`, and short-term borrowings can carry their own caption or be folded into a combined one.

Reported separately per company, never blended. A company passing one and failing the other names its own failure.

### 8.2 The four-state verdict

| Verdict | Meaning |
|---|---|
| `pass` | both checks tie, nothing left unconsumed |
| `pass-partial` | both checks tie, but the source section holds more |
| `fail` | at least one check did not tie |
| `no-schedule` | nothing was located — a locator problem, not a reconciliation one |

`pass-partial` exists because both checks are self-consistent over whatever was captured; neither can see a table that ended early. The book tie rate excludes `no-schedule` companies from its denominator, so the headline measures one thing rather than two.

**When a check does not tie:** the ladder renders with an explicit gap in dollars. Never suppressed.

**Scope:** debt only. Cash and 8-K events have no published total, so no equivalent proof exists. Best available is a coverage count (filings read = filings answered), which is weaker and stated as weaker.

### 8.3 Verification — what "traces to the filing" actually means

Every entry must be locatable in the cited filing text. Three stages of tightening, measured across 226 entries book-wide:

| | literally checkable | co-occurrence load-bearing |
|---|---|---|
| raw match | 37% | 63% |
| + whitespace and glyph normalization | 88% | 12% |
| + currency-symbol tolerance | 98% | 2% |

Before that work the stated guarantee — every figure traces to a verbatim line — was aspirational; what actually held was "the figures appear near each other somewhere in the filing." The cause was `sourceLine` being a reconstruction rather than a quotation: the model joins table cells that are not adjacent in the stripped text.

**Both the sourceLine and the amount are verified.** Caption-only verification is not enough — captions like "Total long-term debt" appear in nearly every debt note, so a generic caption beside a fabricated figure passes. Corroboration tries exact value equality against the entry's own verified sourceLine first, then falls back to a digit scan. Exact equality, not tolerance: two close figures are two different figures.

**Verification is bounded to the row it verifies (v1.3).** An amount must appear within the located note span and within a bounded distance of the instrument text it is claimed for. Co-occurrence requires the instrument identity *and* its amount in the same region. An unbounded scan is not a check: across a filing of 183,000 characters, almost any three-digit figure appears somewhere, and three fabricated rows reached a rendered ladder on exactly that.

*Corollary:* a bound is only as good as the position it is measured from. A figure printed both in the note and on the balance sheet must resolve to the occurrence inside the note, or correctly-transcribed rows are rejected as "outside" it.

**A paraphrase is not a quote.** The verified quote passes verification; the rendered prose does not, and the rendered prose is what an RM reads. A paraphrase whose stated date is later than the filing that carries it is rejected, bounded by filing date rather than period of report — measured against the live book, the filing-date bound produced two true catches and one documented over-fire, while the period-of-report bound flagged every legitimate subsequent event.

### 8.4 Scale — derived in code, never volunteered

Missing units caused four separate bugs before the class was moved out of the prompt. The proof it was never a prompt problem: the same filing, two runs, per-row units attached once and neither units nor caption the next.

Resolution order, per entry: the amount's own scale → the filing's nearest-preceding governing declaration → the model's caption as fallback → indeterminate and dropped. The declaration finder anchors on the word "dollar", so a share count in thousands can never be read as a money scale, and returns null rather than guessing.

`checkMoneyScale` requires a positive signal — an explicit scale word, a per-share token, or an unscalable magnitude. A bare `$549` is indeterminate; `$1,000,000,000` is not.

### 8.5 The outstanding column is not one measure (v1.3)

Read from the filings' own words, some companies' ladder rows carry par and others carry carrying value — one company's rows moved by exactly a stated par repurchase, another's moved $700K on an untouched fixed-rate note, with the next table in the same filing printing "Face Amount" and "Net Amount" as separate columns.

A structural classifier was built and discarded: it misread a company that prints its principal total before deducting discount. Separating a discount line from a current-portion line needs the labels' meaning, and **a measure label wrong on part of the book is worse on screen than no label.**

What is decidable is the movement. Measured across the book, accretion runs 0.076% to 0.2% of balance and principal changes run 6.1% to 10.0% — a thirty-fold gap with nothing in it. A sub-threshold move renders with its size and states that it cannot be read as a repayment. The walk (8.1) shows the measure without asserting it.

What no guard catches: "a banker would know this maturity was already refinanced." Only a domain expert reading the output finds that. The RM review is a standing process step, not a one-off.

---

### 8.6 Check 3 — coverage, and the definitions it rests on (v1.5)

Checks 1 and 2 both compare the note to itself. Check 1 asks whether the note's rows reconcile to the note's own subtotals; Check 2 asks whether one of those subtotals matches the balance sheet. **A ladder missing an entire term loan passes both**, because nothing ever asked whether the ladder describes the company's debt. UHS is the case that forced the third check: $1.1B rendered against a stated total debt of $4,851,847K, with both existing checks reporting nothing wrong.

**Definitions.** These are the terms the check is written in, and they are stated here because every one of them was a defect before it was a definition.

- **Anchor filing** — the company's most recent 10-Q or 10-K. Not the most recent one whose debt note is locatable; not the most recent one that yields a ladder. The most recent one, full stop. If its debt note yields no ladder, the ladder renders empty with that reason stated, and is never filled from an older filing on any signal.
- **Stated total debt** — the sum of the debt captions the anchor's own balance sheet prints, read from the anchor's own period column. It is the denominator, and it is named on the rendered line rather than asserted from nowhere.
- **Ladder entry** — one instrument's own statement of what is owed on it. A note may print that as a table row or as a bullet or as a sentence, and all three are real. Which FIELD it lands in is decided by which of those the filing chose: table to `scheduleSequence`, bullet or sentence to `proseInstruments`. Exactly one field, always.
- **Debt** — the drawn or outstanding balance of an obligation.
- **Capacity** — a committed but undrawn amount. Real, useful, reported on its own line, and never summed as debt. A revolving facility contributes its drawn balance and never its size; where no drawn balance is stated it contributes nothing.
- **Bridge** — the note's own discount, premium and deferred-financing-cost lines. Subtracted before the residual is judged, never absorbed by the threshold.
- **Captured face** — every ladder entry summed at face, after dedup and after capacity is removed.
- **Residual** — stated total debt less captured face less the bridge, as a fraction of stated total debt.
- **Debt content** (v1.6) — what a figure printed inside a debt note has to be for the note's boundary to keep it. Used ONLY to decide where a note ends, and deliberately wider than the coupon-near-maturity test that finds a note in the first place: measured on the real ten, a boundary built on coupons removed DaVita's revolver line, Quest's whole maturity schedule and Centene's $1,289 million repurchase, because a maturity-year ladder, a facility balance and a repurchase are all debt and none of them carries a coupon. Two positive tests, either sufficient — **(a)** the figure relates to a debt principal: it matches the filer's own XBRL stated total within 2% at any scale, or it is a principal-sized share of it (at least 0.5%, with a currency scale word printed beside it), or it already appears in the part of the span established as debt disclosure; **(b)** the figure sits within 200 characters of a stated coupon near a maturity. Two exclusions that apply regardless — a figure under 0.5% of stated total debt is interest, fees or amortization at this company's scale, and a figure with no currency scale at all is a ratio or a covenant threshold, not an amount. **It abstains when the filer tags no XBRL total**: with no total to relate a figure to, every test in (a) is unanswerable, and the boundary keeps the figure. HCA is the worked example, and the rule it stands for is that a boundary never cuts on an absence of evidence. **Circularity guard:** the boundary runs before extraction, so it may use only the filer's own tags and the figures printed in the span — never an extracted ladder row, which would be deciding what to show the model from what the model already said.
- **Unsized event** (v1.6) — an event a filing states without stating its amount. It renders with its date, its filing and its verbatim sentence, and the words "amount not stated in the confirming filing", and it moves nothing. UHS is the worked example: two 8-Ks confirm the repayment of its revolver borrowings and neither prints a figure, while the $225 million sits in the 10-Q describing a June 30 *balance*. Sizing the event from a filing that does not state it is a stitch, not a reading. Distinct from an **unconfirmed** event, which moves nothing because no filing says it happened; an event can be both, "unconfirmed" binds the arithmetic, and the surface states both gaps. A rolled total names how many of each it excluded, because a roll-forward that silently omits a real event reads as complete when it is not.
- **A row outside the note's own subtotal** (v1.6) — a ladder row that no subtotal in the note ever closes over, so nothing in the filing's own arithmetic checks it while it is counted in the ladder and in coverage. It **renders as a row, with its exclusion stated on the surface**, and is never moved to the prose field: moving it would take it out of Check 1's walk, the one check that could find it, and prose entries are deduped against table rows, so a row-shaped fact in the prose field risks being dropped rather than flagged. Measured across all ten at v28: none. This is a guarantee, not a repair.

**Two tests, reported separately**, because they fail for different reasons and one percentage hides which:

1. **Category completeness — no threshold.** Every debt category the note states to exist is either captured or flagged as stated-but-missing. A term loan we hold no amount for is flagged regardless of size, because "small" is not the same as "accounted for".
2. **Residual materiality — a measured threshold.** See below.

**The threshold is 2.5%, and it was measured rather than chosen.** Across all ten companies at the anchor, comparing stated total debt against the note's own rows at face:

| company | residual | what it is |
|---|---|---|
| Encompass, Cigna | 0.00% | no discount line stated |
| Quest | 0.57% | "Debt issuance costs" (32) |
| DaVita | 0.62% | "Discount, premium and deferred financing costs" (66,503) |
| Tenet | 0.64% | "Unamortized issue costs and note discounts" (85) |
| Molina | 0.82% | "Deferred debt issuance costs" (31) |
| HCA | 0.91% | "Debt issuance costs and discounts" (451) |
| CHS | **2.00%** | "Less: Unamortized deferred debt issuance costs" (192) |

Every one of those figures is the note's own bridge line, itemised in the same table — face exceeds carrying by exactly the unamortised cost, which is what those measures mean. So the bridge is **explained, not tolerated**: it is subtracted first, and the line is set for what remains. 2.5% clears the largest measured bridge item with margin while still catching what the check exists for — UHS's missing $3.7B was 77% of its total, and its $225M drawn revolver alone is 4.6%. The gap between "explained bridge" and "missing instrument" is more than an order of magnitude, which is why a single threshold can serve both.

**If a future company's bridge exceeds the line, the answer is to itemise the new bridge item, never to raise the line.** The measurement is pinned as a test suite (`lib/events/bridgeMeasurement.test.ts`) that reproduces every figure above from the committed baseline, so a book whose bridge moves fails loudly and states the new figure.

**Never suppressed.** A ladder with no anchor caption renders "coverage unmeasured — the anchor filing states no balance-sheet debt caption to measure against". A reader must be able to tell a book that was checked and found complete from one that could not be checked.

### 8.7 The two tiers, and what a position may be pinned as (v1.6)

**Tier 1 is the anchor position.** It is the ladder as the most recent
10-Q/10-K states it, and it is the ONLY tier that carries a coverage
percentage — coverage divides captured face by stated total debt, stated
total debt comes from a balance sheet, and there is no balance sheet for "the
anchor plus three weeks."

**Tier 2 is what has happened since.** Every event carries its own date, its
own verbatim source and the filing that states it. **Nets, never stacks:** an
issuance adds its stated amount, a confirmed repayment subtracts against the
named tranche, and an intended-but-unconfirmed repayment subtracts nothing
and stays on the ladder marked pending. What makes an event Tier 2 is
structural and identity-first — a document that IS the anchor can never
describe an event since it, whatever its filing date says. The rolled total
is always labelled *unverified against a balance sheet until the next 10-Q*,
and it names how many events it excluded and why.

**An event with no amount in its own confirming filing renders and moves
nothing.** Its date, source and verbatim sentence render, with the words
"amount not stated in the confirming filing", and its effect is zero. Two
reasons an event can net zero and they are not the same reason: *unsized*
means we do not know how much, *unconfirmed* means we do not know that it
happened. The surface states both.

**A row the note's own subtotal never counts renders as a row**, with its
exclusion stated on the surface, and is never moved to the prose field —
moving it would take it out of Check 1's walk, the one check that could find
it. Measured across all ten: none.

### 8.8 Golden files — the nine criteria (v1.6)

A golden file pins **one company's position as of one named anchor filing**
(period of report and filing date), and is written only when all nine hold:

1. every row's amount, maturity, and instrument correct against the filing;
2. every amount in the unit the filing prints and with its basis stated
   (face / carrying / outstanding);
3. every row cited to the anchor filing, or to a post-anchor 8-K for Tier 2;
4. **the note's subtotals tie where it prints any; where it prints none, the
   stated total triangulates against the balance-sheet captions and the
   filer's XBRL tag instead, and Check 2 plus coverage carry the weight;**
5. stated total triangulates to the filer's XBRL tag, or is labelled
   model-read;
6. coverage passes both tests, category-complete and residual under
   threshold;
7. capacity separated and excluded from the debt sum;
8. structure faithful to the note in tranches, priority class, and instrument
   type;
9. Tier 2 events status-corroborated and source-verified, and the whole state
   reproduces on three independent re-asks.

**Cards and derived lines are never pinned.**

**Criterion 4 was amended, and the amendment is recorded because the
reasoning matters.** As first written it read "the note's own subtotals tie",
which permanently excluded every prose-only filer — including UHS, whose
debt note prints no subtotal at all and which is the shape the prose-note
routing rule exists for. A criterion that can never hold for a shape that
really exists is not strict, it is blind to that shape. The amendment states
what "subtotals tie" always meant: a check that only exists where subtotals
do. Where none are printed, triangulation replaces it — the balance sheet's
own captions against the filer's own XBRL tag — which is a *stronger* tie,
not a weaker one: a subtotal is the note checked against itself, while
triangulation is two independent statements by the filer agreeing.

**Computed versus attested.** Criteria 1, 8c (instrument type) and 9b (three
re-asks) cannot be computed — a tool comparing its own output to itself
proves nothing about whether it matches a filing, which is why verification
sheets exist and a person reads them. Those three are attested, recorded in
the file with who confirmed what and when. Every criterion names the specific
defect it defends against, and each is asserted by name in the offline suite.

**A golden file is pinned to its filing set.** The filing-list cache carries
a 24-hour TTL, so the corpus can move without anyone touching the code. Same
documents in, same answer out is the whole claim; a moved set returns
*not-applicable* naming what was added and removed, and must be re-signed
rather than compared against. Divergence otherwise fails **by name** — field,
expected value, actual value — and a golden file commits the
`CompanyResult` it was signed from so the check runs offline.

### 8.9 What the ladder does not yet carry (v1.6)

Stated here because it bounds what a golden file currently means. A row
carries a `section` string, used only for subtotal matching, and a
`seniority` string taken verbatim from the note's own section header and
rendered as a prefix. Neither is normalized, and no instrument-type field
exists at all. Measured: two filers of six carry a class on most but not all
rows, in four different spellings; three carry none. So the ladder is one
flat maturity-ordered list where a note may print senior secured and senior
unsecured as separate sections, and an absence of class renders as an absence
of seniority rather than an absence of disclosure. Priority class and
instrument type — normalized, complete, rendered and structural — are the
first semantics item of the next session.

### 8.10 The month-count convention (v1.6, Session 22 Stage 1)

**A month count is whole calendar months COMPLETED.** From date A to date B,
it is the number of times one calendar month can be added to A without
passing B, clamping to the last day where the target month is shorter.
Negative when B precedes A, so direction is readable from the number itself
(Rule 28).

**A count never decides a window.** Whether a maturity falls inside the
18-month refi window is decided by comparing two dates — `B <= A + 18
calendar months` — so no rounding can carry a row across the boundary in
either direction. The count is for reading; the comparison is for deciding.

**What this replaced, and why it mattered.** Month counts were elapsed days
divided by an average month of 30.44, rounded. That was wrong in two
directions at once. It rounded, so a tranche that matured three days ago
read as "0 months out" with nothing to say it had already gone. And it was
an approximation nobody had named, so Encompass's 2026-05-29 issuance
against a 2028-02-01 maturity printed 20 where month-boundary counting says
21, with no statement of which the surface meant. Under this convention it
is 20 — twenty whole months completed, and 3 days.

**Measured before it was adopted**, across all ten companies at the pinned
as-of: 56 dated rows, **27 counts moved by one, and 0 card verdicts moved.**
The one row that proves the window must be a date comparison is CHS's 6⅞%
notes due 2028-04-01: they are 18 whole months from 2026-09-07 and are *not*
within 18 months of it, because eighteen calendar months lands on 2028-03-07
and the notes mature 25 days later. Under a count test they would have begun
carding; under the date test they correctly do not.

**Consequence for pinned state:** every golden file carrying a derived month
count was signed under the old arithmetic and no longer reproduces. Those
files are re-signed, never edited — see 13.3.

### 8.11 The semantics layer (v1.7 — Session 22)

What an instrument IS, read from the filer's own words and never inferred.

**Facility type, not priority class.** The ladder names each instrument's
KIND, with the filing's own grouping label beside it. It does not name a lien
ranking: the tool reads section headings and instrument names, never the
credit agreement's intercreditor terms, and senior secured notes may or may
not be pari passu with a senior secured term loan. Asserting a ranking from a
heading is Rule 1's error one level up. True lien ranking across instruments
is a v2 capability and is deliberately not claimed. (Rule 47.)

**One concept, one field, three sources.** Priority class is read from the
row's heading strings, then the instrument's own name, then the note's group
seniority sentence — whichever the filing provides. Where two schema fields
held that one concept, the model filled whichever it chose, per company: 26
rows in one, 8 in the other, 4 in both and disagreeing, **zero agreeing**.
Every reader merges them; none chooses between them. (Rule 39.)

**Nothing is inferred from an absence.** A row whose sources state no class
renders "class not stated on this row" — never "unsecured", never blank. A
partial ladder with honest unclassed rows is faithful; a silent default is
not.

**A group statement reaches only its own scope.** "Each of these notes are
senior unsecured obligations" clears the note rows and not the credit facility
on the same ladder. The class is read from the span of the sentence still
describing its own subject, and a head naming two classes classes nothing.
(Rule 38.)

### 8.12 Facilities and liquidity (v1.7 — Session 22)

**A facility is an instrument.** It renders on the ladder whether or not it is
drawn, carrying the maturity its filing states. Measured before this existed:
18 facilities, 16 stating a maturity, 5 whose ladder row carried one.

**A drawn balance is operational, never a refinancing signal.** A revolver is
borrowed and repaid in the ordinary course. A facility cards on its own
in-window maturity — a renewal negotiation with a date on it — and never
because something is drawn under it.

**Liquidity is computed, not juxtaposed.** Cash plus undrawn capacity across
every committed facility, one sum, **both halves as-of dated and the dates
required to agree** — a total summed across two dates is true at neither.
Never derived from size minus drawn, which is the computed-not-read figure the
facility guard rejects.

**Read the kind of retirement, not just its date.** Where the filing says a
tranche was repaid "at maturity", the pattern line reads *pre-funded and
repaid at maturity* and prints no month count. "Refinanced N months ahead"
describes behaviour that did not happen. (Rule 40.)

### 8.13 Provenance is per figure (v1.7 — Session 22)

**Every displayed figure carries the sentence that states IT**, its own
document and its own character offset — on the product surface and on the
signature surface alike. A real figure beside a real quote that does not
contain it is composite fabrication wherever it appears, and the signature
surface is the worst place for it. (Rule 46.)

**Presence is not belonging.** A check confirming that a figure and a sentence
each appear somewhere can never detect that they do not belong together. The
check asks whether the sentence states the figure, reusing the facility
guard's own rule rather than a second weaker copy.

**Verify as printed, display normalized.** Amounts display in one house scale
($millions) with the filing's own printed figure beneath; the golden pins the
printed one. A belonging check compares the as-printed value, never the
normalized display.

**A citation is the document the quote was found in**, never the one the model
named. Where the model cites nothing and the quote verified, the corpus
supplies the citation. A company reporting no citations had five verified
triggers and an empty filing set — and a golden pinned against no documents
cannot fail. (Rule 44.)

## 9. User journeys

### 9.1 Weekly run

1. RM opens the tool, enters passphrase.
2. Types or pastes the book (one name per line, up to 12).
3. Clicks run. Trace streams; warm names return in 1 to 2 seconds, cold names in 60 to 90.
4. Reads the banner: how many cards this week.
5. Reads each card top to bottom: what to call about, why now, the facts, the sources.
6. Scans the portfolio table for the names without cards.
7. Opens a source link to confirm anything before calling.

### 9.2 Prep for a specific client call

1. Types one name.
2. Reads all four buckets for that company.
3. Uses the table lines as the briefing: every maturity, every recent deal, the cash position, any hedging exposure.
4. Opens the cited filings for detail.

### 9.3 Override the cut

1. A name has no card but the RM has a reason to call.
2. Opens that company's table block. All four buckets, every verified fact, are there.
3. Builds their own angle from the facts.

### 9.4 The demo (Gabe)

1. Gabe types five names of his choosing. Not a frozen brief; any five.
2. Watches the trace, sees the pipeline reason.
3. Sees cards with real amounts, dates, and filings, clicks through to confirm.
4. Runs the same five again, sees byte-identical output.
5. Asks how it works; the methodology panel and the build log answer.

### 9.5 Cold company

1. RM types a name nobody has run before.
2. Tool fetches from EDGAR, reads the corpus, extracts, narrates. 60 to 90 seconds.
3. Answers cache. Every later run of that name is instant, by anyone.

---

## 10. Actions and insights the user gets

| Insight | Where | Action |
|---|---|---|
| This client has a maturity inside 18 months | Refi card | Call about refinancing before they go to market |
| This client just priced new notes | New debt table / card | Call about the balance, about what it refinanced |
| This client announced a deal with financing undisclosed | New debt card | Call about acquisition financing |
| This client is about to receive divestiture proceeds | Treasury card | Call about where the cash lands, operating accounts, sweep |
| Cash moved >30% QoQ | Treasury card | Call about idle balances |
| This client carries floating-rate or FX exposure | Hedging flag | Raise hedging, even with no event this week |
| A covenant was amended or breached | Distress flag | Relationship check-in, never pitched |
| Nothing this week, and the tool checked | Empty state | Move on with confidence |
| The full debt ladder of a client | Refi table line, "+N more tranches" | Shape the refi conversation |
| What the tool cannot see from public data | INTERNAL triggers | The argument for the bank-internal version |

---

## 11. Edge cases and how each is handled

### 11.1 Data and resolution

| Case | What goes wrong | Handling |
|---|---|---|
| Ambiguous company name | Resolves to the wrong company, confidently | Open. Name → CIK → confirm the EDGAR name and ticker back to the user before running. Accepted limitation today. |
| Company went private / no longer files | Lookup errors | Detected at resolution (Select Medical, Session 6a). Error shown, run continues for the rest of the book. |
| Company is foreign private issuer (20-F, 6-K) | Corpus picker finds no 10-Q/10-K | Out of scope. Show "not a domestic SEC filer" rather than an empty scan. |
| Recent IPO, fewer than two 10-Qs | Cash QoQ cannot compute | Cash → table, never card. Already the rule. |
| Filing list stale | New filing missed, real card hidden | 24h TTL on the list. Permanent cache only on filing text. |
| EDGAR rate limit or outage | Fetch fails mid-run | Throttle at ~8 req/sec. Failure must be loud per company, not silent. |
| EDGAR name casing differs run to run ("DaVita Inc." vs "DAVITA INC.") | Diff tooling produces false changes | Key on CIK, never on name string. |

### 11.2 Extraction

| Case | What goes wrong | Handling |
|---|---|---|
| Bare-year maturity ("due 2026") | Dec-31 convention cards something that may be past | Bare year → table, never card. Dec 31 is safe for excluding, never including. |
| Same-size, same-year tranches (Tenet: two $1.5B 2027s) | Reader assumes the card is stale | Seniority carried through from the filing's section header. |
| Maturity already retired by a newer issuance | Card points at dead debt | **v1.1:** `redeems` field + position layer removes the row. Row marked `retired`, never cards. |
| One trigger, ten tranches | Only one surfaces; recall capped at one per trigger | **v1.1:** `debtSchedule` transcription + checksum. Structural, not a prompt fix. |
| Debt-maturity latches onto maturities of just-issued bonds | Refi duplicates New debt | **v1.1:** dissolved. A new tranche is a ladder row like any other. |
| Tranche disappears from the newest 10-Q with no 8-K explaining it | Silently dropped, or wrongly assumed outstanding | **v1.1:** marked `unconfirmed`, rendered with that status, never cards. Checksum settles it: if the new schedule ties, the tranche is genuinely gone; if not, extraction dropped it. |
| Evidence sentence is a raw table fragment | Gate mis-reads | Gate reads evidence prose only, never verifiedQuote. |
| Quote spliced from two sentences | Fabricated contiguous span | Quote verification rejects. Quote defined as a required field, not a preference. |
| Evidence selection varies run to run at temperature 0 | Figure-keyed tests brittle | Golden tests key on company + trigger id, never on figures. Answer cache freezes the first answer. |
| `just_announced` with no date | Cards forever | Requires event date inside 90 days. Decays. |
| `proceedsUse` flips run to run | A card decided by a coin flip | Moved to Sonnet. Unstated defaults to table. |
| Credit agreement amendment has no proceeds | Three-way proceedsUse schema does not fit | Deferred; no carding event depends on it. |
| Extraction drops the section header (seniority) | Card unverifiable | Present in evidence for Tenet; narration instruction, no re-extraction. |

### 11.3 Figures

| Case | What goes wrong | Handling |
|---|---|---|
| "$ 17.9  million" with a double space (EDGAR artifact) | Scale lost, off by 1,000,000× | Whitespace tolerance widened; `hasDeterminableScale()` backstop; figure dropped if no scale. |
| "increased from $4.0B to $8.0B" | Pre-change figure bound as the fact | From/to detection requires both signals. |
| Adjacent unrelated figure (net income next to hedging) | Real number, wrong claim | Semantic binding on fx and commodity triggers; bind nothing rather than wrong. |
| Bare table cells ("3,938") | Meaningless number on screen | Typed money extraction drops them. |
| Model sums or rounds figures | "$2.0 billion" that appears in no filing | Number guard rejects. Instruction: exact figures only. |
| Figure without unit | Ambiguous | Dropped, "no figure disclosed" with source. |

### 11.4 Gate and cards

| Case | What goes wrong | Handling |
|---|---|---|
| Completed redemption with a still-future former due date | Cards as "~1mo out" | Status checked before date arithmetic. |
| Routine capex (six-month spend) | Shows as a project needing financing | **v1.1:** `cashAmount` present, `projectName` null → New debt table line, period spend. Line kept; deleting it implies zero capex. |
| 17-month-old completed sale | Reads as live in Treasury | **v1.1:** completed events >12 months sort to the bottom of their bucket and render their age. Never suppressed. |
| JV formation, business launch, held-for-sale classification | Fire as treasury events with no cash | **v1.1:** `cashAmount: null` → table, never card. No vocabulary list — a word filter would kill a real proceeds event that happens to mention a launch. |
| Two companies cite one event (merger) | Double card | Dedup is per company today. Cross-company dedup not built. |
| Zero cards across the whole book | Screen looks broken | Book-level empty state. |
| One company, two real events (UHS maturity + Talkspace) | Per-company cap suppresses one | Cap removed. One card per dedup cluster. |
| Card cites one filing, narrates from another | Unverifiable | Card citation set = union across every fact in its cluster. Every date and figure must appear in a cited filing. |

### 11.5 Narration and caching

| Case | What goes wrong | Handling |
|---|---|---|
| First narration attempt fails | Banner on first view | Failures never cached; next run retries. Warm-up run before determinism checks. Pre-warm must verify no card is banner'd. |
| Wrong answer cached | Permanently wrong | promptVersion bump. Split extraction vs wording versions so one does not invalidate the other. |
| Narration prompt changes | Full re-extraction, cold runs, noisy diff | Same split. |
| Guard failure detail stored in output | Different text per run, breaks determinism | Fixed string stored; detail to console only. |
| Dev annotations persisted in cached wording | Render-time strip leaves store dirty | Locate first; if in cache, bump wording version. |
| Internal vocabulary ("standing", "refi window") on screen | Jargon, or internal threshold stated as market convention | Plain English; "15 months out" not "inside the window." |

### 11.6 Demo and operations

| Case | What goes wrong | Handling |
|---|---|---|
| Cold name in front of Gabe | 60 to 90 second wait | Pre-warm ~40 large names. Same code, reading done early. Trace keeps the wait watchable. |
| API credits exhausted mid-demo | Run dies | Top up before. Loud failure, not silent. |
| Passphrase or env var missing | 500 or 401 | Fail closed. Blob token missing throws. |
| Rate limiter resets on cold start | Backstop weaker than it looks | Known; passphrase is the real gate. |
| Low-debt company (mature tech) | Refi and New debt empty | Empty state. Honest. |
| Spend grows with every new name anyone tries | Uncapped cost | 12-company cap per run; library cap worth adding. |

---

## 12. Known limitations, accepted

1. A wrong cached answer is permanently wrong until the version bumps.
2. Consistency is not quality. A bad card is a consistently bad card. The RM review stays. Determinism was solved in Session 14; correctness and completeness are a different axis, and conflating the two cost Sessions 10 through 13.
3. Recall is proven for debt only, and only arithmetically. Events have a coverage count, not a proof.
4. Name resolution is unsolved.
5. Public filings cannot feed every trigger. Shown, not hidden.
6. Maturity-wall context (Item 3 market-risk table) is not read. It also holds most of the hedging gaps: existing swap notional, floating share of total debt, foreign revenue share, the company's own sensitivity math. One section of a document already fetched. Next extraction bump after v1.1.
7. Treasury remains thin. Working capital is never read, cash is one number over two quarters with no trend, and the payments side (payroll expansion, new geographies, entity formation) is not looked at. v1.1 makes treasury honest, not deep.

---

## 13. Open work

### 13.0 Session history (v3 onward)

| Session | What shipped |
|---|---|
| 14 (`90cb317`) | Answer cache + wording cache on Vercel Blob, 24h TTL on the filing list, only-new-filings-get-read, promptVersion in every key. Determinism verified byte-identical on Vercel, two books ×3. |
| 15 (`cc8e39e`) | New card shape, `sonnetPortfolioSummary` deleted with its constraint machinery, deterministic bullet table, empty states, UHS proceeds bug fixed. |
| 15b (`d55b653`) | Table lines built from each trigger's own evidence under its own bucket, sources on every line, `CALL ABOUT` names an amount or date. |
| 16 (`5bbb9d0`) | Per-line punch list. Baseline-diff protocol introduced: capture live output before any change, account for every changed line after. |
| 17 | Rescoped to 10 renderer, language, and card-format items. promptVersion split ships first. |
| 18 | Refi rebuild (schedule rows, position layer, checksum) plus the stated-amount test for bucketing. All 10 names re-extracted. |
| 19 (`ab5ac0f`) | Molina's blended rows, Centene's mistyped subtotal, Tenet's dropped sign; the extraction marker made provenance-worded; Rules 14-16. |
| 20 (`7db4190`) | **The ladder became the anchor's own position.** The anchor is the most recent 10-Q/10-K with no fallback; the anchor rule extended to every position-bearing field; the locator delivers the whole note rather than the table inside it; a note that states its instruments in bullets and sentences is read; debt is the drawn balance and capacity is reported separately; the coverage check (Check 3) with a measured 2.5% threshold, rendered and queued. UHS: 0% to 98%, hand-verified. Rules 17-21. |
| 21 (`de1c041`) | **Two tiers, and a golden file that can be signed.** A position is pinned as Tier 1 (the anchor's own position) or Tier 2 (events since the anchor) and never blended; derived lines state the arithmetic they performed; the golden file's six criteria hardened to nine, three of them attested by hand rather than computed. Reproducibility measured on independent re-asks: the position reproduces, the presentation does not. Three names pinned (UHS, Quest, Molina). Rules 22-33. |
| 22 (`bda24f5`) | **The semantics layer.** Facility type separated from lien ranking and neither inferred; priority class made one field read from three sources in the filer's own words; facilities located in their own span and carrying their own stated maturities; liquidity computed rather than juxtaposed; letters of credit removed from the ladder and deducted from available-to-draw; provenance per figure — every displayed number beside the sentence that states IT, on the product surface and the signature surface alike. **Six of ten golden at v29**, all nine criteria, each reproduced CACHE_BUST ×3. Rules 34-49. |

| Item | Status |
|---|---|
| **`new-debt-issuance` collapses multiple issuances in one period to one** | **STILL OPEN.** Deferred at Session 19 and carried unchanged through Session 22; tracked in §13.4. A company that prices twice in a period returns one verdict: one filer issued $500M on 29 May and a $100M add-on of the same notes on 13 August, and only one survives. The trigger already returns an array, `issuedTranches`, but at the TRANCHE level, which is what the position layer consumes as ladder rows. Supporting several issuances each with several tranches is a nesting change, not an array change — it needs a tranche-to-issuance association nothing currently carries. Reasoning recorded at `MULTI_INSTANCE_TRIGGERS` in `lib/agent/triggers.ts`. Known live data loss, not a hypothetical. |
| Split promptVersion into extraction + wording | **RESOLVED, Session 17.** `EXTRACTION_PROMPT_VERSION` and `NARRATION_PROMPT_VERSION` are separate constants in `lib/cache/promptVersion.ts`, now at v29 and v10. |
| Session 17 (rescoped): 10 renderer and language items | **RESOLVED, Session 17.** Shipped; see the 17 row above. |
| Session 18: refi rebuild + bucketing fix, 7 items resolved as consequences | **RESOLVED, Session 18.** Shipped; see the 18 row above. |
| Verification strip on cards | **SUPERSEDED.** Never built as a separate strip. What it was for now renders in place: Checks 1-3 and the note's own reconciliation walk (Sessions 18-20), and per-figure provenance on every figure (Session 22, §8.13). Not carried as an open item. |
| Pre-warm script, ~40 names, verify no banners | **STILL OPEN, resequenced.** No longer "Session 19, before demo" — it now runs after the audit session. Sequence in §13.5. |
| Item 3 market risk: maturity wall, hedging depth | **STILL OPEN.** Next extraction bump after the Session 23 cold pass; "after v1.1" is stale — the schema is at v29. |
| Treasury depth: working capital, cash trend, payments side | Deferred. Fixing refi is the demoable path; widening into treasury is the bigger product. |
| Gabe outreach | Not until the tool is good |

### 13.1 Moved from Session 17 to Session 18

Seven items are dissolved by the rebuild rather than patched, so patching them first would be thrown away: A1 over-suppression (item 2), the four wrong-bucket triggers (6 through 9), routine capex (10), and the tranche-count phrasing (15, whose "+N more tranches" suffix the position layer deletes).

Item 18 (seniority on the card) is dropped as a Session 17 item and arrives free in Session 18, since `seniority` becomes a row field rather than something narration has to be asked for.

### 13.2 Standing costs, from a persisted per-company log (v1.5)

Session 19 measured a cold pass at ~$1.72 from a printed trace. Session 20
lost that trace on a backgrounded run and could not reconcile its own
pre-registered cost, which produced **Rule 20 — a backgrounded run persists
its per-company cost, or Rule 13 cannot be checked after the fact.** The
figures below are read from `baselines/cost-log.jsonl`, written per company
as each scope closes, and are the first that can be re-derived rather than
remembered.

**A ten-name cold pass at v25 cost $1.53 for the metered portion.**

| component | model | calls | measured | share |
|---|---|---|---|---|
| Base classification | Haiku 4.5 | 10 (one per company) | **$1.116** | 73% |
| proceedsUse | Sonnet | 6 | **$0.416** | 27% |
| **Metered, ten names** | | **16** | **$1.532** | |
| Card narration | Sonnet | 3 (one per card) | ~$0.15 *(not metered — see below)* | |
| **Cold pass, ten names** | | **~19** | **~$1.68** | |

Measured tokens: Haiku **700,260 in / 83,155 out** across ten base calls;
Sonnet **137,494 in / 254 out** across six proceedsUse calls. Published rates
**Haiku 4.5 $1 / $5 per MTok**, **Sonnet $3 / $15 per MTok**. Per company for
the metered portion: **$0.153**, up from Session 19's $0.105 — the note spans
widened when the locator began delivering the whole note rather than the
table inside it (measured: eight of ten notes had been carrying about a third
of themselves), and output grew with the prose instruments now transcribed.

**Two honest gaps in this table.**

1. **Narration is still not in the log.** `persistCompanySpend` writes when a
   company's cost scope closes, and narration runs at book level in
   `captureBookSnapshot`, after that scope. So the persisted total
   *understates the pass* by the narration component. Carried to Session 21.
2. **proceedsUse re-bills on extraction drift.** Its key covers the bounded
   input hash, so a re-extraction that moves the issuance's verified quote
   moves the key. Six of eight re-billed at v25. This is correct behaviour —
   the input genuinely changed — but it means a version bump costs base
   *plus* most of proceedsUse, not base alone.

The pass is only this cheap while the corpus fingerprint holds: the
filing-list TTL is 24 hours, and a single new 8-K anywhere in a company's
history invalidates its cached answer. A pre-warm should budget **$0.153 per
name** for the metered portion plus its own narration, and state its expected
miss count up front (Rule 13).

### 13.2a Standing costs, Session 21 measured (v1.6)

Read from `baselines/cost-log.jsonl`, written per company by `runAgentLoop`
as each scope closes (Rule 20).

| what | measured |
|---|---|
| A warm full-book run, all ten | **$0.0000**, 0 API calls — every answer, filing text and proceeds-use classification cached |
| One billed re-ask of one company at v28 (CACHE_BUST) | **$0.10 – $0.17** |
| Criterion 9b for one company (three re-asks) | **$0.31 – $0.51** |
| The Session 21 reproducibility programme (nine re-asks, three companies) | **$1.2889** |
| One Sonnet card narration | **$0.020 – $0.030** |
| Narrating the current four-card set from cold | **$0.08 – $0.12** |

**A failed briefing is deliberately not cached**, so every re-attempt of a
failing card re-bills — which is why a narration defect costs more to
diagnose than to fix.

**Rule 33 (v1.6):** a cost delta measures the wrong thing when the meter
resets per company. `currentCompanySpend()` after a run IS that run's cost;
subtracting a "before" reading reports every run after the first as free. The
persisted per-company log is the authority, and it is what these figures come
from.

### 13.2b Session 21 carry-list (v1.5)

Everything below was found, diagnosed and deliberately **not** fixed in
Session 20. Ordered by what a wrong answer costs a reader.

1. **Tier 2 — the post-anchor events layer.** Designed, not built. One
   ladder, two rendered tiers, never blended. **Tier 1** is the anchor with
   its coverage percentage, and is the only tier that carries one. **Tier 2**
   lists each post-anchor 8-K as its own line with date, effect and source;
   it **nets rather than stacks** (an issuance adds its stated amount; a
   redemption subtracts against the exact named tranche); it keeps an
   intended-but-unconfirmed repayment on the ladder marked **pending** until
   an 8-K confirms it; it carries a rolled total labelled *"adjusted for
   events since [anchor date], unverified against a balance sheet until the
   next 10-Q"*; it **never** carries a coverage percentage; and it uses
   nothing from a 424B "as adjusted" column as position. UHS's $700M 1.65%
   notes maturing September 1 2026, with a prospectus-stated takeout, are the
   worked example of the pending state.
2. **Molina's denominator is prompt-sensitive.** Its "Finance lease
   liabilities $184 million" balance-sheet caption appeared at v24 and is
   absent at v23 and v25, moving stated total debt between $3.769B and
   $3.953B and flipping Check 2. **Measured, not assumed:** three forced
   re-asks at v25 on the same filings (CACHE_BUST) returned the identical
   single-caption set, so this is *not* run-to-run variance — it is the model
   changing its reading of which balance-sheet lines are debt when the prompt
   changes. The fix is to define the caption set structurally rather than
   leave it to the model's judgment. Finance leases are either in stated
   total debt or they are not, and the spec does not currently say which.
3. **UHS renders no card.** Its $700M 1.65% notes mature September 1 2026 —
   the most urgent item in the book — and produce no card, because card
   candidates are built from the position's *rows* and UHS's ladder is
   entirely prose. It also failed to card at v22 when it did have eleven
   rows, which is a second cause that has not been diagnosed.
4. **Check 1 and Check 2 have no meaning for a prose-only filer.** Both read
   false for UHS and Cigna, correctly — there is no table to walk and no
   subtotal to match — but "false" reads as failure. Coverage compensates on
   the rendered line; the checks themselves should state not-applicable.
5. **DaVita's $65M revolving-line row sits outside its note's own subtotal**,
   moving its residual from 0.0% to 0.6%. Stable across v24 and v25. Passing,
   and unexplained.
6. **Cigna renders empty-with-reason.** Its 10-Q debt note is four narrative
   paragraphs ending "see Note 7 to the Consolidated Financial Statements in
   the Company's 2025 Form 10-K", so it has no ladder at the anchor and
   coverage reads 3% against $31.878B. This is the correct answer and a poor
   demo; the answer is Tier 2 plus a stated cross-reference, not a fallback.
7. **Narration cost is outside the per-company scope** (see 13.2, gap 1).
8. **424B parsing.** Deliberately untouched: the "As adjusted" column is a
   pro-forma projection, not a position, and must never render as one.
9. **XBRL as the totals anchor and the buckets floor**, and the XBRL
   per-tranche measurement.
10. **Pre-warm (~40 names) and golden files.** UHS at v25 is the first golden
    file candidate: hand-verified against the filing, eight instruments,
    98% coverage, 2.28% residual.

### 13.2c Session 22 carry-list, in full (v1.6)

Everything below was found, diagnosed and deliberately **not** fixed in
Session 21. Ordered by what a wrong answer costs a reader.

**Semantics**

1. **Priority class and instrument type on every row** — mapped from the
   filer's own section headings and stated seniority language, verified,
   rendered, and ordering the ladder. Today a row carries an unnormalized
   `seniority` string (four spellings across two filers), incomplete (2 of 12
   Tenet rows and 2 of 9 DaVita rows carry none, which renders as an absence
   of seniority rather than an absence of disclosure), no instrument type at
   all, and no structure — the ladder is one flat maturity-ordered list where
   the note prints separate sections. **Tenet and DaVita become golden when
   this renders.** Molina is the type case: its revolver renders as a generic
   "Credit Facility, capacity", amount correct, type nowhere stated, and the
   note's own seniority sentence sits unused inside the located span.

2. **`amountBasis` is dropped when a prose instrument becomes a row.** It is
   read by `debtContribution` to decide debt-versus-capacity and then
   discarded, so the row a golden file pins — and the row the ladder renders
   — states no basis, though the extracted instrument does. Criterion 2 asks
   for the basis on the amount.

**Reading**

3. **Filer-directed roll-forward. Cigna only.** Fires only when the anchor's
   debt note has no ladder AND explicitly cross-references a prior filing for
   detail (verbatim, verified). Never on mere absence, and — added by Session
   22's Stage 0 measurement — never on mere boilerplate. The base is the most
   recent prior filing in the reference chain carrying tranche detail; deltas
   bridge every intervening period in order, each verified by instrument
   identity, none skipped; the result must tie to the anchor's balance sheet
   or render as prior-period-only with the gap flagged. Every row labelled
   "as of [base period], per [base filing], rolled forward through [periods]".
   **Cigna is the worked example** and its $31,352 − 550 + 1,000 ≈ 31,768 tie
   is the acceptance test.

   **CORRECTED (Session 22, Stage 0): HCA is not on this list.** As written
   in v1.6 this item said "HCA joins this list". Measured against the
   filings, it does not: the trigger is a conjunction, and HCA satisfies
   neither half cleanly. Its 10-Q prints an aggregate ladder that ties, and
   its six prior-filing pointers are all boilerplate covering every note —
   *"For further information, refer to the consolidated financial statements
   and footnotes thereto included in our annual report on Form 10-K"* — not a
   debt-specific cross-reference. Firing on that would have been widening a
   rule to make an expectation come true.

   **The conjunction's four cases all exist in this book, and they are the
   Stage 6 fixture set:**

   | company | ladder in note | debt-specific cross-reference | fires |
   |---|---|---|---|
   | Cigna | no | yes — *"For more information regarding our short-term and long-term debt, see Note 7 … in the Company's 2025 Form 10-K"* | **yes** |
   | HCA | yes (aggregate) | no — 0 debt-specific, 6 boilerplate | no |
   | UHS | no (prose only) | no — 0 debt-specific, 9 boilerplate | no |
   | Quest | yes (12 tranches) | yes — 3 | no |

   Quest is the negative test that earns the conjunction: a debt-specific
   cross-reference alone is not sufficient. UHS is the safety case — it has
   no ladder, so had it carried such a sentence the roll-forward would have
   fired on a company already golden at 98%.

3a. **HCA's disposition: aggregate-disclosure, not roll-forward.** HCA's
   10-Q carries a four-row aggregate ladder that ties to its balance sheet
   and its stated total. It is written as an **aggregate golden**, labelled
   *"aggregate, per-tranche detail not in the 10-Q, ties to balance sheet and
   stated total"* — a legitimate pinned position that cannot answer *which
   tranche, at what rate*, and is therefore off the demo script. Criterion 8a
   fails for it by design; the label is what makes that honest rather than
   hidden.

4. **The XBRL debt text-block as a location anchor**, to make Cigna's note
   findable reliably. Session 22 opens with a **$0 pre-check**: how many of
   the ten have a non-empty debt text-block tag.

5. **The UHS amount-join.** A repayment may be confirmed by one source and
   sized by another, each verified independently, joined only on matching
   instrument identity, never stitched across unverified text. Also the
   **nominalization widening** — corroboration requires a finite past-tense
   verb, and "the repayment of X" as a completed nominal fact is not
   recognised; measure first, because widening also admits the sentence
   Tenet's demotion depends on.

6. **Revolver amount fields are verified as a sentence, not against it.**
   The revolver's `sourceLine` is checked for presence; `available`, `drawn`
   and `facilitySize` are not checked against it. Encompass states $824
   million of availability in a sentence that does not contain it, and its
   own revolver arithmetic independently does not reconcile
   (200 + 46.3 + 824 = 1,070M against a stated $1B facility). **Encompass and
   CHS become golden when this is fixed.**

**Render**

7. **`proceedsUse` is classified for every company and rendered nowhere.** A
   Sonnet call per company returns refinancing_only / partly_unapplied /
   unstated, consumed only by card eligibility. The refi surface never
   distinguishes a refinancing from net new debt — for an RM the difference
   between a call worth making and one that is not.

8. **A drawn revolver shows no capacity line; an undrawn one does.** Tenet,
   CHS and Molina render capacity because nothing is drawn; DaVita ($65M
   drawn) and Encompass ($200.0M drawn) render none, and their stated
   available capacity appears nowhere. Inverted from what matters.

9. **DaVita's "stated but not captured: revolver" flag is false.**
   `categoriesMissing` builds "stated" from `debtMaturity.revolver` and
   "captured" from prose-instrument categories, so a revolver captured as a
   TABLE ROW carries category `table-row` and the test cannot see it.
   Misfires on exactly the two drawn-and-tabulated filers in the book.

**Structural**

10. **The as-of date becomes a required argument with no default**, on
    `buildEvents`, `assemblePosition` and everything downstream, so pinning
    stops depending on any caller remembering it. Session 21 found the
    two-clocks defect at a fourth call site and fixed it at the page level;
    its server-side twin in `app/api/run/route.ts` is still there.
    `buildDerivedLines` is already written this way and is the model.

11. **Out of scope, restated:** the ~40-name pre-warm, XBRL per-tranche as a
    primary source, book-level ranking, Item 3 market risk, D2 month
    recovery, taxonomy edits.

### 13.2d Session 22 carry-list, part two — the card review (added post-close)

The four cards were read as an RM reads them, against their filings. **Every
fact on every card is correct and sourced; there is no wrong number.** The
*stories* are weak on three of the four, and every story failure traces to
one root: **the tool knows what each number is and not what it is for.**

The nine items below are rules over the class. The named company is the
worked example only.

**Order of work: 9 (render, $0) → 1–4 (semantics and facility layer) →
goldens → 5, 6, 8 (analysis layer). 7 rides with the other one-slot fixes.**

#### Group A — the semantics and facility layer (items 1–4, first)

1. **Facilities are located by their own content, not by having a balance
   row.** A credit facility lives in its own span — the MD&A liquidity /
   capital-resources section, the debt note's prose, a dedicated facilities
   or letters-of-credit note — and an **undrawn** facility has no balance
   row, so it never appears in the debt table at all. The tool today reads
   facilities only where they are drawn and tabulated. Quest states a $750M
   senior unsecured revolver and a $600M secured receivables facility, both
   undrawn, $1.3B available, and its card says *"the anchor filing states no
   revolving facility."*
   **Rule:** every facility class — revolver, delayed-draw, receivables,
   term loan — is located across all three span types, with **facility size,
   drawn, letters of credit, available, maturity and as-of date each
   extracted verbatim and verified against the sentence that states it**, and
   the arithmetic check applied: `drawn + LCs + available = size`.
   **This supersedes the carried span-location intent and absorbs §13.2c
   item 6** (revolver amount fields verified as a sentence rather than
   against it) — the verification half of that item is this item's
   per-field verification. **It also absorbs §13.2c item 8**: a drawn
   revolver showing no capacity line is the same defect from the other
   direction. **Non-optional.** Without it the liquidity line is wrong on
   every company whose revolver is undrawn, which is most of a healthy book.

2. **A term loan or revolver carries a maturity and cards when it is inside
   the window, exactly as a bond does.** Centene's Term Loan Facility
   ($1,975M, floating) sits on the ladder with no maturity; the note's prose
   or the credit agreement states one.
   **Rule:** every facility row carries its stated maturity date, verbatim
   and verified; a facility with no stated maturity anywhere in the corpus
   **says so** rather than rendering blank. Card eligibility already builds
   from any instrument (Session 21, Stage 1) — **confirm by fixture** that a
   term loan or revolver maturing inside the window produces a Refi card
   with the same structure as a bond card, and that a facility with no
   maturity never cards. Assert both directions.
   **Term loan and revolver maturities are the strongest refi conversations
   a relationship bank has, so their absence from the card set is the most
   valuable gap this review found.**

3. **Liquidity is computed, not juxtaposed.** Liquidity = **cash and cash
   equivalents + undrawn facility capacity**, both as-of dated, stated as
   one sum. A drawn balance *reduces* it and is not a debt signal. This
   replaces Session 21's "capacity beside the maturity" line book-wide
   (Rule 29 stands — no ratio against the maturity; what changes is that the
   two liquidity components become one figure rather than two juxtaposed
   ones).
   **Corollary, from Encompass:** a withheld figure must never erase a
   verified instrument from the card. Withhold the unverified number; keep
   the instrument.

4. **Revolver semantics — the first rules of the instrument-semantics
   layer.** A **drawn balance is operational and is never a refi signal.** A
   revolver is a Refi conversation only when (a) its own maturity falls
   inside the window, or (b) a stated acquisition or growth event implies
   the company has outgrown the facility. **No card may cite a drawn balance
   as its reason.**

#### Group B — the one-slot class (item 7, rides with the other one-slot fixes)

7. **Use of proceeds is multi-part.** Encompass's May 2026 proceeds
   redeemed $400M of bonds, repaid $100M of revolver, and paid fees; the
   tool captured one of the three. **Rule:** use-of-proceeds is an **array**
   of verified uses, each carrying its own `sourceLine` — the same one-slot
   fix as every other multi-instance field in this build.

#### Group C — the analysis layer (items 5, 6, 8; after the goldens)

5. **Cash is never a refi rationale on its own.** Centene's why-now is
   *"cash grew to $24.15 billion"* — a readout, not a reason, and for an
   insurer that balance is regulatory float, not treasury liquidity.
   **Rule:** the why-now must cite **an event or a pattern on the tranche or
   its issuer** — an issuance, a retirement, a repurchase program, a stated
   intention. Never a balance. Where the corpus holds no such event, the
   why-now **states the maturity and stops.**

6. **Read the kind of retirement, not only its date.** Quest issued in May
   and repaid the June notes *at maturity*; the card reads *"refinanced 1
   month ahead"*, which presents an at-maturity repayment as early
   refinancing. The filing's own words are *"repay in full at maturity."*
   **Rule:** where the retirement sentence carries at-maturity language —
   *at maturity*, *upon maturity*, *when due* — the pattern line reads
   **"pre-funded and repaid at maturity"**, never "refinanced N months
   ahead". A closed grammatical class, the same shape as the tense gate.
   **Early takeout (Encompass, ~21 months ahead) and at-maturity repayment
   (Quest) are opposite behaviours and must read as opposite.** This is
   Rule 28's third worked example.

8. **Connect facts already held to the card.** Centene's note states
   **$1,147M of the 2027 notes repurchased in six months** — captured by
   `noteRetirements` in Session 19 — and the card's why-now ignores it in
   favour of cash. **Rule:** where a verified retirement, repurchase or
   issuance exists **on the card's own tranche**, it *is* the why-now.

#### Group D — render hygiene, book-wide (item 9, do first: $0)

9. Four render defects, all $0 to fix and all visible on every card:
   - **The eligibility reason leaks into the rendered card.** *"matures
     during 2027 — the whole year falls inside the 18-month window"* is why
     the card exists, not something an RM reads. Delete from render; keep it
     in the diagnostics.
   - **One house number format at render** — `$1.5B` / `$396.9M`, one
     decimal, abbreviated. Verification keeps the **as-printed** figure;
     this is a render-layer format only, and the two must not be confused
     (Rule 32's shape: one string for arithmetic, one for display).
   - **Pluralise month counts.** *"1 months ahead"* renders today.
   - **Month arithmetic checked against a stated convention.**
     `monthsBetween` divides elapsed days by an average month length (30.44)
     and rounds — the same approximation that produced the sign error in
     Rule 28's second worked example. Encompass's 2026-05-29 issuance
     against a 2028-02-01 maturity is **20 months and 3 days** by
     anniversary counting and **21 months** by month-boundary counting; the
     code prints 20. Neither reading is wrong, but the convention is nowhere
     stated and the arithmetic is an approximation rather than calendar
     arithmetic. **Rule:** month counts are computed by calendar months
     against a named convention, stated once in the BRD, never by dividing
     elapsed days by an average month length.

#### Parked — v2 / post-demo, explicitly not Session 22

- **Deriving a month from a stated range floor** when a single note uniquely
  occupies it (Tenet, November 2027).
- **"Already refinanced" verbiage** on a tranche partly taken out
  (Encompass).
- **Voluntary roll-forward** — reaching into an itemized 10-K when the 10-Q
  is aggregate but does not point there. A NEW TRIGGER with new risk, not a
  widening of the filer-directed one, and HCA (its only candidate) is not a
  demo name. It waits.

Both are low value against a new failure surface, and neither goes in before
the 40-name run.

### 13.3 The demo path

Three names, in this order, with the arc **position → conversation →
method**. The script exists to decide something the carry-list cannot: which
names must be *perfect* and which need only be *honest*. Everything on the
book stays honest; only these three must be perfect.

**1. Tenet — the position.**

> "This is Tenet's entire ladder as its own 10-Q prints it. Twelve tranches,
> tied to Tenet's balance sheet and to its own XBRL total. The $1.5 billion
> 5.125% first lien matures in 2027 — and yesterday Tenet priced $2.0 billion
> of new notes saying it intends to take that exact tranche out. The tool has
> that 8-K, and it has not retired the row: an intention is not a completion.
> The tranche stays on the ladder, and the intention is stated beside it."

Answers "does it actually read the filing," and shows the Tier 1 / Tier 2
split doing its job.

**The pending takeout, added Session 22.** Tenet filed the pricing 8-K on
2026-09-08, mid-build. It moved Tenet's corpus fingerprint, went cold on the
answer cache and re-extracted — and the pipeline held both redemption claims
as `intended, verified` rather than retiring the rows, exactly as Rule 14 and
the tense gate require. A filing caught the same week, on the flagship slide,
demonstrating the one distinction the whole build rests on. The book is
re-pinned forward to include it rather than demoed against a corpus that
predates its own best example.

**2. Encompass — the conversation**, with the withheld line shown as a
deliberate refusal, not skipped.

> "Encompass took $400 million of these 2028 notes out in May with new 2034
> money. $396.9 million is still outstanding. That's the call — and the tool
> knows it because Encompass's own note says so, not because it inferred it."

Then, on the same card:

> "Availability is $746 million, out of a $1 billion facility, with $200
> million drawn. Three figures, three sentences — and they're in three
> different filings: the size in the March 8-K, the rest in the 10-Q. It
> won't print the letters of credit, because no sentence in either states
> them."

**Updated after Stage 3, and the beat got stronger.** The line was written
as "it won't print the $824 million of revolver availability, because the
sentence Encompass cites for that number doesn't contain it" — a refusal,
and a good one. Reading each figure against its own sentence did something
better than refuse: **$824 million was not merely unsourced, it was wrong.
The filing says $746 million.** The composite the old code assembled — a
real number and a real quote, joined by nothing — was a real number from
somewhere else.

So the demo no longer shows only that the tool declines to guess. It shows
that per-figure verification *found the true number*, and then still
withheld the one figure it could not source. Refusal and correctness in the
same card, on the same instrument. That is a materially stronger claim than
"it is careful", and it is the flagship trust slide.

The refusal is still shown, not apologised for — it has just stopped being
the only thing in the beat.

**3. UHS — the method.**

> "UHS's debt note prints no table at all. Five notes, a term loan and a
> revolver, all in prose. We read them out as instruments: $4.741 billion,
> against the $4.852 billion UHS reports on its own balance sheet. The
> $111 million we can't place, we tell you we can't place. That's the check —
> and it's why the other 97.7% is worth something."

**Why the close is worded that way.** An earlier draft said "ties to the
XBRL tag within 2.28%", which invites "what's the $110 million?" — a
question with no good answer on the spot. The proposed pre-empt, that the
gap closes once the filing's own stated discount is subtracted, does not
hold and is directionally backwards: UHS's 10-Q states **no** unamortized
discount or deferred-financing balance (the only mention of "original issue
discount" is inside an *average effective interest rate* sentence, not a
balance), `reconcilingLines` is empty and `statedBridge` is 0. And a
discount subtracts from face, so applying one would move captured face to
~$4.630B and *widen* the residual from 2.28% to ~4.6%. The $111 million is
debt UHS carries on its balance sheet that the position does not capture as
an instrument — the residual is unexplained, and naming it as unexplained is
both true and the stronger close. If Session 22 captures it, the sentence
upgrades to a tie; until then it stays as written.

#### What the script decides — must-land, per name

| name | must land before the demo | source |
|---|---|---|
| **Tenet** | priority class and instrument type, normalized and structural — its note prints separate sections and the ladder renders flat, and 2 of 12 rows carry no class, which reads as "unsecured" rather than "not disclosed" | 13.2c item 1 |
| **Tenet** | render hygiene — its card leaks the eligibility reason (*"the whole year falls inside the 18-month window"*) | 13.2d item 9 |
| **Encompass** | facility fields verified against their own sentence — `available`, `drawn`, `facilitySize`, with the arithmetic check | 13.2d item 1 (absorbing 13.2c items 6 and 8) |
| **Encompass** | use of proceeds as an array — its May proceeds did three things and one was captured | 13.2d item 7 |
| **Encompass** | the withheld liquidity line renders as a stated refusal, not as an absence — and the figure it replaces, `available`, resolves to the filing's own $746M rather than the wrong $824M | 13.2d item 3 corollary |
| **Centene** *(benched, but the card must carry it)* | each figure names its own document. Its revolver's LCs come from the anchor 10-Q and its maturity from the **10-K** — a quarter of staleness a facility-level citation would have hidden | Stage 3 |
| **UHS** | render hygiene only. Already golden, all nine criteria hold, 3/3 reproduction — the lowest-risk name on the script, which is why it closes | 13.2d item 9 |

**Benched, deliberately: Quest and Centene.** Quest is golden and ties to the
dollar, and its card still carries two of the nine defects — it says *"the
anchor filing states no revolving facility"* when Quest has a $750M revolver
and a $600M receivables facility, both undrawn, and it presents an
at-maturity repayment as refinancing a month early. Those land hardest on
the name with the strongest verification story behind it. Quest returns to
the script the moment 13.2d items 1 and 6 land, and is then likely the
strongest name in the book. Centene is held on reproduction, not on its
card.

**One clock.** The demo book is pinned at `PINNED_AS_OF`
(`lib/cache/pinnedAsOf.ts`), 2026-09-09, and every live harness reads that
constant instead of declaring its own — three different as-of dates
(2026-09-04, -06 and -07) were live in the tree at the end of Session 21,
which is how one tranche could read "17 months out" in one artifact and "15"
in the next with neither being wrong. The product itself was already
single-clock: it pins once at run start. Session 21 artifacts that RECORD a
past measurement keep their own dates, because an attestation whose date
moves is not an attestation, and golden files keep theirs because a golden is
pinned to the clock it was signed at.

**Off for structural reasons:** Cigna, whose note has no ladder and points
at its 10-K (13.2c items 3 and 4); and HCA, whose ladder is aggregate and
which therefore cannot answer which-tranche however well it ties (13.2c
item 3a).

#### Session 22 sequencing, which follows from the script

1. The three demo names' items first — Tenet (class + render hygiene),
   Encompass (facility verification + proceeds array + withheld-as-refusal),
   UHS (render hygiene).
2. **STOP**, asserting all three are perfect against their filings.
3. Then the remaining items across the seven honest names, in the 13.2d
   order (9 → 1–4 → goldens → 5, 6, 8).

### 13.4 Open work

- ~~**The proceedsUse cache key omits part of its own input.**~~ **CLOSED in
  Session 20 (item 3f).** The key is now
  `answer/{cik}/proceedsUse/{fingerprint}/pu-v{N}-{inputHash}.json`, where
  the hash covers the bounded input the call actually receives. Values were
  baselined before the key moved and re-billed after it: **zero flips.** The
  original text is kept below for the record.

- **The proceedsUse cache key omits part of its own input.** The key is
  `(cik, corpusFingerprint, pu-v)`, and the code's own comment justifies
  that by saying the call is "fully determined by the cached base-pass
  result for a fixed corpus fingerprint". Since item 2d that is no longer
  true: the bounded input is selected by an anchor built from the
  issuance's verified quote and evidence, which are base-pass output, and
  the base pass is keyed on `EXTRACTION_PROMPT_VERSION` as well as the
  fingerprint. So an extraction bump changes proceedsUse's input while its
  key stands still, and the cached answer is served anyway. Nothing in the
  book is wrong today — those are real answers from real inputs — but they
  are not reproducible from the current run's input, and a future cold pass
  could differ with no version change between them. Same family as the
  `pu-v` collision one level up: not two constants sharing a path, but a
  key that omits part of what it identifies. **Fix at its next legitimate
  re-bill** (fold the bounded input's hash into the key), never as a
  standalone change, since correcting it forces a full proceedsUse pass.

- **Multi-instance `new-debt-issuance`.** Carried from Session 19's trigger
  decision: a company that priced several tranches in a period collapses to
  one issuance verdict. Deliberately excluded from the array conversion
  because it would change the nesting `issuedTranches` already provides.
  Reasoning at `MULTI_INSTANCE_TRIGGERS`.

### 13.5 The sequence from here, and what the audit session carries

**The sequence, canonical.** Every other statement of the plan in this
document defers to this one.

1. **Session 23 — finish the ten.** Full-note transcription (the blocker: the
   model transcribes 3 rows of a $31.878B note), Cigna's roll-forward built on
   top of it, the facility/prose extraction bump riding the same cold pass,
   and the Quest / Centene / HCA unblocks.
2. **A full-book product read.** Claude Code generates all ten companies
   exactly as they render, for an RM read against the demo script's three
   questions per company. Reading the product, not the log.
3. **A fix pass** on what that read surfaces.
4. **The audit session** — rule and architecture scalability, tested for
   company-specific residue.
5. **The ~40-name pre-warm.**
6. **A fix pass** on what the pre-warm surfaces.

The audit session is step 4, not the step after this one: two product-facing
passes come first, because a rule audited against ten names nobody has read as
a product audits the wrong thing.

Carried into the audit session:

1. **A shared measured-vs-unreachable helper.** Four times now a surface has
   rendered "could not reach the source" in the same shape as "the source
   says no": Session 21's check sheet (one failed `getFilingText` reported
   six HCA facts as unplaceable), the `categoriesMissing` flag that misfires
   on drawn-and-tabulated revolvers, `factsReferencedIn`'s any-token
   attribution, and Session 22's Stage 0 probe, whose totals divided by ten
   while one company had never been fetched. Each was found and fixed in
   place; the class is not fixed, and every new probe re-introduces it. The
   helper makes the distinction structural — a result is `measured` or
   `unreachable`, a count's denominator is what was measured, and an
   unreachable input can never be rendered as a negative finding.

---

## 14. Acceptance, standing

1. Same book ×3, byte-identical, local and live, after one warm-up run.
2. Baseline diff: every changed line accounted for.
3. Zero bare lines, zero lines without a source, CALL ABOUT names a figure or date, no unnormalized figures, no wrong-bucket triggers, no blank statuses, no dev markers.
4. Live golden assertion count reported separately from synthetic.
5. Akshay signs off on every card and table entry as a banker would.


## 15. Session 22 close — what is signed, what carries (v1.7)

### Golden at v29, signed 2026-09-09

| name | rows | residual | filings | reproducibility |
|---|---|---|---|---|
| DaVita | 9 | 0% | 3 | CACHE_BUST x3, position identical |
| Community Health Systems | 12 | 0% | 3 | CACHE_BUST x3, position identical |
| Universal Health Services | 8 | 2.28% | 4 | CACHE_BUST x3, position identical |
| Encompass Health | 7 | 0% | 4 | CACHE_BUST x3, position identical |
| Tenet Healthcare | 12 | 0% | 6 | CACHE_BUST x3, position identical (after Rule 48) |
| Molina Healthcare | 6 | 0% | 3 | CACHE_BUST x3, position identical (after Rule 49) |

All nine criteria hold on each. **Six of ten are golden.** Quest's v28 golden
was REMOVED rather than carried: it pins a schema v29 does not produce and the
name is not signable (Rule 36); it remains recoverable at commit `de1c041`.

Tenet and Molina were refused on first pass and closed inside the session, both
code-only and both as book-wide rules — see Rules 48 and 49. DaVita's ladder is
9 rows rather than 10 because Rule 48 removed its letter-of-credit facility
from the ladder, which is the one row that rule changes book-wide.

### Not signed, and why

- **Quest** — one row cites a filing other than the anchor (3.50% Senior
  Notes due March 2025, a matured note). Criterion 3.
- **Centene** — criterion 2: a facility size was stated, claimed, and did not
  survive verification (`$4,000 million`, in no fetched filing).
- **HCA** — criterion 8a: the note prints one aggregate line, not a tranche
  ladder. Its agreed disposition is a labelled aggregate golden, which 8a as
  written cannot pass; the criterion needs amending or HCA stays unsigned.
- **Cigna** — no ladder at the anchor. Rendering the empty anchor with the
  reason stated is never-suppress working, not a hidden gap.

### Carries to Session 23

**The blocker first: full-note transcription.** The model transcribes 3 rows
of a $31.878B note. Cigna's roll-forward is built on top of that once it
lands, and the facility/prose extraction bump (B3 stated zeros, B4 capacity
figures, B5 corpus-wide facility maturity search) rides the same cold pass —
one re-extraction for all of it rather than two.

Also carried: the headline verb derived from the tranche event's kind rather
than generated per run (a redemption is "redeem", an issuance-to-replace is
"refinance", and the verb is the call); HCA's aggregate label; Quest's
matured-row fix; Centene's facility-size miss.

**Session 22's own reproducibility work is closed, not carried.** Both failing
names were fixed as rules over the class — letters of credit have no ladder
destination (48), and row identity keys on stated facts rather than on the
label (49). The first was the model-routing instability the schema-as-fact work
addressed, one instrument type over; the second was naming, and neither was
solved by normalizing the filer's words.

### Audit session

**It is step 4 of the sequence in §13.5, not the next session.** Session 23
finishes the ten, a full-book product read and its fix pass follow, and the
audit comes after those — then the ~40-name pre-warm and a fix pass on what it
surfaces.

Carried into it: guard-corpus type-completeness (Rule 42), cost-log
persistence after narration (Rule 43), the shared measured-vs-unreachable
helper (Rule 37), and `PRIORITY_CLASSES` ordering junior-priority above
senior-secured — the last is required before the 40-name run, because junior
debt rendered as more senior is visibly, backwards wrong.

Added by the post-session docs pass: **a staleness check for every generated
artifact (Rule 50)**. `sessions/22/signature_review.html` was committed showing
DaVita at 10 ladder rows against a packet, and a golden, of 9 — Rule 48 removed
the letter-of-credit row after the page was rendered and nothing re-rendered
it, so a surface asserting "generated from the pinned data" was out of sync
with that data. The page is regenerated; the guard is not built. It belongs
with this session's other rule-scalability work: a `signature:check` in the
shape `docs:rules:check` already has — re-derive, compare, fail loudly — and a
decision about which of the book's derived files need one.
