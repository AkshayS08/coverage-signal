# Session 27, Stage 1: Checkpoint 1b (the three $0 items, re-declared cost)

Follows [stage1_checkpoint1.md](stage1_checkpoint1.md). Nothing billed; nothing pushed.

## 1. The dig

**What it does.** When the base answer marks a trigger `needsDig` and names a filing in `digHint`, the loop reads that one filing and asks Haiku about that one trigger again (`classifyOneTrigger`), with the prior verdict and the new filing's excerpt. The refined verdict replaces the original.

**When it fires.** All of these must hold:
- the trigger is `needsDig`, with a hint;
- the hinted filing is not already excerpted (if it is, the loop logs "nothing new to check" and opens nothing);
- the hinted filing exists;
- the budget allows it: at most 5 digs per run (`MAX_DIG_STEPS`).

**What it reached at v31, across all ten names:**
- **Asked:** 5 times, in 2 of 34 stored v31 base answers.
  - DaVita's signed canonical answer asked 3 times (international-expansion, commodity-exposure, fx-exposure); the hints were the 2025 10-K and the June 10-Q.
  - An earlier Cigna v31 answer asked 2 times (commodity-exposure, fx-exposure); the hint was the 2025 10-K.
  - UHS, HCA, Quest, Centene and the other six-name answers asked 0 times.
- **Opened:** nothing. Every hint named a filing already excerpted.
- **Billed:** $0. No v31 ledger line for any name has a dig call; Cigna's second Haiku call on Sept 29 was its referenced note.
- **Ever stored:** one dig answer, for Quest at v2 (Aug 21).

**Correction.** Checkpoint 1 said the dig "fired on none of the six signed answers". It was asked in DaVita's signed answer and opened nothing. My first probe read a re-taste copy of DaVita's answer, not the canonical one.

**Restored under the read-set rule (v33):**
- **Candidate list** (`digCandidatesOf`): decided from the filing list alone, by the read set's own helpers. It is the latest 10-K, the 10-Qs filed since it, and the trigger-item 8-Ks filed since it (the read window). With no 10-K, it is nothing beyond the read set.
- **The list is in the base key.** The prompt's catalog lists the read set as "Excerpted below", and the candidates not excerpted as "Not excerpted: the only filings a digHint may name".
- **The loop opens only a listed candidate**, never any filing EDGAR returned.
- **Recording.** Every document the dig opens joins the recorded read set (`recordedReadSet`, on the result), with its sha256. The dig answer's own key carries that hash.
- **What it can reach today:** only CHS has a candidate that is not already excerpted, an 8-K filed 2026-03-05 (Items 1.01, 8.01; about 2,300 tokens). For the other five, every candidate is already in the read set.

**Tests (`readSet.test.ts`, all six names):**

