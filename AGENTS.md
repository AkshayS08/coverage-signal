<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
## Project

Coverage Signal — a weekly call sheet for a commercial banking RM. Reads SEC
filings, checks 15 triggers across 4 buckets, returns cards for events worth a
call plus a portfolio table of verified facts. Deployed on Vercel.

## Files (../files/)

Read before any session:
- coverage_signal_BRD.md — the architecture. Current as of v1.1. Start here.
- the session prompt being worked.

Read on demand:
- coverage_signal_build_log.md — session history and the four standing rules.
  Sessions 10-13 explain why the rules exist. Read before proposing a fix that
  resembles one already tried.
- coverage_signal_trigger_taxonomy.md — trigger definitions. Do not edit.
- coverage_signal_card_eligibility_spec.md — the gate contract.
- coverage_signal_metrics_cost_limits.md, coverage_signal_build_map.md.

Rules:
- Never edit anything in files/ unless asked.
- The BRD wins where documents disagree.
- coverage_signal_v3_architecture.md was deleted. References to it in the build
  log are history, not instructions.

## The design principle

The model reads. Code decides. The model labels what a sentence already says;
code applies the rules. Every time this line blurred, the product broke.

## Standing rules

1. When a fix moves a responsibility from one component to another, test the
   responsibility, not just the fix.
2. A guard that scans vocabulary instead of claims will reject the sentences
   that say the opposite of what it fears. Structural or semantic tests only,
   never word lists.
3. Test the machine you ship, not a fixture of it. Assertions read the HTTP
   response body of an actual run.
4. Fix the shape, not the symptom. Does this make a claim checkable, or does it
   patch a symptom?

## Non-negotiables

- Determinism: one warm-up run, then both books x3, byte-identical, local and
  live. The wording cache never caches a failure, so run 1 after a wording
  change can legitimately differ.
- Never suppress a line to hide a problem. Deleting a line asserts something
  false. Relabel or qualify instead.
- Failures are loud. No silent template fallbacks, no in-memory cache fallback.
- Do not push until local determinism passes.
- Report anything that would need a taxonomy change; do not make it.
- Ask before any expensive operation (full re-extraction, cache invalidation).

## Stack

Next.js + TypeScript, Vercel serverless (read-only filesystem except /tmp),
Vercel Blob for all three caches, Haiku for extraction at temperature 0 with
forced tool use, Sonnet for card narration only.