# Doc cleanup and file reorganization — code and docs only, $0, no extraction

Before Session 23 and the audit, the documentation and file tree need a pass so both work from a clean, current state. This is $0: no model calls, no re-extraction, no deploy-affecting logic change. Two parts — fix the drift in the docs, then reorganize the files with history preserved. Do part 1 first (it edits files in place), then part 2 (it moves them), so the moves carry the corrected content.

STOP after part 1 with the diffs for review before moving anything.

## Part 1 — six documentation-drift fixes

Each is a stale fact in a doc that a reader (the audit especially) would take as current. Fix in place, show the diff.

1. **Build log — stale session spend.** The Session 22 close-out entry records "true session spend ~$4.79" (persisted $3.7049 + narration $1.09). That figure was written before Stage 7's x3 runs and golden writes. The actual close was ~$7.1 of $10. Correct it, and note in one line that the earlier figure predated the Stage 7 signature runs, so the correction is visible rather than silent (Rule 20's whole point is that a cost number is trustworthy).

2. **BRD §13.0 — session-history table stops at Session 20.** Add rows for Session 21 and Session 22 in the same format as the existing rows (session number, commit, one line of what shipped). Session 21: the semantics/reproducibility work, 6 golden criteria hardened to nine, Rules 22–33. Session 22: the semantics layer (facility type, priority class, facilities located in their own span, computed liquidity, LC handling), 6 of 10 golden at v29, Rules 34–49, commit bda24f5. Pull the specifics from the build log's own close-out entries so the table matches the log.

3. **BRD §13.0 and its open-work table — stale planning lines.** The table still carries pre-rescope items: "19 | Verification strip, pre-warm ~40 names, recall spot-checks, then demo", "Pre-warm script ~40 names, Session 19 before demo", and similar. These describe a plan that changed several sessions ago. Mark each resolved or superseded with where it actually landed, or remove it if it's fully captured elsewhere. Do not silently delete a deferred decision that's still open (e.g. new-debt-issuance multi-issuance collapse is still deferred and stays); only clear items that are done or moved.

4. **The sequence is out of date, book-wide.** Multiple places (§13.5, §14 Session 22 close, anywhere the plan is stated) say the audit sits directly between Session 22 and the 40-name pre-warm. The current sequence is: Session 23 (finish the ten — full-note transcription, Cigna roll-forward, facility bump, Quest/Centene/HCA unblocks) → a full-book product read (Claude Code generates all ten as they render, for an RM read against the demo script's three questions per company) → fix pass → audit session (rule/architecture scalability) → 40-name pre-warm → fix what it surfaces. Update every place that states the plan to this sequence, consistently.

5. **BRD — duplicate "## 14" heading.** Two sections are numbered 14 ("Acceptance, standing" and "Session 22 close"). Renumber so numbering is unique and monotonic (the close-out is later, so it becomes §15, or renumber as fits the document's order). Fix any cross-references.

6. **BRD §8 — subsection ordering.** §8.11–8.13 (semantics, facilities, provenance) appear before the "## 8. Guards" heading, and §8.5 sits before §8.4. Reorder so §8's subsections run in numeric order under the §8 heading. Content unchanged; ordering only.

Also, one build-log consistency fix: **Rules 7–12 are bold paragraphs while every other rule is a heading.** Promote them to the same heading style (`### Rule N — <statement>`) so the rules list is one clean, greppable index from 1 to 49. Content unchanged.

STOP with all part-1 diffs for review. Do not proceed to part 2 until approved.

## Part 2 — file reorganization, git mv, history preserved

The tree has grown messy: the BRD is at repo root while the build log is in `files/`, session artifacts (prompts, reviews, evidence, declarations, .txt dumps) are split across root and `files/`, and there is no single rules index. Reorganize to one canonical doc per thing and session artifacts grouped by session. Use `git mv` for every move so history follows the file; never delete-and-recreate.

Target shape (adjust names to match what actually exists):

```
coverage-signal/
  docs/
    BRD.md                    (was coverage_signal_BRD.md)
    build_log.md              (was files/coverage_signal_build_log.md)
    rules.md                  NEW — one line per rule 1–49, each linking to its build-log entry
    build_map.md
    metrics_cost_limits.md
    trigger_taxonomy.md
    card_eligibility_spec.md
  sessions/
    17/  prompt.md
    18/  prompt.md, rm_review.md, evidence/ (the session18_stage1_evidence folder and its .txt dumps)
    19/  prompt.md, schema_prompt.md
    20/  prompt.md, stage3_kickoff.md, rm_review_stage2.md, stage2_commands.md
    21/  prompt.md, card_review.txt, check_sheets.txt, verification_sheets.txt
    22/  prompt.md, stage7_batch.md, v29_declaration.md
  (code, baselines/, CLAUDE.md/AGENTS.md, config — unchanged in place)
```

Requirements:
- Every move is `git mv`. Confirm `git log --follow` still traces each moved file's history.
- The new `docs/rules.md` is generated from the build log's rule headings (now clean from part 1): rule number, its one-line statement, and a link or line-reference into build_log.md. This is the audit's reading list.
- After moving, grep the whole repo for references to the old paths — CLAUDE.md, AGENTS.md, README, any script, any test, any prompt file, next.config, package.json scripts — and update every one to the new path. A moved doc that a script still reads at its old path is a broken build.
- Then run `npx tsc --noEmit` and `next build` to prove nothing that the code imports or reads moved out from under it. If either breaks, report the broken reference; do not guess-fix.
- Do not move anything under `baselines/`, `lib/`, `app/`, or config — only docs and session artifacts. The golden files stay exactly where the code reads them.

STOP with: the `git mv` list, confirmation that `git log --follow` traces history on a spot-checked file, the path-reference sweep results, and a clean tsc + build. Commit as one code-and-docs commit, message "docs cleanup + file reorg, $0, no logic change". Push only after the build is confirmed clean.

## Not in scope

No extraction, no re-run, no golden re-sign, no logic change. If any part-1 fix or path update would touch runtime behavior, stop and flag it rather than making it — this pass is documentation and file location only.