| | Before | After |
|---|---|---|
| D1: an unrelated filing (5.02 8-K; EDGAR's window aging out) moves neither the candidate list nor the key | passes trivially (no list existed) | passes |
| D2: a new 10-K moves both | 0 of 6 | 6 of 6 |
| D3: a change to the candidate list alone (a 10-Q since the 10-K that does not enter the read set) moves the key | 0 of 6 | 6 of 6 |
| D4: a dug document joins the recorded read set with its hash | 0 of 6 | 6 of 6 |
| K7: the loop digs from the candidate list and records what it opens | fails | passes |
| **Whole file** | **50 passed, 19 failed** | **69 passed, 0 failed** |

Negative controls: 63 of 63 fail as required.

## 2. F2: your ruling, recorded

8-K Items 7.01 and 8.01 stay in the read set. It is recorded in BRD §4 (the item-filter line, plus a new section 4.0a) and beside the item list in `selectFilings.ts`.

## 3. F3: every blob read capped at two retries, and a hang is a failed read

- **One rule for every read the build depends on** (`retryRead`): the read and at most two retries. Each attempt is cut off after 60 seconds (`READ_TIMEOUT_MS`): its abort signal fires and the attempt is abandoned even if the transport ignores the signal. Then a named `ReadFailedError`.
- **Blob reads** go through `blobRead`, which sets the client's own retries (`VERCEL_BLOB_RETRIES`, default 10) to zero for the call. So a blob read is at most 3 attempts in total, whether it is a `get` or the answer-key `head`.
- **EDGAR reads** pass the same abort signal to `fetch`.

**Tests (`failClosed.test.ts`), H1–H5 over all six names:** a filing-text read, a cached-answer read, the answer-key HEAD, the EDGAR filing list and the company-facts read are each made to never answer.

| | Before | After |
|---|---|---|
| H1–H5 | 0 of 30 (every one still waiting at the 30s deadline) | **30 of 30**: each stops with its named error after exactly 3 attempts, 0 model calls, 1 ledger line |
| R1–R6 | 36 of 36 | **36 of 36** |

## 4. Release checklist

`npm run release` (`lib/cache/release.ts`) is the push path:
1. It refuses unless you are on main with a clean tree. Every check runs with the API key blank.
2. **Checks, in order:** preflight → 60-second pause → goldenThroughLoop → the offline suite → failClosed. Any non-zero exit stops it.
3. It refuses if any ledger line written by the checks billed. It commits the $0 lines as the only extra commit.
4. It records the cleared commit in `.git/release-checked`, pushes, and waits up to 15 minutes for `/api/health` to serve the pushed SHA.

**Pre-push hook.** `.githooks/pre-push` is active through `core.hooksPath` (a repo-local git config change, made). It refuses a push to main of any commit the checklist did not clear. The only exception is the release's own ledger-only commit on top of a cleared one. `release.test.ts` runs the real hook against a scratch repo: 8 passed, 0 failed, including a permissive-hook control. `git push --no-verify` bypasses any git hook; that is a deliberate act, not a skipped step.

**The offline suite now blocks a release, today.** Acceptance fails on DaVita, and has since Session 26:
- 5.7, 2030: the card shows $9,344.3MM; the filer's schedule says $4,554.3MM.
- 5.7, 2031: the card shows $7,622.1MM; the schedule says $3,764.2MM.
- 5.8: the ruled $65MM residual.

The release on Oct 21 went out with these failing; I did not run the suite. 5.7 looks like a real product defect (the card is about double the schedule in both years). I found no ruling for it. 5.8 is ruled but not marked as ruled in the test. Both need your call before the next push can clear. This does not affect re-extraction.

**Not covered by the release script:** CLAUDE.md's "do not push until local determinism passes". The release script does not run `determinism.test.ts`, which the offline runner lists as billing on any cold first run. Under v33, until the re-extraction, every run is cold. Say if you want it added after the re-extraction, when it would run at $0.

## 5. What `f10862a` changed, and why that is the product being right

**It changed the test, not the data or the code.** `printedHeadings.test.ts` checked that every row of a loop-derived snapshot carries `printedHeading`, over a hard-coded list of five names. Encompass was on the list.

**What the product does.** Since the Oct 21 release (`aa24903`), a name whose fingerprint moved renders from its signed golden's stored result. Encompass did this for the same reason Cigna already did. That stored result predates the `printedHeading` field. The position code handles a legacy result by keeping its recorded headings, and Encompass's card built from it was byte-identical to the card built from the loop: 153,157 bytes, and 0 differing pixels against screenshots_v7.

**Why the test was wrong.** It named instances, against "rules over the class". It went on calling Encompass loop-derived after Encompass stopped being so. It now chooses snapshots by their recorded `source`. A control checks that the golden-derived ones (Encompass, Cigna) would fail the check, so the choice of snapshots is what keeps them out, not luck.

**Where it would not be right.** If the Encompass card had changed, the fix would have been in the data or the code. It did not change.

## 6. Re-declared cost (v33)

The base cost per name is unchanged. v33 lists a handful of filings where v32 listed none and v31 listed 148–293, so the figures from the v31 ledger remain upper bounds.

The one addition is the dig. Only CHS can open anything: at most 5 one-trigger Haiku calls of about 9k tokens in, about $0.02 each, so up to **$0.10 per CHS run**.

| Name | Canonical | Two re-tastes |
|---|---|---|
| Tenet | $0.2246 | $0.4492 |
| Encompass | $0.1949 | $0.3898 |
| DaVita | $0.1923 | $0.3846 |
| CHS | $0.2428 (incl. $0.10 dig) | $0.4856 |
| Molina | $0.2063 | $0.4126 |
| Cigna | $0.2001 | $0.4378 (incl. referenced note) |
| **Total** | **$1.2610** | **$2.5596** |

**Grand total, if both are approved: $3.8206.** The gate in `s27reextract.ts` carries these per-run ceilings, including the dig contingency.

## 7. Final test state (on the committed tree)

| Check | Result |
|---|---|
| `readSet.test.ts` | 69 passed, 0 failed; controls 63 of 63 |
| `failClosed.test.ts` | 66 passed, 0 failed; controls 2 of 2 |
| `release.test.ts` | 8 passed, 0 failed (in the offline suite) |
| Offline suite | 60 of 61 suites, 1,814 assertions. Only acceptance fails: DaVita 5.7 ×2 and 5.8 ×1, unchanged since Session 26 (section 4) |
| goldenThroughLoop | 2 passed, 2 failed, as expected: no golden at v33 until re-signing (checkpoint 1, F4) |
| `thisWeekFingerprint.test.ts` (not in any required check) | expects the six names cached, so it fails until the re-extraction |

Ledger: every line this session is $0.
