# Session 27, Stage 1: Checkpoint 1

Status: steps 1–5 done at $0, nothing billed. Step 6 waits for your approval of the cost declared in section 6.

## 1. Measurement (step 1, $0)

Full output: [stage1_measurement.txt](stage1_measurement.txt). Script: `lib/cache/s27measure.ts`.

For each signed name, the script rebuilds the full EDGAR history: the submissions feed's "recent" block plus its older pages. It then emulates, for every day of the last 90, the catalog EDGAR would have returned that day. That catalog is the newest filings of any form, as many as the "recent" block holds (never less than one year). Both keys are computed on it each day.

**Check before trusting the replay:**
- 157 of 171 fingerprints actually observed (committed snapshots and stored answer keys) reproduce on their own day.
- 12 more match a catalog a few days older. Those answers were written from a pinned or earlier filing list.
- 2 match no day: Tenet `0c61da84` (Sept 9) and Cigna `f1237506` (Sept 30). The likely cause is finding F1 below; this is inferred, not proven.

| Name | Old key moves (90 days) | Read-set key moves |
|---|---|---|
| Tenet | 9 | 3 |
| Encompass | 6 | 3 |
| DaVita | 1 | 1 |
| CHS | 3 | 1 |
| Molina | 1 | 1 |
| Cigna | 5 | 2 |
| **Total** | **25** | **11** |

**Why the read-set key moved, all 11 times:**
- six new 10-Qs, one per name: each became the anchor;
- Tenet Sep 22 8-K (Items 1.01, 2.03): new debt;
- Tenet Sep 8, Encompass Aug 5, Encompass Aug 13 and Cigna Sep 30 8-Ks, carrying Items 7.01 or 8.01. Extraction reads these, so the key correctly moves (see F2).

**The 14 moves of the old key alone:**
- 11 were Form 4, 144 or 13G filings pushing 2014–2018 8-K/10-Q/10-K entries out of EDGAR's count-capped window;
- 3 were 8-Ks the extraction does not read: Tenet Jul 23 (Item 2.02), Cigna Jul 30 (Item 2.02, the same day as its 10-Q), and Cigna Oct 9 (Item 5.02).

**Criterion:** the new key moves on every real anchor change and on no unrelated filing. Met on all six names.

## 2. What the extraction reads, per company, and from where

Before the base call, all of this is read in `resolveReadSet` (`lib/cache/readSet.ts`), the one place both the loop and checkFree/preflight go through.

| Input | Read from | Shapes |
|---|---|---|
| CIK and registered name | blob `edgar/cik/<slug>` (24h) ← blob `edgar/company_tickers.json` (24h) ← EDGAR | the name opens the prompt |
| Filing list | blob `edgar/submissions/CIK…` (24h) ← data.sec.gov; per-form lists blob `edgar/filings/<slug>__<form>` (24h) | which documents are read |
| Read set: two newest 10-Qs, newest 10-K, six newest 8-Ks with a trigger item (`selectFilings.ts`; three newest 8-Ks if none) | blob `edgar/filing-text-v2/…` (permanent) ← EDGAR | the excerpts; 9 documents on every signed name |
| XBRL stated debt total at the anchor's period end | blob `edgar/companyfacts/CIK…` (24h) ← data.sec.gov | where the debt-note excerpt is cut |
| Prompt, triggers, locator code | code (`EXTRACTION_PROMPT_VERSION`, `NOTE_LOCATOR_VERSION`) | everything |
| **Until v31: the whole 8-K/10-Q/10-K catalog (148–293 lines), listed in the prompt** | the filing list | the answer. This is why the old key had to hash the whole catalog. |

After the base call:
- referenced note (Cigna, Rule 66): keyed on its document and `rn-v`;
- dig: fired on none of the six signed answers;
- XBRL total and maturity buckets: the same company-facts read;
- proceeds-use (Sonnet): keyed on the fingerprint plus a hash of its input;
- verification: against the read set's full texts.

## 3. The rule as built (steps 2–3)

- **One deciding function.** `readSetOf(filings)` decides what is read from the filing list alone (form, filing date, 8-K items). `resolveReadSet` turns that into the key. The loop, `checkFree` and `preflight` all go through them, and K7 checks this against the source code.
- **What the key covers:**
  - the registered name;
  - for each read document: form, filing date, period, items, accession, URL, a hash of its full text, and a hash of the excerpt the model is shown;
  - the XBRL bound;
  - the prompt version and the locator version.

  Hashing the excerpt means a change to the locator's code moves the key even if `NOTE_LOCATOR_VERSION` is never bumped (it has stayed at 1).
- **Prompt v32: the catalog section lists only the read set.** This is the one prompt change. Without it, a filing never read would still shape the answer, and the rule could not hold. The dig loses its targets; it had none in use.
- **New namespace `answer/<cik>/base-rs/…`.** The v31 answers under `base/` stay in place, unread. The goldens were signed from them.

## 4. Tests: failures before → after

| Suite | Before | After | Negative controls |
|---|---|---|---|
| `readSet.test.ts` (K1–K7, all six names) | 18 passed, 21 failed (K1, K5, K6 ×6; K7 ×3) | **39 passed, 0 failed** | 37 of 37 fail as required |
| `failClosed.test.ts` R1–R6 (all six names) | 0 of 36 passed | **36 of 36** | 2 of 2 fail as required |
| … Rule 68 on the throwing path (added to every loop case) | 0 of 6 (R1, with the persist removed) | included in the 36 | — |
| offline suite (`runOffline`) | 59 of 61 suites | see section 5 | — |

