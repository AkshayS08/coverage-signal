# Session 19 — harness and guard structure, then the one-slot schema, everywhere else

Read the numbered rules at the end of `coverage_signal_build_log.md` before writing any code, particularly 8 through 11. Everything below is rules over the data. Company names are worked examples of a shape; a change that satisfies the named company while the rule stays unimplemented has fixed nothing.

Work in stages. Stop at each STOP and report. Nothing after Stage 1 starts until the Stage 1 report has been reviewed.

---

## Stage 1 — code-only, $0.00, before any paid work

### 1a. The guard corpus is derived, never enumerated

checkCardStructure failed on Centene because its corpus came from a hand-maintained field list that never gained E4's fields. Adding fields to the list is not the fix. The rule: the corpus is built by walking the same object narration actually receives, so a field cannot reach the model without reaching the guard. The hand list is deleted, not extended. If any field must be excluded, the exclusion is an explicit list with a comment saying why, so the default is inclusion.

Verify by reconstruction: rebuild the v8 Centene case against the derived corpus and show $1.1 billion passing, then confirm the current book re-renders byte-identical at $0.00 across 0 calls.

This makes "do not add a field the guards cannot see" structural rather than procedural, which is the point.

### 1b. A determinism sample is only valid when every fetch succeeded

The harness's per-company try/catch pushes {company, error} into the compared output, so a transient fetch failure reads as a byte diff. The rule: fetch errors leave the compared bytes entirely. A caught error invalidates that pass, logs {company, error, timestamp} to a separate channel, and retries the pass up to twice. A pass that can't complete cleanly after retries reports as INCOMPLETE with its error log. FAIL is reserved for byte differences between clean passes.

Verify by fault injection: force one fetch to throw mid-pass in a test, show the pass retries and the compared output is unchanged. Then determinism x3 local on the fixed harness.

### 1c. One question, answered from code, no fixes

What does a live weekly render show for a company whose fetch fails mid-pass: an error state, a stale cache serve, or a silent absence? If silent absence, flag it as a Session 20 item and stop there.

**STOP.** Report 1a, 1b, 1c with verifications. Commit as its own commit.

---

## Stage 2 — all changes written and reviewed before spending

Write everything below, show the extraction prompt diff and schema diff, and stop before re-extracting anything.

### 2a. Multi-fact triggers return arrays

`debt-maturity` already returns a sequence. Extend the same shape to triggers where a company routinely has more than one instance in a period: divestitures and asset sales, acquisitions, capital raises, capex projects.

The rule for which triggers change: a trigger whose real-world instance count per period is plausibly greater than one returns an array. A genuinely singular condition (a cash balance, a covenant status, a floating-rate exposure) stays scalar. State which triggers changed and why, in a table covering the full trigger set, and report any where the call was close. The decision is made once for the class.

Each entry keeps the same verification contract as a ladder row: its own `sourceLine`, verified literally, bounded to its own region (BRD 8.3). Transcription, not selection: copy every qualifying event in printed order, never rank or choose. CHS's two divestitures ($459M Crestwood stranded in prose) are the shape.

### 2b. Repurchases described in a note's own prose

Add a field for retirements and repurchases stated in the debt note's narrative rather than in an 8-K. Copied verbatim, never inferred, with the amount and the instrument as the filing names them.

The position layer treats it exactly as it treats `redeems`, under the rules already in the BRD: retired only when the amount equals the outstanding balance, a partial reduces the balance and the row stays live, ambiguity fails safe toward keeping (BRD 6.0).

The authority rule still governs, with one extension: the note is the position, and prose inside the note is the note speaking about itself, so it is authoritative for that note's own period. This is a different case from an 8-K, which wins only when it post-dates the note. Centene's $1,147M six-month repurchase is the shape.

### 2c. A dated project is never standing

A project with a stated completion date has a status derived from that date: upcoming before it, completed after. `standing` is reserved for undated recurring disclosures. Implement as a rule in the status derivation, not a company patch. UHS's Miller Medical Plaza (stated completion Q4 2026) is the shape.

### 2d. proceedsUse input cut to cited paragraphs

This call is 59% of a cold pass and answers a 200-token question from full filings. Cut its input to the cited paragraphs plus bounded surrounding context. State the bound in the report: what context, how much, why. Capture a baseline of every company's current proceedsUse value before the change. If any company's value flips after, that is a finding to report with both values and the input diff, never something to tune away by widening the bound until it matches.

### Render consequences (apply after run B)

- Multiple facts of one kind in a bucket render as separate lines, each with its own source.
- The gate decides card-or-table per fact, not per trigger. Two divestitures in one period may produce one card and one table line.
- Existing dedup and one-conversation-per-company rules apply unchanged: several facts of one kind on one company are one conversation, not several cards.

**STOP.** Show both diffs, the trigger decision table, the proceedsUse baseline and bound, and a cost estimate for run A and run B separately. Approval comes before spending.

---

## Stage 3 — two paid runs, in this order, after approval

The standing one-substantive-change-per-paid-run constraint holds. The proceedsUse cut is its own run because it is the change that can silently flip values; the schema changes share the second run because they touch disjoint surfaces and the line-level baseline can attribute each.

### Run A: proceedsUse cut only

Bump the extraction promptVersion, re-extract all ten, both books.

- Baseline diff: the only changed lines permitted are proceedsUse-attributable. Any value flip reported with both values and the input diff.
- Report actual cost and proceedsUse's share against the 59% baseline.
- Persist the new line-level baseline.

### Run B: 2a + 2b + 2c

Bump again, re-extract all ten at the now-reduced pass cost. Then:

1. Full baseline diff against run A's baseline, every changed line attributed to 2a, 2b, or 2c, in a review artifact using the slab/rail format — rendered output in monospace slabs tabbed RENDERED OUTPUT, annotation on the rail outside them. Anything unattributable stops the session.
2. For each trigger changed to an array: how many companies returned more than one fact, and what rendered.
3. The two confirmed instances resolved, stated as consequences of the rule rather than as fixes.
4. Co-occurrence count book-wide before and after, every new field under the bounded contract.
5. Narration re-bill only for companies whose facts changed; list them and why before spending. Rule 9 pre-flight: confirm 1a held, meaning nothing reached narration without reaching the derived corpus.
6. Determinism: warm-up run, then both books x3, byte-identical, local and live, on the fixed harness. Any INCOMPLETE reported with its error log.
7. Offline suites, tsc, build. Push to main only if all of the above are clean; report branch, hash, deployment.

---

## What not to do

- Do not widen extraction to prose outside the located note. The heading-first locator's whole gain is knowing where the note is; reading narrative anywhere in a filing reopens the fabrication surface that produced four incidents.
- Do not edit the taxonomy. The two known-questionable bucket mappings (acquisition consideration under new debt, a cost exposure under hedging) get a report on what a change would involve, and no change.
- D2 month recovery from prose is decided out: a range over the ladder is not a month for a tranche, and attaching one is inferred precision.
- Item 3 market risk (maturity wall, hedging depth) waits for the first post-demo bump.
- Nothing from Session 20: narration retry, pre-warm, Book B raw-body scan.

---

## Standing constraints

- Persist line-level output after each run so the next diff has a baseline.
- Never suppress: a line that cannot render correctly renders with its problem stated.
- New rules earned go in the build log under the session numbering; check for collisions with render rules 7-9 already logged and renumber if needed.
- Budget: Stage 1 free. Runs A and B together should land near one full-price cold pass because A cuts the cost of B. If projected total spend exceeds $3.00, stop and ask.
