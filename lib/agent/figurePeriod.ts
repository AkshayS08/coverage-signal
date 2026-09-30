/**
 * RULE 71 — A CURRENT-POSITION FIGURE BELONGS TO THE PERIOD ITS OWN SENTENCE
 * PREDICATES.
 *
 * This is Rule 57 and Rule 70 generalised from the two fields they were each
 * written at to the whole class.
 *
 *   RULE 57 said a date inside a maturity clause is the maturity only where
 *   the clause PREDICATES it of maturity. A funding deadline sitting in the
 *   same sentence is not a maturity, and taking it carded a $700 million
 *   maturity twelve months early.
 *
 *   RULE 70 said a stated balance is taken at the date its own sentence
 *   predicates, with the model's `asOfDate` as ONE SIGNAL rather than the
 *   answer. Cigna's commercial paper read at the base date instead of the
 *   anchor's, and the roll missed by 965.
 *
 * Both are the same rule about two fields. Stated once, over every figure:
 *
 *     A FIGURE WHOSE SENTENCE PREDICATES A DATE OTHER THAN THE ANCHOR'S IS
 *     NOT A CURRENT-POSITION FIGURE. It does not enter the current position,
 *     it does not enter `figureSources`, and it does not enter the position
 *     identity. It is recorded as prior-period evidence, because it is real
 *     and merely as of the wrong date.
 *
 * WHAT IT COST TO NOT HAVE THIS. Cigna's re-taste 2 sourced a revolver's
 * `drawn` figure from the sentence
 *
 *   "As of December 31, 2025, there was no outstanding balance under the
 *    Credit Agreement."
 *
 * — the BASE date, six months before the anchor — and the prior-period 10-K
 * entered the position filing set through it. The other two samples read the
 * anchor's own sentence at June 30, 2026. Three samples, two position
 * identities, and a golden pinned to an identity that moves one run in three
 * is the thing Rule 65 exists to prevent.
 *
 * PREDICATION, NOT PROXIMITY — the test is Rule 57's, unchanged.
 *
 *   | the clause says                          | the date is              |
 *   |------------------------------------------|--------------------------|
 *   | "outstanding **as of** June 30, 2026"    | the figure's own period  |
 *   | "for the six months **ended** June 30…"  | the figure's own period  |
 *   | "will **mature** in April 2030"          | a maturity               |
 *   | "**entered into** … in April 2025"       | when the paper was signed|
 *   | "**funded** on or prior to …"            | when it may be funded    |
 *
 * A SENTENCE THAT PREDICATES NO PERIOD IS NOT EXCLUDED, and this is the
 * deliberate half. A facility's SIZE is a standing contractual term, not a
 * period balance: "the Company entered into a $6.5 billion, five-year
 * revolving credit agreement" states a figure that is true at the anchor
 * whether or not the sentence carries a date. Excluding it because the
 * sentence happens to mention April 2025 would delete a correct current
 * figure on a date predicated of something else — which is exactly the error
 * Rule 57 was written against, pointed the other way.
 *
 * So an ungoverned date is RECORDED and never acted on. The never-silent path
 * matters here: a figure whose sentence carries dates that none of them
 * govern is the case a future defect will hide in, and it says so.
 */
import { isoFromStatedDate } from "../events/position";

export type FigurePeriod = "anchor" | "after-anchor" | "other" | "unpredicated" | "no-anchor-date";

export interface PeriodVerdict {
  period: FigurePeriod;
  /** Dates the sentence predicates OF THE FIGURE, ISO, sorted. */
  predicated: string[];
  /** Dates present in the sentence that no period word governs. Recorded, never acted on. */
  ungoverned: string[];
  /**
   * Whether the model's own `asOfDate` agrees with the sentence. Null when the
   * model states none. Rule 70: the sentence wins either way; a disagreement
   * is logged rather than silently resolved.
   */
  modelAgrees: boolean | null;
  why: string;
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};
const MONTH_NAMES = Object.keys(MONTHS).join("|");

/**
 * A PERIOD GOVERNOR — a CLOSED set, the same shape as every other closed list
 * in this codebase. These are the words that make a date the date OF a figure
 * rather than a date merely present in its sentence.
 */
