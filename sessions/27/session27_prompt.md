# Session 27 prompt: from six signed cards to "enter a name, get a card"

Start this session only after the v3.0 card redesign is cleared and pushed.

## Where this is going (context, not all for this session)

The product goal: an RM types a company name and gets a card. Where the tool can't stand behind a number, the card shows the breakage plainly, never a confident wrong number. The order:

1. **Cache scoped to what extraction reads** (this session, Stage 1).
2. **One pipeline that builds a card from scratch for any company**, which is also the quarterly refresh. A new 10-Q is just "build this company again" (this session, Stage 2: design only).
3. **The product surface:** name input, progress, trust badge, spending cap (next session).
4. **Testing in widening rings:** the six signed names first, then the four deferred names (UHS, HCA, Quest, Centene) to see where it breaks, then fixes as rules, then any name, with breakage visible.

The demo to Gabe waits until step 4 holds.

## Standing constraints

- **Rules over the class**, named examples for shape only.
- **Read before write** (Rule 69). **Enumerate before diagnosing** (Rule 63).
- **Nothing bills without a written declaration and Akshay's approval.** Preflight and assertFree before any command that could reach a model. Every billing path goes through withCostScope (Rule 68).
- **Commit per change; push only when told.**

## Stage 1: Cache scoped to what extraction reads

**The problem.** corpusFingerprint hashes the company's whole EDGAR catalog (about 160 filings). Any change orphans every cached answer for that company, including an 8-K that has nothing to do with debt (Cigna's Oct 9 Item 5.02 officer change). On-demand use and a weekly refresh both make this constant.

**The rule.** A cached answer's key covers exactly the inputs that shaped it: the documents the extraction read (each by accession number and content hash), the prompt version, and the locator version. A filing the extraction never read cannot move the key. The key must still move when:
- a read document changes;
- a new filing would change what extraction reads (a new 10-Q or 10-K that becomes the anchor; a new 8-K inside the window the extraction reads);
- the prompt or locator version changes.

**Steps:**
1. **Measure first, at $0.**
   - List every input loop.ts reads per company, and from where.
   - Record each signed name's current read set.
   - Replay the last 90 days of each company's EDGAR catalog changes against both keys (old whole-catalog, new read-set). Report how many times each key would have moved, and why.
   - The new key must move on every real anchor change and on no unrelated filing.
2. **Define "would change what extraction reads"** as a deterministic function of the filing list (form type, filing date relative to the anchor, the 8-K items the extraction reads), shared by the key and the preflight. One deciding function, never two.
3. **Tests:**
   - an unrelated 8-K (Item 5.02 shape) does not move the key;
   - a new 10-Q does;
   - an 8-K with a debt item inside the read window does;
   - a prompt version bump does.
   
   Each test includes a negative control.
4. **A failed read is an error, never a fallback.**
   - **What happened.** In Session 26's last run, a cached read failed mid-run on a network drop, and the loop fell back from the XBRL read to a model read ("expected xbrl, got model-read" on Tenet). It cost $0 only because the API key was blank. With a key present, that is a silent bill and a different answer from a different source.
   - **Rule.** When any read the extraction depends on fails (cache, blob store, EDGAR, XBRL), the build stops with a named error. It never switches source, never treats the failure as a cache miss, and never calls a model to cover the gap.
   - **Retries.** Retrying the same read is allowed, at most twice. Switching to a different source is not.
   - **Enumerate first.** List every fallback path in loop.ts and its callers (Rule 63) before changing any of them.
   - **Tests.** A simulated failed read on each source stops the build with its named error and zero model calls. Negative control: the current fallback path must fail the test.
   - **Order.** This lands before any re-extraction spend in step 5.
5. **Re-keying orphans the old answers once.** Declare that cost before any spend:
   - which names re-extract;
   - the expected cost per name, from the ledger;
   - the reconciliation gate: forced misses equal the declared names, and every one bills non-zero.
6. **After approval:**
   - re-extract the six signed names under the new key, then run two re-tastes each for 9b;
   - report diffs per name against the signed goldens;
   - nothing re-signs without Akshay's clear;
   - expect zero position change. Any change is a finding to explain before signing, never a signing detail.

**Checkpoint 1.** Stop twice:
- after step 5, with the measurement, the tests (including step 4's), and the declared re-extraction cost;
- after step 6, with the six diffs.

## Stage 2: One build-a-card pipeline (design only, nothing built, nothing billed)

Write sessions/27/pipeline_design.md, covering:

1. **Entry point.** `buildCard(company)`, where company is a name, ticker or CIK, resolved to a CIK through EDGAR's company list. When more than one company matches, return the matches for the user to pick; never guess.
2. **Stages, in order:**
   - resolve the company;
   - fetch the filing list;
   - choose the anchor;
   - decide the read set (Stage 1's function);
   - check the cache;
   - extract on a miss;
   - run the referenced-note call where Rule 66 directs;
   - run the loop's post-extraction rules;
   - run every automated check;
   - render.
   
   For each stage, give what it reads, what it writes, what it costs, and how it fails.
3. **Trust states**, decided by rule and shown on every card as a badge:
   - **Signed:** a golden exists at this version and read set, and the card matches it.
   - **Checks passed:** no golden, but every automated check passes: coverage ties within its rule, every figure links to a sentence that contains it (Rule 58), no false "not stated", and the stability runs agree.
   - **Checks failed:** at least one check fails. The card renders anyway, with a breakage panel at the top naming each failed check, its figure, and its source. A failed figure renders withheld or flagged, never as a clean number.
   - **Could not build:** the pipeline stopped before a card existed (no 10-Q or 10-K, filing unreadable, cost cap reached). This shows a plain-language reason.
4. **Stability on demand: decided by Akshay, three samples.** A fresh name gets three extraction samples on a cold build. The stability check (9b's identity rules, tolerated differences recorded) must hold across all three before the badge can read "Checks passed". A figure that differs across samples is shown withheld and listed in the breakage panel. Design the three samples so they run concurrently where possible, state the expected cost and time per cold build from the ledger, and confirm a cached rebuild is still $0.
5. **Quarterly refresh.** Built as the same pipeline. When a signed name gets a new anchor filing, its card rebuilds, the badge drops from "Signed" to the automated result, and the old signed card stays available as the prior quarter. Moves that were "awaiting confirmation" get re-evaluated against the new filing (Tenet's Sept 23 redemption).
6. **Cost controls.** A per-build cap, a per-day cap and a per-user cap, all enforced before any call through assertFree-style guards. A cached build is $0. Show the expected cost before a cold build starts.
7. **Concurrency and cache writes.** Two builds of the same company at once must not double-bill or write conflicting answers.
8. **What the card needs that the snapshots supply today,** and how the pipeline supplies it live instead of from committed snapshots.
9. **Test plan.**
   - **Ring 1:** the six signed names, which must come out "Signed" and byte-identical to their goldens at $0 after Stage 1's re-key.
   - **Ring 2:** UHS, HCA, Quest, Centene, with the expected breakage per name from what we already know.
   - **Ring 3:** any name.
   
   Define the accuracy scorecard Akshay fills in per name (correct / wrong / honestly flagged, per headline figure and per ladder row).

**Checkpoint 2.** Stop with the design document. Nothing is built until Akshay approves it.
