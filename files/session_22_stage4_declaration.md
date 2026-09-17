# Session 22, Stage 4 — the demo gate. Cost and result shape, declared before spending.

Rule 13. Written before the run, so the run is checked against it rather than
described by it afterwards.

## What the $0 half already found

Stage 4 is "no new work — re-render and assert". The re-render found a demo
name failing its own must-land item, at $0, before any spend:

**Tenet has lost its debt note's section headings at v29.** All fifteen of its
schedule entries carry `seniority: null`. Ten note rows therefore read "class
not stated on this row" while Tenet's own note prints "Senior unsecured
notes:" and "Senior secured first lien notes:" above them. The
class-then-maturity sort — the thing Stage 2 built and the reason Tenet is
demo name #1 — cannot order a ladder on which nothing is classed.

Book-wide, **12 of 68 schedule rows still carry a heading** (Encompass 4, CHS
8) against **33 of 85 classed from a heading at v28**. So the loss is not
Tenet-only. It is only *material* on Tenet, because Tenet is the one filer
whose row names carry no class or instrument words at all — "5.125 % due
2027" — so the heading was its only source. DaVita lost its "Senior" headings
too and is unharmed: its names say "6.75% Senior Notes".

**No $0 recovery exists.** One Tenet row's `sourceLine` does carry its
heading — "Senior unsecured notes: 6.125 % due 2028 $ 1,750 $ 1,750" — because
the heading shares a table line with the first row beneath it. The second
section's heading appears in no sourceLine at all. Carrying the one visible
heading forward to the rows below it would class seven senior secured first
lien tranches as *unsecured*, which is the exact default rule [1a] exists to
forbid, in the unsafe direction, on the flagship name.

The prompt still asks for the field (claude.ts:843, unchanged wording). The
model simply stopped filling it.

## The question this spend answers

Whether the loss is EXTRACTION VARIANCE or SYSTEMATIC at v29. That decides the
fix and nothing else can:

- **Variance** — Tenet fails the gate anyway, because the gate is "perfect AND
  reproducible", and a class that appears in some runs and not others is not
  something a demo can stand on. Fix is a prompt strengthening, v30.
- **Systematic** — the v29 prompt rewrite displaced the field. Same fix, but a
  different confidence about whether one bump ends it.

Either way this is the stage's own required measurement, not an extra.

## Cost shape

CACHE_BUST rekeys only the base classification fingerprint (loop.ts:677), so a
busted run costs at most a cold run and filing text stays free.

| run | basis | expected |
|---|---|---|
| Tenet × 3 | its own v29 cold cost, $0.2185 (max of 2 observed) | **~$0.66** |

Session to date **$1.8578**. This run takes it to **~$2.52 of $10**.

Encompass × 3 (~$0.58) and UHS × 3 (~$0.39) are NOT run yet. Tenet decides
whether the gate is already lost, and re-asking two names to prove they
reproduce is worth nothing if the gate fails on the third — that spend waits
on the Tenet result rather than being committed ahead of it.

## Result shape — what the run must show

1. **Three Tenet extractions at v29, same filings, same prompt version.**
2. For each: how many of its schedule rows carry a non-null `seniority`.
3. The verdict, stated as one of exactly three:
   - **0/0/0** — systematic. v29 does not fill the field for this filer.
   - **n/n/n**, n > 0 — the cached answer is the outlier; the field is
     fillable and something about that one cached run lost it.
   - **mixed** — variance. The gate fails on reproducibility regardless of
     which run is prettiest.
4. Whether the ladder's row set, amounts and maturities are otherwise stable
   across the three — because if those move too, the problem is larger than a
   heading and Stage 4 has found something worse than it went looking for.

**Not in scope of this run:** any fix. A prompt change is a version bump and a
full re-extraction, and that is a separate decision with its own declaration.
