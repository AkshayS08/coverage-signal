# Session 26 prompt: Demo v1 cards

Fresh session. Before anything else, read these in full:

- docs/build_log.md, the "Session 25 — 6 signed" entry
- docs/BRD.md (v1.8), especially 8.14 "The rolled position"
- docs/rules.md (Rules 1 to 75)
- docs/card_spec.md (v1.0), the spec this session builds

Standing constraints:

- **Nothing bills.** Cards render from the deterministic cache. Run preflight before any command that could reach a model, and use assertFree (Rule 75). Any spend needs a written declaration and my approval first.
- **Rules over instances.** Every fix is a rule over the data, with named examples only to show shape.
- **Read before write** (Rule 69). Read any existing file before creating or replacing it.
- **Enumerate before diagnosing** (Rule 63). List every field that can produce an output before choosing a cause.
- **Stop at each checkpoint below and report.** Commit in logical pieces. Push only after I clear the card review.

## Task 0: Live-site version check

Expose VERCEL_GIT_COMMIT_SHA on a health route. Confirm the production deployment serves the pushed SHA in one request. Report the SHA served and the SHA on main.

## Task 1: CHS date precision

CHS's 9¾% notes display 2034 where the filing prints 2034-09-15. Find where the day is lost (Rule 63). Rule: canonical date display never drops precision the filing printed. Fix it, re-derive all six names through goldenThroughLoop at $0, and report any name whose rendered dates change. Re-sign CHS once, as its own commit.

**Checkpoint 1:** report Tasks 0 and 1.

## Task 2: Inventory before building

At $0, for every element in card_spec.md sections 2 and 3, report whether the current data model already carries what it needs, and where. Specifically:

- Instrument type per row (notes, term loan A/B, revolver, ABL, CP, LCs).
- The filer's own seniority and security words per instrument, with the sentence.
- Cash as of the position date, with its sentence.
- Undrawn capacity per facility, and the borrowing-base path.
- Previous brief date per name, or how "since last week" is computed today.
- Filing dates and 8-K item numbers for filings since the previous brief.
- Scheduled amortization where stated.
- The sentence link for every displayed figure, date, and label.
- Stated-fact identity, for de-duplicating an instrument that appears in two sources (Cigna's four September 2025 notes).

For each gap, say whether it is a code change over cached answers ($0) or needs new extraction (bills). Do not build anything that needs extraction. Propose the rule for each $0 gap.

**Checkpoint 2:** report the inventory and gap list. I approve before any UI work.

## Task 3: Build the cards

Build one card per signed name per card_spec.md, from cache, at $0. Layout, display rules, and fallback wording exactly as specified. Each instrument appears once. No bare amount without its type.

## Task 4: Verify

- All six goldens reproduce through goldenThroughLoop, unchanged.
- Full offline suite green, golden suite included.
- Every figure, date, and label on every card links to a sentence that contains it. Assert this as a test over all six cards, not by inspection.
- Screenshots of all six cards, top to bottom.
- Per card, the section 6 acceptance checklist.

**Checkpoint 3:** report and stop. I review the six cards against the three demo questions before anything is pushed.