const GOVERNOR = new RegExp(
  String.raw`\b(as\s+of|as\s+at|outstanding\s+at|outstanding\s+on|balance\s+at|balances\s+at|ended|ending|end\s+of)\b`,
  "gi"
);

/**
 * A DATE PREDICATED OF SOMETHING ELSE. Rule 57's own table, as a set. When one
 * of these sits between the nearest governor and the date, the date belongs to
 * it and not to the figure.
 */
const OTHER_PREDICATE = new RegExp(
  String.raw`\b(matur\w*|due|expir\w*|dated|effective|payable|funded|fund|drawn\s+down|issued|priced|entered\s+into|enters\s+into|commenc\w*|terminat\w*|amend\w*|extend\w*|replac\w*|repaid\s+in|repay\w*\s+in)\b`,
  "gi"
);

/** A period preposition that must TOUCH the date to count. See `governed`. */
const ADJACENT_GOVERNOR = /(?:^|[\s(,])(?:at|as\s+of|as\s+at)\s*$/i;

interface Found { iso: string | null; start: number; text: string }

/** Every date token in the sentence, with where it starts. */
function dateTokens(sentence: string): Found[] {
  const out: Found[] = [];
  const full = new RegExp(String.raw`\b(${MONTH_NAMES})\s+(\d{1,2})\s*,?\s*(\d{4})\b`, "gi");
  const monthYear = new RegExp(String.raw`\b(${MONTH_NAMES})\s+(\d{4})\b`, "gi");
  const numeric = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  const taken: [number, number][] = [];
  for (const m of sentence.matchAll(full)) {
    const month = MONTHS[m[1].toLowerCase()];
    out.push({ iso: `${m[3]}-${month}-${String(Number(m[2])).padStart(2, "0")}`, start: m.index ?? 0, text: m[0] });
    taken.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  for (const m of sentence.matchAll(monthYear)) {
    const at = m.index ?? 0;
    // Skip the month-year half of a full date already captured above.
    if (taken.some(([s, e]) => at >= s && at < e)) continue;
    out.push({ iso: null, start: at, text: m[0] });
  }
  for (const m of sentence.matchAll(numeric)) {
    out.push({ iso: isoFromStatedDate(m[0]), start: m.index ?? 0, text: m[0] });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The last index at which `re` matches within `text`, or -1. */
function lastMatch(text: string, re: RegExp): number {
  let at = -1;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(r)) at = m.index ?? at;
  return at;
}

/**
 * Does a period word govern this date? The nearest governor must be nearer
 * than the nearest competing predicate — "for the six months ended June 30,
 * 2026" yes; "entered into … a five-year agreement maturing April 2030" no.
 */
function governed(sentence: string, at: number): boolean {
  // The run-up: enough to reach "for the six months ended", not so much that a
  // governor from a different clause reaches across.
  const runUp = sentence.slice(Math.max(0, at - 70), at);

  // A BARE "at" GOVERNS ONLY WHEN IT TOUCHES THE DATE. Filings write "was
  // $29.1 billion at June 30, 2026" constantly, so "at" has to be in the set —
  // but "at" is mostly NOT temporal ("at a rate of", "at par", "priced at
  // 99.5% on September 4, 2025"), and a window-based match would read that
  // last one as a period and exclude a correct issuance figure. Adjacency is
  // what separates the temporal "at" from the other three, and the word it
  // hangs off still cannot be one that predicates the date of something else.
  if (ADJACENT_GOVERNOR.test(runUp)) {
    const stem = runUp.replace(ADJACENT_GOVERNOR, "").trim();
    if (!/\b(matur\w*|expir\w*|due|payable|dated|effective|funded|priced|issued|commenc\w*)$/i.test(stem)) return true;
  }

  const g = lastMatch(runUp, GOVERNOR);
  if (g === -1) return false;
  const o = lastMatch(runUp, OTHER_PREDICATE);
  return o < g;
}

export function figurePeriodOf(
  sourceLine: string,
  anchorDate: string | null,
  modelAsOf?: string | null
): PeriodVerdict {
  const sentence = String(sourceLine ?? "").replace(/\s+/g, " ").trim();
  const tokens = dateTokens(sentence);
  const predicated: string[] = [];
  const ungoverned: string[] = [];
  for (const t of tokens) {
    if (governed(sentence, t.start)) { if (t.iso) predicated.push(t.iso); else ungoverned.push(t.text); }
    else ungoverned.push(t.iso ?? t.text);
  }
  const uniq = [...new Set(predicated)].sort();
  const modelAgrees = modelAsOf ? uniq.includes(modelAsOf) : null;

  // NO ANCHOR DATE IS NOT A FINDING ABOUT THE FIGURE. An unreadable input
  // yields "could not be checked", never an exclusion — this codebase's
  // oldest defect is an empty corpus reported as a fact about the filing.
  if (!anchorDate) {
    return { period: "no-anchor-date", predicated: uniq, ungoverned, modelAgrees,
      why: "the anchor states no period date, so no figure can be placed against it. Nothing is excluded on an input that could not be read." };
  }
  if (uniq.length === 0) {
    return { period: "unpredicated", predicated: uniq, ungoverned, modelAgrees,
      why: ungoverned.length === 0
        ? "the sentence predicates no date of this figure, so the figure carries no period claim of its own and stands as a current term"
        : `the sentence carries ${ungoverned.length} date(s) (${ungoverned.join(", ")}) that no period word governs — each belongs to a maturity, an agreement or an event, not to this figure (Rule 57)` };
  }
  if (uniq.includes(anchorDate)) {
    return { period: "anchor", predicated: uniq, ungoverned, modelAgrees,
      why: `the sentence states this figure as of ${anchorDate}, which is the anchor's own period` };
  }

  // ONLY THE STALE DIRECTION IS EXCLUDED, AND THE ASYMMETRY IS THE POINT.
  //
  // The harm this rule exists to stop is a balance at an EARLIER date rendered
  // as the current position — Cigna's revolver at December 31, 2025, UHS's
  // v20 ladder carrying the 10-K's December table. A figure stated as of a
  // date AFTER the anchor is not stale; it is fresher than the anchor, and
  // BRD 6.0 already rules that an 8-K wins where it post-dates the note. The
  // ladder acts on that ruling today: Cigna's four September 2025 tranches
  // are live rows from an 8-K, not from the anchor's table.
  //
  // MEASURED, NOT ASSUMED. A first version excluded both directions, and the
  // book-wide pass found exactly one figure it caught: UHS's $700 million
  // July 2026 Delayed Draw Term Loan, whose 8-K is dated three weeks AFTER
  // the anchor. That facility is real, committed and current, and deleting it
  // to enforce a symmetry nothing asked for is the DaVita-five-figures harm.
  if (uniq.some((d) => d > anchorDate)) {
    return { period: "after-anchor", predicated: uniq, ungoverned, modelAgrees,
      why: `the sentence states this figure as of ${uniq.join(", ")}, which post-dates the anchor's ${anchorDate}. A later disclosure is not a stale one — BRD 6.0's authority rule already prefers it — so it is kept, and its date is recorded rather than silently flattened into the anchor's` };
  }

  return { period: "other", predicated: uniq, ungoverned, modelAgrees,
    why: `the sentence states this figure as of ${uniq.join(", ")}, and the anchor's period is ${anchorDate}. A balance at an earlier date is that date's balance; rendering it as the current position states a position the anchor does not report` };
}

/** Kept in the current position? Only "other" is excluded. */
export function entersCurrentPosition(v: PeriodVerdict): boolean {
  return v.period !== "other";
}

/**
 * RULE 70's DATE, IN THE FORMS A FILING PRINTS IT.
 *
 * "2026-06-30" appears in no filing's prose. Finding the sentence that
 * predicates a figure of the anchor's period means looking for the anchor's
 * period as the filer writes it.
 */
export function dateTokensFor(iso: string): string[] {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [];
  const name = Object.keys(MONTHS).find((k) => MONTHS[k] === m[2]);
  if (!name) return [];
  const Month = name[0].toUpperCase() + name.slice(1);
  const day = String(Number(m[3]));
  return [`${Month} ${day}, ${m[1]}`, `${Month} ${day} , ${m[1]}`];
}