**Step 4 fallback paths found, all now closed:**
1. **`companyFacts`:** a failed cached read was replaced by a direct EDGAR read, which is a source switch.
2. **`fetchXbrlDebtTotal`, `fetchXbrlMaturityBuckets`, `fetchXbrlCash`:** a failed read came back as an empty result. The debt-note boundary then abstained, which changes the excerpt, and the denominator fell to the model-read captions. This is Tenet's "expected xbrl, got model-read".

   Before the fix, R4 showed both halves of the danger:
   - On four names the run completed: the cache served an answer computed from a different excerpt, because the old key did not cover the excerpt.
   - On Encompass and Cigna the run reached the model twice each. With a key present, that is a silent bill.
3. **`checkFree` and `preflight`:** any HEAD error meant "not cached". An unreachable store was reported as a miss.
4. **The proceeds-use catch-all:** a failed read became a null field.
5. **`readCache` and `secFetch`:** errors were unnamed. They now raise `ReadFailedError` (source blob, edgar or xbrl), after at most two retries of the same read.
6. **Rule 68 gap:** the loop wrote its spend to the ledger only on success. A read failing after the model call has billed would have left that spend off the ledger. The loop now persists on the throwing path, under its own scope only.

**Not read failures, listed for completeness:**
- the referenced note is skipped with a logged reason when no directed filing exists;
- `classifyAllTriggers` retries once on a malformed model response.

**One live confirmation.** During one full run, the uninjected Tenet control hit a genuine transient company-facts read failure. The build stopped with `ReadFailedError (xbrl)` instead of falling back. Re-run twice, it completed.

## 5. Findings: logged, not fixed

- **F1. Per-form filing lists are cached separately from the submissions feed.** Each has its own 24-hour TTL, so one catalog can mix lists from different days. This is the likely explanation for the two unreproduced keys. With the read-set key, a mixed list can still mix the read set. Recommendation for later: derive per-form lists from the feed on every read.
- **F2. The read window includes 8-Ks carrying Items 7.01 and 8.01** (earnings releases, investor presentations). Four of the 11 read-set moves came from these. They are read, so the moves are correct. Whether they should be read is a selection question for you: changing `selectFilings.ts` changes answers, so it is not in this change.
- **F3. The blob client retries API calls** (`head`, `put`, `list`) up to 10 times, about 17 minutes of backoff. The answer-key HEAD now caps this at two. Puts and lists are unchanged.
- **F4. Until re-extraction and re-signing, goldenThroughLoop has nothing to compare.** All six goldens are signed at v31 and the code is now at v32, so the suite finds no golden at the current version. Run at $0: 2 passed, 2 failed (`[1b]` "0 of them are at the current extraction v32"; `[2a]` "at least one name is actually checked"). That is the correct reading, not a regression. Re-signing at v32 needs your clear after step 6. Cards are unaffected: they build from the committed snapshots.
- **F5. A release-side test fix, committed separately as `f10862a`.** The release's Encompass snapshot (`aa24903`, already pushed) left `printedHeadings.test.ts` at 13 passed, 1 failed. I ran preflight and goldenThroughLoop before that push but not the offline suite. The test now chooses loop-derived snapshots by their recorded source: 15 passed, 0 failed. The two remaining acceptance failures are DaVita 5.7 (×2) and 5.8 (×1). They predate this session; Session 26 ruled 5.8 a residual, and the cards are byte-identical to the release.
- **F6. Nothing is pushed.** If this code were deployed before re-extraction, every run of the six names would miss.

## 6. Declared re-extraction cost (step 5)

**Which names re-extract:** all six signed names. Every one of them misses under v32 and the read-set key, and its proceeds-use answer is orphaned with it. Cigna's referenced note is keyed on its document, so the canonical run reads it from cache.

**Expected cost per name, from the ledger** (the last v31 extraction, Sept 24–30: Haiku base plus Sonnet proceeds-use). These are upper bounds: the prompt is now 140–285 catalog lines shorter, which saves under $0.01 per name.

| Name | Canonical (step 5) | Two re-tastes (step 6, 9b) |
|---|---|---|
| Tenet | $0.2246 | $0.4492 |
| Encompass | $0.1949 | $0.3898 |
| DaVita | $0.1923 | $0.3846 |
| CHS | $0.1428 | $0.2856 |
| Molina | $0.2063 | $0.4126 |
| Cigna | $0.2001 | $0.4378 (each re-taste also busts the referenced note, +$0.0188) |
| **Total** | **$1.1610** | **$2.3596** |

**Grand total, if both are approved: $3.5206.**

**Reconciliation gate**, enforced by `lib/cache/s27reextract.ts`, which is committed and has not been run:
- **Before:** the forced misses must be exactly the declared runs. Every declared name must miss, under its canonical key and under each re-taste key. If any is already cached, it refuses.
- **During:** every run must bill more than $0, stay within 1.5× its declared figure, and leave its answer at the key `checkFree` names. The running total must not pass the declared total. Any breach stops the run before the next call.
- **After the canonical phase:** all six keys must be cached, so the next run of each is $0.

The script refuses to run without `S27_APPROVED=<phase>` and an API key, and each phase is approved separately.

**What step 6 then reports:** the per-name diffs against the signed goldens. Nothing re-signs without your clear. The expected position change is zero. v32 changes only the catalog section, but it is a different prompt, so any change is a finding to explain, never a signing detail.

## 7. Commits (local, not pushed)

- `e6078dd` measurement
- `abda13e` → `62bd2dd` step 4 (tests, then fix)
- `f90753b` → `9b57a13` steps 2–3 (tests, then code)
- `f10862a` printedHeadings test (release follow-up)
- `179dbd1` Rule 68 on the throwing path
- the declaration and gate script, the build log, and the $0 ledger lines (this commit and the next)
