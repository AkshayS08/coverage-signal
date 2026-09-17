import { locateLiquiditySection, LIQUIDITY_OPEN, LIQUIDITY_CLOSE } from "./liquiditySection";
/**
 * NOTE LOCATION — ONE MODULE, ONE JOB: filing text in, located and marked
 * note out.
 *
 * Everything that decides WHERE a company's debt note is, and how that
 * region is delimited for the model, lives here and nowhere else: the
 * heading finder, the fallback, the lead-window rule, the span marking, and
 * the coupon pattern's fraction handling. Callers get a located span and a
 * marked text; they never re-derive either.
 *
 * What deliberately does NOT live here: fetching and cleaning the filing
 * (filingText.ts — a different job), and the fraction-glyph table itself
 * (VULGAR_FRACTION_CLASS in verifyQuote.ts, imported — Rule 7 says one
 * table and every layer reads it, so a second copy here would be the
 * defect, not the consolidation).
 *
 * Session 20 renamed this from debtNoteLocator.ts. The rename is the
 * smaller half; see LEAD_CHARS for the part that was actually broken.
 */
/**
 * Locates the debt-schedule section within a filing's FULL stripped text,
 * so the extraction corpus can include it even when it sits well past the
 * lead-40k-char window most other triggers' facts live inside.
 *
 * Session 18 diagnosis (zero-LLM-cost, against real SEC filings fetched
 * directly): the debt note's actual position ranges from ~23k chars
 * (DaVita's 10-Q) to ~613k chars (Community Health Systems' 10-K) into the
 * document. No fixed larger cap reaches all of them without multiplying
 * every company's per-filing token cost by 10-15x — most of that extra
 * text would be unrelated financial-statement content the other 14
 * triggers don't need. A targeted locator keeps cost bounded.
 *
 * STRUCTURAL, not lexical (matching this project's "no vocabulary guards"
 * convention): rather than searching for section-heading wording (which
 * varies by company — "Long-Term Debt," "Debt and Credit Arrangements,"
 * "Notes Payable and Long-Term Debt," ...), this finds the region with the
 * highest DENSITY of coupon-rate-near-a-maturity-year patterns
 * ("N.NNN% ... due/matures ... YYYY") — the one structural signature every
 * real debt schedule shares regardless of company-specific phrasing or
 * table-to-text formatting.
 */
// Imported, not restated. This was a hand-written duplicate of
// verifyQuote.ts's own glyph table and the two had already drifted apart in
// both directions — see that table's comment.
import { VULGAR_FRACTION_CLASS } from "../agent/verifyQuote";
import { printedFigures, runIsNonDebtTable, figureIsDebtContent, type DebtContentContext, type PrintedFigure } from "./debtContent";

/**
 * Session 18 (post-v16) — THE DEBT-NOTE HEADING ASSERTION.
 *
 * A debt schedule lives inside a titled, numbered note. This asserts the
 * located span actually contains such a heading, which is an independent
 * check on the locator: coupon density can land on an interest-expense or
 * fair-value table that shares the rate-near-year signature, and neither of
 * those sits under a "N. Debt" heading.
 *
 * Shape: an optional literal "NOTE", a number, a separator, then a title
 * ending in "debt". Case-insensitive and numbering-agnostic, because real
 * filings use every style — "NOTE 5. LONG-TERM DEBT" (Tenet), "4) LONG-TERM
 * DEBT" (UHS), "8. Debt" (Centene), "Note 7 – Debt" (Cigna).
 *
 * TWO CONSTRAINTS, BOTH LOAD-BEARING, BOTH FOUND BY MEASUREMENT:
 *
 * 1. The number must be <= 30. A filing has no Note 50. Without this bound a
 *    dollar figure sitting beside the words "long-term debt" matches
 *    everything else in the pattern — measured live, an unbounded number
 *    matched "50 ) Long-term debt" in Centene, which is a table figure.
 *
 * 2. The title must be WORDS ONLY. This is the constraint the first cut
 *    lacked, and it mattered more than the number bound. With a permissive
 *    60-character title window the pattern matched right through table rows:
 *    "1) (Level 2) (Level 3) (In millions) Corporate debt securities" in
 *    Molina's fair-value note, and "2.0 1.1 0.9 Note 7 – Debt" in Cigna.
 *
 * A guard on what PRECEDES the number was tried and removed: filings place a
 * note heading immediately after the previous table's last figure, so
 * rejecting a digit before the number threw out real headings (Tenet's own
 * "NOTE 5. LONG-TERM DEBT" among them).
 *
 * KNOWN IMPRECISION, deliberately accepted. The shape "( 25 ) Total debt" —
 * a current-maturities figure followed by a subtotal caption — still
 * matches, in UHS's and CHS's real filings. It is a false positive as a
 * *heading*, but not as an *assertion*: "Total debt" as a caption is itself
 * good evidence the span is a debt schedule, which is the only question this
 * function is asked. Tightening it further (requiring the separator to bind
 * tight to the number) was measured and rejected — it also threw out Cigna's
 * spaced-dash "Note 7 – Debt".
 *
 * SESSION 20, STAGE 4 — THE TITLE-LENGTH BOUND WAS ONE WORD TOO TIGHT.
 *
 * The bound below was {0,4} leading words. UHS titles its note "(4) Treasury
 * Credit Facilities and Outstanding Debt Securities" — five words before
 * "Debt" — so it matched nothing at all, and UHS was the only company of ten
 * whose located span was not anchored to a heading. Everything downstream
 * followed from that: the span was a bare coupon cluster holding the five
 * senior-note bullets and neither the term loan above them nor the other
 * debt below, so half the capital structure was never in the text the model
 * was given.
 *
 * Measured across the ten real anchor filings before changing it: {0,5}
 * adds exactly one true heading (UHS's) and five captions that are not
 * headings at all — "4 — Interest expense and amortization of debt",
 * "5 ) Loss on early extinguishment of debt", "25. Loss from early
 * extinguishment of debt". Every one of those is an income-statement line,
 * and every one is removed by the attachment test the finder already
 * applies (tableBlockForHeading: a table must begin within
 * HEADING_TO_TABLE_CHARS below the heading). The bound moves; the guard
 * that makes a generous pattern safe does not.
 */
const MAX_NOTE_NUMBER = 30;
const DEBT_NOTE_HEADING_RE = /(?:\bnotes?\s+)?(\d{1,2})\s*([.)–—:-])\s+((?:[A-Za-z][A-Za-z-]*\s+){0,5}?debt)\b/gi;

/**
 * How far BEFORE the span start a heading may sit and still count. A cluster
 * can begin mid-table with its heading a few hundred characters above the
 * first coupon — measured: HCA's "3) Debt" sits 1,023 characters before its
 * own span start, and is unambiguously the right heading.
 */
const HEADING_LOOKBACK_CHARS = 2000;

/** The debt-note heading governing `span`, or null when the span contains none. */
export function findDebtNoteHeading(text: string, spanStart: number, spanEnd: number): { at: number; text: string } | null {
  const from = Math.max(0, spanStart - HEADING_LOOKBACK_CHARS);
  const window = text.slice(from, spanEnd);
  DEBT_NOTE_HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DEBT_NOTE_HEADING_RE.exec(window))) {
    if (Number(m[1]) > MAX_NOTE_NUMBER) continue;
    return { at: from + m.index, text: m[0].replace(/\s+/g, " ").trim() };
  }
  return null;
}

export type DebtNoteLocation =
  | { status: "found"; start: number; end: number; matchCount: number; via: "heading" | "density" | "content" }
  | { status: "not_found" };

/**
 * B1 (Session 18, post-stage-2) — THE COUPON PATTERN WAS BLIND TO FRACTIONS.
 *
 * Requiring a decimal point made a table printing `4¾%`, `6⅞%`, `10⅞%`
 * invisible to the detector. Density then clustered on the narrative
 * elsewhere in the filing — redemption discussion, which DOES spell its
 * coupons as decimals — and the excerpt handed to the model contained prose
 * about the notes instead of the note itself. Measured on CHS's real 10-Q:
 * the table sits at character 48,497 and the span this locator returned was
 * [49,227 – 51,119], starting 730 characters past it. The model was never
 * shown the table it was asked to transcribe, and produced six figures that
 * appear in no column of any CHS debt table.
 *
 * Older indentures price in eighths and this is ordinary typography, not an
 * edge case: CHS carries 16 fraction coupons in each 10-Q and 161 in its
 * 10-K.
 */

const COUPON_SRC = `(?:\\d{1,2}\\.\\d{2,4}|\\d{1,2}\\s?[${VULGAR_FRACTION_CLASS}])\\s?%`;
/** A coupon rate loosely followed by a maturity year, in either order and however far HTML-to-text stripping put whitespace between them — the one shape a debt-schedule row (or a dense cluster of them) reliably has. */
const COUPON_NEAR_YEAR_RE = new RegExp(
  `${COUPON_SRC}[\\s\\S]{0,90}?\\b(?:19|20)\\d{2}\\b|\\b(?:19|20)\\d{2}\\b[\\s\\S]{0,90}?${COUPON_SRC}`,
  "g"
);

/** Minimum matches required within a window to count as a real schedule (not a stray coupon mention + an unrelated nearby year). A genuine multi-tranche debt note has several rows; a single narrative sentence ("5.500% notes due 2032") never clusters this tightly. */
const MIN_CLUSTER_SIZE = 3;
/** How far apart two matches can be and still count as the same cluster. */
const CLUSTER_GAP_CHARS = 1500;
/** Padding added around the matched cluster span so the excerpt reads as a whole table, not a bare token stream. */
const PAD_CHARS = 400;
/** Hard ceiling on the spliced excerpt so one company's oversized note can't blow out the whole corpus. */
const MAX_EXCERPT_CHARS = 25000;

/**
 * A comma-grouped figure — the only numeric shape a real debt-balance table
 * reliably prints. Deliberately NOT bare digits: a coupon rate, a maturity
 * year and a footnote marker are all bare digits, and scoring on those would
 * measure formatting noise rather than balance size.
 */
const GROUPED_FIGURE_RE = /\d{1,3}(?:,\d{3})+/g;

/** The largest comma-grouped figure inside a span — the discriminating signal. See selectCluster. */
/**
 * SESSION 20, STAGE 2 — A DEBT NOTE IS IDENTIFIABLE BY WHAT IT CONTAINS,
 * NOT ONLY BY WHAT IT IS TITLED.
 *
 * The magnitude fallback's own doc comment states the assumption this
 * breaks: "the exact test would compare each cluster against the balance
 * sheet's own debt captions, which is not available here — those captions
 * are produced BY extraction." The captions are not available. The
 * MAGNITUDES are, and they are in the text this function already holds.
 *
 * UHS is why. Its locator has always landed on the interest-expense table,
 * which clusters MORE densely than the real note (9 coupon matches to 5) and
 * also wins on magnitude, so neither existing signal separates them. What
 * separates them is arithmetic that is already printed on the page:
 *
 *   $800 million, 2.65% Senior Notes due 2030 ... 5,357   ← interest
 *   $700 million, 1.65% Senior Notes due 2026 ... 2,931   ← interest
 *
 * Each row's amount is 0.67% of the principal named in its OWN LABEL. A
 * quarter's coupon on $800M at 2.65% is $5.3M, so the ratio is the coupon
 * rate divided by four — structurally between roughly 0.1% and 10% for any
 * real instrument. A balance, by contrast, is the principal itself or a
 * repurchased fraction of it: between roughly 20% and 105%.
 *
 * That is the decisive disqualifier and it needs no vocabulary at all. It
 * reads two numbers off one row and asks whether the second could be the
 * first. It is also the same fact Rule 15 is built on, one layer earlier:
 * an issue size in a name is a name — here it is a REFERENCE that tells us
 * what kind of table we are looking at.
 */

/** A row's own stated issue size, when its label carries one, paired with the amount printed beside it. */
/**
 * TWO BOUNDS HERE ARE LOAD-BEARING, AND BOTH WERE SET BY MEASUREMENT
 * AGAINST THE REAL TEN.
 *
 * `[\s\S]` rather than `[^\n]`: stripped filing text keeps newlines between
 * a row's issue size and its coupon, and the first cut of this pattern
 * matched nothing at all on the real UHS filing while matching perfectly on
 * the same text with its whitespace collapsed. A pattern that only works on
 * prettified input is not a pattern.
 *
 * The gap after the maturity year is TIGHT (12 characters, enough for " $ ")
 * because loosening it turns prose into a false row. CHS's note contains
 * sentences of the form "$750 million aggregate principal amount of 10.875%
 * Senior Notes due 2032" followed some distance later by an unrelated
 * figure; at a 40-character gap those matched and dragged CHS's real note to
 * a median 9.51% — a schedule misread as an interest table. A balance is
 * printed ON its row, immediately after the label. A sentence is not a row.
 */
const ISSUE_SIZE_ROW_RE = new RegExp(
  String.raw`\$\s?([\d,.]+)\s*(thousand|million|billion)[\s\S]{0,90}?` +
    COUPON_SRC +
    String.raw`[\s\S]{0,80}?\b(?:19|20)\d{2}\b[^\d]{0,12}(\d{1,3}(?:,\d{3})+|\d{1,4})`,
  "gi"
);

const MAGNITUDE_AMOUNT_RE = /\$\s?([\d,.]+)\s*(thousand|million|billion)/gi;

const MAGNITUDE: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9 };

/**
 * The fraction of its own stated issue size that each row's amount
 * represents, with WHERE it was found. A schedule's rows are balances (~0.2
 * to ~1.05); an interest table's are periodic coupon (~0.001 to ~0.10).
 *
 * Positions are kept because the ratio test is only meaningful on a TABLE.
 * See classifySpanByContent's tabular precondition — applied to prose it
 * produces exactly the wrong answer, and UHS is the case that proves it.
 */
export function issueSizeRatiosAt(region: string): { ratio: number; at: number }[] {
  const out: { ratio: number; at: number }[] = [];
  for (const m of region.matchAll(ISSUE_SIZE_ROW_RE)) {
    const size = Number(m[1].replace(/,/g, "")) * (MAGNITUDE[m[2].toLowerCase()] ?? 1);
    const amount = Number(m[3].replace(/,/g, ""));
    if (!Number.isFinite(size) || !Number.isFinite(amount) || size <= 0 || amount <= 0) continue;
    // THE AMOUNT'S SCALE IS NOT PRINTED ON THE ROW. A table stated in
    // millions prints "1,067" for $1,067M, and the issue size beside it is
    // written out in full ("$2,500 million"). So the raw quotient is
    // meaningless and has to be put on a common scale.
    //
    // The scale is recoverable without being told, from one fact: AN AMOUNT
    // CANNOT EXCEED THE PRINCIPAL ITS OWN LABEL NAMES. Every plausible scale
    // is a power of a thousand, so the correct one is the LARGEST that keeps
    // the ratio at or under unity (1.05 leaves room for premium and
    // rounding). Scaling past that would claim a tranche carries more than
    // it was issued at.
    //
    //   Centene  1,067 against $2,500 million → 4.3e-7 → 4.3e-4 → 0.427  (a balance)
    //   UHS      5,357 against $800 million   → 6.7e-6 → 6.7e-3         (a quarter's coupon)
    let r = amount / size;
    while (r * 1000 <= 1.05) r *= 1000;
    out.push({ ratio: r, at: m.index ?? 0 });
  }
  return out;
}

/** Kept for callers that only want the ratios. */
export function issueSizeRatios(region: string): number[] {
  return issueSizeRatiosAt(region).map((r) => r.ratio);
}

/** Below this, a row's amount cannot be the balance of the instrument its own label names. Set at the top of the coupon band, well clear of the balance band's floor. */
const MAX_COUPON_RATIO = 0.12;
/** At least this many issue-size rows before the ratio is allowed to decide anything. Two rows agreeing is a coincidence; three is a table. */
const MIN_RATIO_ROWS = 3;
/**
 * A TABLE'S ROWS ARE ADJACENT; PROSE'S ARE PARAGRAPHS APART.
 *
 * This precondition is the one that stops the disqualifier eating the very
 * note it exists to find. UHS's real disclosure is a bulleted narrative —
 * "$700 million of aggregate principal amount of 1.65% senior secured notes
 * due in September, 2026 ... which were issued on August 24, 2021" — where
 * the number following the maturity year is not a balance at all. Read as
 * rows, those bullets produced ratios of 0.29% and were disqualified as an
 * interest table, which is the exact opposite of the truth.
 *
 * Measured on the real ten: interest-table and schedule rows sit ~60–90
 * characters apart; UHS's bullets sit ~250+ apart. The bound is set between
 * them with room, and a span that fails it is UNDECIDED, never disqualified.
 */
const MAX_TABULAR_ROW_GAP = 160;

export type SpanVerdict =
  | { kind: "schedule"; reason: string }
  | { kind: "not-a-schedule"; reason: string }
  | { kind: "undecided"; reason: string };

/** Every "$N million/billion/thousand" amount in a region, in dollars. */
export function magnitudeAmounts(region: string): number[] {
  const out: number[] = [];
  for (const m of region.matchAll(MAGNITUDE_AMOUNT_RE)) {
    const v = Number(m[1].replace(/,/g, "")) * (MAGNITUDE[m[2].toLowerCase()] ?? 1);
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

/**
 * THE QUALIFIER: does one figure in this span equal the sum of several
 * others in it?
 *
 * A debt disclosure states its parts and their total. That is true of a
 * table and equally true of a narrative — UHS writes "aggregate principal of
 * $3.0 billion from the following senior secured notes:" and then bullets
 * $700M, $500M, $800M, $500M, $500M, which sum to exactly $3.0 billion.
 *
 * This is what lets a PROSE note be recognised at all. Magnitude never can:
 * maxGroupedFigure only sees comma-grouped digits, and UHS's bullets contain
 * none, so the real note scores zero against an interest table's 44,358.
 *
 * Purely arithmetic — no caption, no vocabulary. The tolerance is 2%,
 * because a filing rounds its own aggregate ("$3.0 billion" for $3,000M is
 * exact, but "$1.4 billion" for $1,448M is not).
 */
export function sumsTowardATotal(region: string): { ok: boolean; total: number; parts: number } {
  const amounts = magnitudeAmounts(region);
  for (let i = 0; i < amounts.length; i++) {
    const total = amounts[i];
    const rest = amounts.filter((_, j) => j !== i);
    // Greedy: take the largest others first, stopping once they reach the
    // candidate total. A real parts-list reaches it in a handful of terms.
    const sorted = [...rest].sort((a, b) => b - a).filter((v) => v <= total);
    let sum = 0;
    let used = 0;
    for (const v of sorted) {
      if (sum + v > total * 1.02) continue;
      sum += v;
      used++;
      if (Math.abs(sum - total) <= total * 0.02 && used >= 3) return { ok: true, total, parts: used };
    }
  }
  return { ok: false, total: 0, parts: 0 };
}

/**
 * Classifies a candidate span by what its numbers ARE.
 *
 * Order matters and is the whole design: DISQUALIFY, then QUALIFY, then
 * abstain. An interest table can also sum toward its own expense total, so
 * the qualifier alone does not separate it from a schedule — the ratio test
 * has to remove it first. And a span the tests cannot judge returns
 * `undecided` rather than guessing, which leaves the existing magnitude rule
 * in charge and is why most of the book is unaffected.
 */
export function classifySpanByContent(region: string): SpanVerdict {
  const rows = issueSizeRatiosAt(region);
  const pct = (r: number) => `${(r * 100).toFixed(2)}%`;

  if (rows.length >= MIN_RATIO_ROWS) {
    const gaps: number[] = [];
    for (let i = 1; i < rows.length; i++) gaps.push(rows[i].at - rows[i - 1].at);
    const medianGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? Infinity;
    if (medianGap <= MAX_TABULAR_ROW_GAP) {
      const sorted = rows.map((r) => r.ratio).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median <= MAX_COUPON_RATIO) {
        return {
          kind: "not-a-schedule",
          reason: `${rows.length} tabular rows (median gap ${medianGap}ch) state an issue size and their amounts are a median ${pct(median)} of it — a periodic coupon, not a balance`,
        };
      }
      return {
        kind: "schedule",
        reason: `${rows.length} tabular rows state an issue size and their amounts are a median ${pct(median)} of it — balances`,
      };
    }
  }

  const sum = sumsTowardATotal(region);
  if (sum.ok) {
    const b = (n: number) => `$${(n / 1e9).toFixed(2)}B`;
    return { kind: "schedule", reason: `${sum.parts} stated amounts sum to ${b(sum.total)}, a figure the span also states — a parts list with its own total` };
  }

  return { kind: "undecided", reason: `no tabular issue-size rows and no amounts summing to a stated total; the content test abstains` };
}

function maxGroupedFigure(text: string, start: number, end: number): number {
  let max = 0;
  for (const raw of text.slice(start, end).match(GROUPED_FIGURE_RE) ?? []) {
    const n = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * B3 (Session 18, post-stage-2) — ASSERT A TABLE, NOT A HEADING.
 *
 * The heading assertion added last session proved only that a debt note's
 * heading sat near the chosen span. CHS's span passed it while containing
 * no table at all: the heading was 730 characters above the span start, the
 * table was under the heading, and the span held the prose that followed.
 * "The right note" and "the table inside it" are different claims and only
 * the second one is worth anything to extraction.
 *
 * A span qualifies on either shape a real debt disclosure takes, because
 * the two are genuinely different and both are legitimate:
 *   - ITEMIZED: several coupon-near-year rows (the multi-tranche ladder).
 *   - AGGREGATE: a stated total, for a filing that reports debt as category
 *     rollups with no per-tranche coupons at all. HCA is exactly this shape
 *     across both its 10-Q and its 10-K, and requiring coupon rows would
 *     throw out a real, correct, complete disclosure.
 */
const STATED_TOTAL_RE = /\btotal\b(?:\s+[A-Za-z-]+){0,3}\s+debt\b[^A-Za-z0-9]{0,20}\$?\s*\d[\d,]*/i;

export interface TableAssertion {
  ok: boolean;
  couponRows: number;
  hasStatedTotal: boolean;
  /** First and last offsets WITHIN the region at which table content was seen. −1 when there is none. */
  firstContentAt: number;
  lastContentAt: number;
}

/** Every offset in `region` carrying table content — a coupon-near-year row, or a stated debt total. */
function contentSpansIn(region: string): { spans: { start: number; end: number }[]; couponRows: number; hasStatedTotal: boolean } {
  const spans: { start: number; end: number }[] = [];
  const re = new RegExp(COUPON_NEAR_YEAR_RE.source, "g");
  let couponRows = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region))) {
    couponRows++;
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  const totalMatch = region.match(STATED_TOTAL_RE);
  const hasStatedTotal = totalMatch !== null && totalMatch.index !== undefined;
  if (totalMatch && totalMatch.index !== undefined) {
    spans.push({ start: totalMatch.index, end: totalMatch.index + totalMatch[0].length });
  }
  spans.sort((a, b) => a.start - b.start);
  return { spans, couponRows, hasStatedTotal };
}

export function assertSpanContainsTable(text: string, start: number, end: number): TableAssertion {
  const { spans, couponRows, hasStatedTotal } = contentSpansIn(text.slice(start, end));
  return {
    ok: couponRows >= MIN_CLUSTER_SIZE || hasStatedTotal,
    couponRows,
    hasStatedTotal,
    firstContentAt: spans.length > 0 ? spans[0].start : -1,
    lastContentAt: spans.length > 0 ? Math.max(...spans.map((s) => s.end)) : -1,
  };
}

/**
 * B2 (Session 18, post-stage-2) — HEADING FIRST, DENSITY AS FALLBACK.
 *
 * The debt note announces itself in plain text a few hundred characters
 * before its table. Until now that heading was used only to AUDIT the span
 * density had already chosen, never to find it — which is backwards, and
 * CHS is the case that shows why: density selected prose sitting inside the
 * correct note while the table under the same heading was never spliced.
 *
 * Deferred once before on the grounds that density was correct where it
 * mattered. It no longer is, and the failure mode is silent.
 *
 * Every heading in the document is considered, not just the first: a 10-K
 * lists "Debt" in its own table of contents and cross-references it from
 * MD&A, and neither of those blocks contains a table — so they fail the B3
 * assertion and fall away without needing a special case. Where more than
 * one heading DOES carry a table, magnitude picks between them, the same
 * discriminator density selection already uses.
 */
const HEADING_BLOCK_SCAN_CHARS = 20000;
/** Small lead-in so the block opens ON the heading, which the model then sees naming the note it is reading. */
const HEADING_LEAD_CHARS = 200;
/**
 * How far the table may sit below its own heading. THE load-bearing bound of
 * the heading path, and the one that separates a real note heading from the
 * things that merely look like one.
 *
 * DEBT_NOTE_HEADING_RE was written as an ASSERTION, where a false positive
 * costs nothing — its own doc comment says so. As a FINDER it is far too
 * generous: measured across the 10 real base filings it matched the cash
 * flow statement's own captions ("02 ) Proceeds from debt", "1 ) Amortization
 * of debt", "0 — Principal payments on debt", where the leading digits are
 * table figures) and an MD&A risk heading ("26. We have significant debt").
 * HCA's base filing selected that last one and contained NONE of HCA's eight
 * verified entries — a regression, caught before shipping by measuring
 * against the rows themselves rather than trusting the heading.
 *
 * The discriminator is attachment, not vocabulary: a debt note's table
 * begins within a few hundred characters of the heading that announces it,
 * while a caption or a risk paragraph has whatever happens to follow it
 * further down the document. Structural, and it needs no list of forbidden
 * words.
 */
const HEADING_TO_TABLE_CHARS = 1200;

/** A matched debt-note heading, with the numbering it announces itself in — the number and separator are what locate its SIBLING, and so the note's own end. */
interface DebtNoteHeading {
  at: number;
  number: number;
  separator: string;
}

function findAllDebtNoteHeadings(text: string): DebtNoteHeading[] {
  const re = new RegExp(DEBT_NOTE_HEADING_RE.source, "gi");
  const found: DebtNoteHeading[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1];
    const n = Number(raw);
    // A note number is 1..MAX_NOTE_NUMBER and is never zero-padded. Both
    // rejections are real: "02 )" and "0 —" are cash-flow table figures that
    // happen to precede a caption ending in "debt", not note numbers.
    if (n >= 1 && n <= MAX_NOTE_NUMBER && !/^0/.test(raw)) found.push({ at: m.index, number: n, separator: m[2] });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return found;
}

/**
 * SESSION 20, STAGE 4 — THE SPAN IS THE NOTE, NOT THE TABLE INSIDE IT.
 *
 * Every rule above this one asks "where is the debt TABLE", and every one of
 * them ends the span where the table's own content stops being contiguous.
 * That was right when a ladder was a table and nothing else counted. It is
 * wrong now: a debt note routinely states half its capital structure in
 * sentences ON EITHER SIDE of its table, and those sentences carry no
 * coupon-near-year signature at all, so no contiguity rule can ever reach
 * them.
 *
 * Measured on the ten real anchor filings, the located spans were carrying
 * roughly a third of their notes:
 *
 *   Encompass    981 chars of a 4,298-char note      Molina  941 of 3,417
 *   Centene    1,328 of 2,828                        Tenet 1,294 of 2,441
 *   DaVita     3,409 of 7,510                        CHS   2,863 of 8,139
 *   UHS        3,210 of 13,398 — and the 3,210 held neither the term loan
 *              above the bullets nor the other debt below them
 *
 * A NOTE'S OWN BOUNDARY IS PRINTED ON THE PAGE. Filings number their notes,
 * and note N ends where note N+1 begins. The numbering style does not have
 * to be guessed either — the heading we already matched states it, so the
 * successor is that number plus one in that same style. No vocabulary, no
 * threshold, and it reads the document the way a person does.
 *
 * PURELY ADDITIVE, BY CONSTRUCTION. This only ever widens: the start moves
 * back to the heading if the span did not already reach it, and the end
 * moves forward to the sibling if the sibling sits beyond it. A filing whose
 * sibling heading lands INSIDE the chosen span (HCA's does, at 34,288
 * against a span ending at 34,562) keeps its span untouched, because losing
 * located table text to a boundary rule would be a regression and the rule
 * has nothing to say about text already known to be part of the schedule.
 */
function nextSiblingHeadingAt(text: string, heading: DebtNoteHeading): number | null {
  const sep = heading.separator.replace(/[.*+?^${}()|[\]\\/-]/g, (c) => "\\" + c);
  const re = new RegExp(String.raw`(?:\bNotes?\s+)?\b` + (heading.number + 1) + String.raw`\s*` + sep + String.raw`\s+[A-Z]`, "g");
  // Start past the heading itself so a heading whose own title contains the
  // successor's number cannot match itself.
  re.lastIndex = heading.at + 1;
  const m = re.exec(text);
  return m ? m.index : null;
}

/** Widens a located span to the bounds of the note it sits in. Never contracts it; never crosses MAX_EXCERPT_CHARS. */

/**
 * SESSION 21 — A DEBT-NOTE SPAN ENDS BEFORE THE FIRST TABLE THAT CARRIES NO
 * DEBT CONTENT.
 *
 * The note-boundary rule (expandToNoteBounds) runs a span from its heading to
 * the next note's heading, which is the right unit for a note and too
 * generous for a DEBT note when the filer files a combined one. UHS titles
 * its note "(4) Treasury Credit Facilities and Outstanding Debt Securities",
 * so under that boundary its span carries 3,800 characters of foreign-
 * currency-contract and cash-reconciliation tables after the debt
 * disclosure ends.
 *
 * That is two defects, not one. It is a MEASUREMENT CONTAMINANT — every one
 * of the 13 comma-grouped figures in UHS's span belongs to those two tables,
 * which is why three separate attempts to measure "is this span tabular"
 * placed a prose-only note firmly inside the tabular band. And it is a
 * FABRICATION SURFACE: the model is handed cash and hedge figures inside a
 * region labelled as the debt note and asked to transcribe debt from it.
 *
 * THE CUT IS STRUCTURAL AND CANNOT REACH A REAL DEBT TABLE. It fires only on
 * a run of comma-grouped figures that begins more than a cluster gap after
 * the LAST DEBT CONTENT in the span — where debt content is the same
 * coupon-near-year and stated-total signal contentSpansIn already defines. A
 * real debt table carries debt content by construction, so it is never more
 * than a cluster gap from it and can never trigger the cut.
 *
 * Molina is the caution this is written against: a debt-content-only framing
 * truncated its window to 541 of 3,417 characters and would have cut its
 * real table. This rule cuts nothing there, because its table IS the debt
 * content.
 */
/** At least this many comma-grouped figures, tightly spaced, to count as a table rather than a stray figure in a sentence. */
const FOREIGN_TABLE_MIN_FIGURES = 3;
/** How close consecutive grouped figures sit inside one table. Measured on the real ten: 11-46 characters apart within a table. */
const FOREIGN_TABLE_ROW_GAP = 160;

export function narrowToDebtDisclosure(
  text: string,
  span: { start: number; end: number },
  xbrlStatedTotal: number | null = null
): { end: number; cutAt: number | null; reason: string | null } {
  const region = text.slice(span.start, span.end);
  const { spans } = contentSpansIn(region);
  if (spans.length === 0) return { end: span.end, cutAt: null, reason: null };
  const lastCoupon = Math.max(...spans.map((c) => c.end));

  const figs = printedFigures(region);
  if (figs.length === 0) return { end: span.end, cutAt: null, reason: null };

  // Everything printed at or before the last coupon-near-maturity match is
  // the note's established debt disclosure. Its figures become the
  // known-debt set, so the same balance restated later in prose is
  // recognised rather than cut.
  const ctx: DebtContentContext = {
    xbrlStatedTotal,
    knownDebtFigures: new Set(figs.filter((f) => f.at <= lastCoupon).map((f) => f.value)),
    couponSites: spans.map((c) => c.start),
  };

  // Walk forward through the figures that follow the debt disclosure,
  // grouping adjacent ones into runs, and cut at the first run that is a
  // non-debt table by the definition in debtContent.ts.
  const after = figs.filter((f) => f.at > lastCoupon);
  let run: PrintedFigure[] = [];
  const consider = (r: PrintedFigure[]): { end: number; cutAt: number | null; reason: string | null } | null => {
    if (r.length < FOREIGN_TABLE_MIN_FIGURES) return null;
    const verdict = runIsNonDebtTable(r, ctx);
    if (!verdict.nonDebt) return null;
    return {
      end: span.start + r[0].at,
      cutAt: span.start + r[0].at,
      reason:
        `a run of ${r.length} figures past the debt disclosure, none of which relates to this filer's debt — ` +
        (verdict.sumsTo !== null
          ? `they close on their own subtotal of ${verdict.sumsTo.toLocaleString("en-US")}, which is not the stated total debt`
          : `no coupon beside any of them, no match to the stated total at any scale, and none restated from the note's own debt disclosure`),
    };
  };
  // A RUN BREAKS ON DEBT CONTENT, NOT ON DISTANCE.
  //
  // Grouping by proximity merged the sentence "the average outstanding
  // borrowings under our revolving credit, term loan B and senior notes were
  // approximately $ 5.4 billion" — which relates to debt principal and is
  // debt content — into the hedge table 91 characters after it, and one debt
  // figure in the run made the whole run debt. A run is a maximal sequence
  // of figures NONE of which passes a positive test, which is the
  // definition, stated directly.
  for (const f of after) {
    if (figureIsDebtContent(f, ctx).debt) {
      const cut = consider(run);
      if (cut) return cut;
      run = [];
      continue;
    }
    run.push(f);
  }
  return consider(run) ?? { end: span.end, cutAt: null, reason: null };
}

/**
 * SESSION 21 — IS THIS NOTE'S DEBT DISCLOSURE A TABLE, OR PROSE?
 *
 * Measured on the NARROWED span, which is the whole point: on the raw span
 * this question could not be answered, because the contaminating tables
 * carried every grouped figure UHS had.
 *
 * A debt table prints balances as comma-grouped figures, row after row. A
 * prose disclosure prints principal in words — "$700 million of aggregate
 * principal amount of 1.65 % senior secured notes" — and carries none.
 */
export function spanIsTabular(text: string, start: number, end: number): { tabular: boolean; groupedFigures: number } {
  const groupedFigures = (text.slice(start, end).match(GROUPED_FIGURE_RE) ?? []).length;
  // THE THRESHOLD IS ZERO, AND THAT IS THE WHOLE DESIGN.
  //
  // Withdrawing the schedule field is a strong act, so it needs an
  // unambiguous reading: the debt disclosure prints NO comma-grouped figure
  // anywhere, so it structurally cannot be a table of balances. A sparse
  // reading is not enough.
  //
  // Molina is why. Its note prints instruments in words too — "4.375% Notes
  // due June 15, 2028 ($800 million)" — and carries exactly one grouped
  // figure, its 3,769 subtotal. At a threshold of three it reads prose-only
  // and loses the schedule field, and with it Check 1 has nothing to walk on
  // a company currently passing at 101% and 0.00% residual. At zero it keeps
  // both fields and today's behaviour, and the per-source rule sorts it.
  //
  // NAMED COST, ACCEPTED: a future prose-only filer that happens to print
  // one stray grouped figure keeps a field it cannot use, and routing
  // variance is possible for that filer. That is the better trade than
  // silently disabling a passing check, and it is the same asymmetry the
  // redemption gates take — act on certainty, abstain on ambiguity.
  return { tabular: groupedFigures > 0, groupedFigures };
}

export function expandToNoteBounds(text: string, span: { start: number; end: number }): { start: number; end: number; expanded: boolean } {
  // CONTAINMENT, NOT DISTANCE. The governing heading is the nearest one at
  // or before the span whose OWN SIBLING sits at or after the span start —
  // which is precisely what "the span is inside note N" means, and needs no
  // lookback constant to say it.
  //
  // A distance bound was tried first and it failed on the one company this
  // whole rule exists for: HEADING_LOOKBACK_CHARS is 2,000, UHS's heading
  // sits 3,344 characters above its span, and the expansion silently did
  // nothing. Widening the constant would have fixed UHS and told the next
  // filing nothing. Containment is the test that was meant all along.
  //
  // TWO GUARDS, AND BOTH WERE FOUND BY MEASURING. Containment alone picks
  // the WRONG heading badly: DEBT_NOTE_HEADING_RE also matches cash-flow and
  // income-statement captions ("17 ) Debt", "2 ) Deferred financing costs
  // and other debt"), those captions have no successor heading anywhere, so
  // an "is it still open" test declares them open forever and they swallow
  // the document — measured, four of ten companies expanded to the 25,000
  // character ceiling and lost their notes entirely.
  //
  //   1. The heading must have a SCHEDULE ATTACHED — the same
  //      tableBlockForHeading test the finder already uses to tell a note
  //      heading from a caption. A caption governs nothing.
  //   2. Its sibling must actually be PRINTED. The rule reads a boundary off
  //      the page; where the page prints no boundary there is nothing to
  //      read, and the span stands as selected.
  const headings = findAllDebtNoteHeadings(text);
  let governing: DebtNoteHeading | null = null;
  let governingSibling: number | null = null;
  //
  // The heading must also OPEN the span rather than sit somewhere inside it.
  // Every heading-path span is constructed as heading − HEADING_LEAD_CHARS,
  // so that bound is the exact window an opening heading occupies; a match
  // further in is one of the nested subtotal captions the selection loop
  // already documents ("15 ) Debt" inside Quest's own note), and letting one
  // of those govern would read the boundary of a note that does not exist.
  const opensSpanBy = span.start + HEADING_LEAD_CHARS;
  for (const h of headings) {
    if (h.at > opensSpanBy) break;
    const sib = nextSiblingHeadingAt(text, h);
    if (sib === null || sib < span.start) continue; // no printed boundary, or note N closed before the span began
    // A caption, not a note heading. The test is the SAME table assertion
    // the finder uses, but scanned over the whole note rather than the
    // 1,200 characters below the heading: UHS opens its debt note with
    // 3,344 characters of credit-agreement prose before the first coupon,
    // and the attachment bound — correct for choosing a table — rejects the
    // heading of the very note that table is in.
    if (!assertSpanContainsTable(text, h.at, sib).ok) continue;
    governing = h;
    governingSibling = sib;
  }
  if (!governing) return { ...span, expanded: false };

  const start = Math.min(span.start, Math.max(0, governing.at - HEADING_LEAD_CHARS));
  const end = Math.min(Math.max(span.end, governingSibling ?? span.end), start + MAX_EXCERPT_CHARS, text.length);
  return { start, end, expanded: start !== span.start || end !== span.end };
}

/** The table block under one heading, or null when that heading has no table attached beneath it (a contents entry, a cash-flow caption, a risk paragraph). */
function tableBlockForHeading(text: string, headingAt: number): { start: number; end: number; matchCount: number } | null {
  const scanEnd = Math.min(text.length, headingAt + HEADING_BLOCK_SCAN_CHARS);
  const region = text.slice(headingAt, scanEnd);
  const { spans } = contentSpansIn(region);
  if (spans.length === 0) return null;
  if (spans[0].start > HEADING_TO_TABLE_CHARS) return null; // heading is not attached to a table

  // Extend through the table only while its content stays contiguous, so the
  // block ends at the table's real end rather than at a fixed distance that
  // would swallow whatever prose follows.
  let last = spans[0];
  const run: { start: number; end: number }[] = [spans[0]];
  for (const s of spans.slice(1)) {
    if (s.start - last.end > CLUSTER_GAP_CHARS) break;
    last = s;
    run.push(s);
  }
  const { couponRows, hasStatedTotal } = contentSpansIn(region.slice(0, last.end));
  if (couponRows < MIN_CLUSTER_SIZE && !hasStatedTotal) return null;

  const start = Math.max(0, headingAt - HEADING_LEAD_CHARS);
  const rawEnd = Math.min(text.length, headingAt + last.end + PAD_CHARS);
  return { start, end: Math.min(rawEnd, start + MAX_EXCERPT_CHARS), matchCount: couponRows };
}

function findMatches(text: string): number[] {
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  COUPON_NEAR_YEAR_RE.lastIndex = 0;
  while ((m = COUPON_NEAR_YEAR_RE.exec(text))) {
    positions.push(m.index);
    // Avoid pathological zero-width-adjacent re-matching; the pattern always consumes >0 chars so this is just a safety floor.
    if (COUPON_NEAR_YEAR_RE.lastIndex === m.index) COUPON_NEAR_YEAR_RE.lastIndex++;
  }
  return positions;
}

/** Groups sorted match positions into clusters where consecutive positions are within CLUSTER_GAP_CHARS of each other. */
function clusterPositions(positions: number[]): number[][] {
  if (positions.length === 0) return [];
  const clusters: number[][] = [[positions[0]]];
  for (let i = 1; i < positions.length; i++) {
    const last = clusters[clusters.length - 1];
    if (positions[i] - last[last.length - 1] <= CLUSTER_GAP_CHARS) {
      last.push(positions[i]);
    } else {
      clusters.push([positions[i]]);
    }
  }
  return clusters;
}

/**
 * Finds the densest coupon-near-year cluster in `text` and returns its span,
 * or `not_found` if nothing clusters tightly enough to be a real schedule
 * (a real miss — never silently guessed at, never falls back to a
 * heading-word search this project's own conventions rule out).
 */
export function locateDebtNoteSection(text: string): DebtNoteLocation {
  // B2 — HEADING FIRST. A heading whose block actually carries a table wins
  // outright; magnitude only breaks ties BETWEEN qualifying headings, never
  // between a heading block and a stretch of prose somewhere else.
  //
  // NESTED CAPTIONS ARE NOT HEADINGS. Every false positive measured across
  // the 10 real base filings has the same shape: a subtotal caption INSIDE
  // the note's own table, whose leading digits are a table figure —
  // "30 ) Total long-term debt" (Quest, 814 chars below its real "7. DEBT"),
  // "25 ) Total debt" (UHS), "17 ) Total debt" and "16 ) Total long-term
  // debt" (CHS), "6 ) Long-term debt" (Encompass). Quest selected one of
  // these and its span contained none of Quest's 16 verified entries.
  //
  // A note heading PRECEDES its own table, so anything matching inside a
  // block already claimed by an earlier heading is a caption within that
  // table, not a competing note. Dropping the nested ones needs no list of
  // caption words and no tightening of the heading pattern itself — which
  // was measured and rejected before, because it also throws out real
  // headings.
  // A note's own body can also be INTERRUPTED — a paragraph of prose between
  // two halves of the same disclosure — and the contiguity bound above ends
  // the block at that break. The caption that then follows looks disjoint
  // while being the same note continuing. Quest is the measured case: its
  // real "7. DEBT" block ends at 41,208, "15 ) Debt" sits 804 characters
  // later, and because that continuation happens to carry a larger grouped
  // figure (5,710 against 5,671) magnitude selected the fragment over the
  // note that contains it — a span holding none of Quest's 16 verified
  // entries. A candidate landing within one cluster gap of a kept block
  // EXTENDS it rather than competing with it.
  const headingCandidates: { at: number; block: { start: number; end: number; matchCount: number } }[] = [];
  for (const { at } of findAllDebtNoteHeadings(text)) {
    const host = headingCandidates.find((k) => at >= k.block.start && at <= k.block.end + CLUSTER_GAP_CHARS);
    const block = tableBlockForHeading(text, at);
    if (host) {
      if (block && block.end > host.block.end) {
        host.block = { ...host.block, end: Math.min(block.end, host.block.start + MAX_EXCERPT_CHARS) };
      }
      continue;
    }
    if (block) headingCandidates.push({ at, block });
  }
  const headingBlocks = headingCandidates.map((c) => c.block);
  if (headingBlocks.length > 0) {
    let best = headingBlocks[0];
    let bestMagnitude = maxGroupedFigure(text, best.start, best.end);
    for (const b of headingBlocks.slice(1)) {
      const magnitude = maxGroupedFigure(text, b.start, b.end);
      if (magnitude > bestMagnitude) {
        best = b;
        bestMagnitude = magnitude;
      }
    }
    const bounds = expandToNoteBounds(text, best);
    return { status: "found", start: bounds.start, end: bounds.end, matchCount: best.matchCount, via: "heading" };
  }

  const positions = findMatches(text);
  const clusters = clusterPositions(positions).filter((c) => c.length >= MIN_CLUSTER_SIZE);
  if (clusters.length === 0) return { status: "not_found" };

  // SELECTION IS BY MAGNITUDE, NOT DENSITY (Session 18, post-v15).
  //
  // The original rule took the cluster with the most matches. That
  // assumption was falsified and the falsifying evidence is worth keeping:
  // an INTEREST-EXPENSE-BY-INSTRUMENT table names the same instruments with
  // the same coupon-near-year signature and routinely clusters MORE densely
  // than the real debt-balance table (UHS: 9 matches vs 5). Coupon density
  // is the wrong signal for telling those two table types apart, not a
  // miscalibrated one — no threshold on cluster size separates them.
  //
  // Magnitude does, because it measures the thing that actually differs: a
  // debt-balance table's figures are the same order as the balance sheet's
  // own debt captions, while an interest-expense table's are two to three
  // orders smaller (UHS 10-K: real table max 4,768,261 vs interest-expense
  // max 212,054). Scored on the span this function will actually RETURN, so
  // the score describes the excerpt the model is really handed.
  //
  // WHAT THIS IS AND ISN'T. It is a proxy. The exact test would compare each
  // cluster against the balance sheet's own debt captions, which is not
  // available here — those captions are produced BY extraction, which runs
  // after this locator has already chosen the excerpt. Two earlier proxies
  // for the same idea were measured and rejected: cluster MEDIAN magnitude
  // and document-p95 ratio both fail to separate HCA's correct table (ratio
  // 0.049) from UHS's wrong one (0.013). Cluster MAX was itself rejected
  // once, on a base-filing set where it selected a stray "250,000,000" in
  // HCA's 10-K; every company's base filing is now a 10-Q and that stray is
  // no longer in the scored span.
  //
  // That last sentence is the risk this rule carries: its correctness was
  // established against one snapshot of base filings, and a new 10-K
  // becoming someone's base could reintroduce exactly the stray-figure case
  // that sank it before. So the choice is PINNED PER COMPANY in
  // noteLocation.test.ts — every one of the 10 has its expected offset
  // asserted against its real cached filing, and a future filing that makes
  // this rule reselect fails the suite loudly instead of quietly changing
  // which table gets extracted. Do not relax those assertions to make a new
  // filing pass; re-measure and decide deliberately, the way this rule was
  // decided.
  //
  // KNOWN LIMITATION, LOGGED AND NOT FIXED (Session 18, post-v16).
  // Magnitude tie-breaking picks a FAIR-VALUE disclosure over the carrying-
  // amount schedule whenever both are candidates, because fair value
  // systematically equals or exceeds carrying amount. Measured on Molina's
  // 10-Q: the fair-value note's largest figure is 3,951 against the real debt
  // table's 3,769, so this rule prefers the wrong one by 182. Molina still
  // reconciles today only because its real note (char 37,661) falls inside
  // the 40,000-character lead window every filing gets regardless of the
  // locator — i.e. the lead window is masking this, not the locator being
  // right. The exposure is any debt note sitting BEYOND the lead window next
  // to a fair-value disclosure; Molina's own 10-K is exactly that shape (real
  // note 301,386 vs this rule's pick 319,999) and becomes the base filing the
  // moment it is the newest filing carrying a schedule. findDebtNoteHeading
  // below is what currently notices: it returns null for both Molina 10-Qs,
  // and that is pinned in noteLocation.test.ts [14].
  //
  // Measured effect at adoption (all 10 real base filings, zero API cost):
  // corrects DaVita (interest-rate-cap table -> real note, max 3,500,000 ->
  // 10,847,516) and CHS (ABL prose with no grouped figure at all -> real
  // note, 0 -> 10,396); identical choice on the other eight. UHS and Cigna
  // are NOT fixed by it — both wrong tables also win on magnitude — and
  // remain known misses.
  const spanOf = (c: number[]) => {
    const start = Math.max(0, c[0] - PAD_CHARS);
    const rawEnd = Math.min(text.length, c[c.length - 1] + PAD_CHARS);
    return { start, end: Math.min(rawEnd, start + MAX_EXCERPT_CHARS) };
  };

  // B3 — a density cluster must also contain a table, on the same test the
  // heading path uses. A cluster of coupon mentions in narrative prose is
  // not a schedule, and until now nothing said so.
  const tableClusters = clusters.filter((c) => {
    const span = spanOf(c);
    return assertSpanContainsTable(text, span.start, span.end).ok;
  });
  if (tableClusters.length === 0) return { status: "not_found" };

  // SESSION 20, STAGE 2 — CONTENT DISQUALIFIES BEFORE MAGNITUDE CHOOSES.
  //
  // Magnitude cannot separate UHS's interest-expense table from its real
  // note: the wrong table clusters denser AND scores higher. It is not a
  // miscalibrated signal, it is the wrong question — magnitude asks "which
  // of these is biggest", and both tables are about the same instruments at
  // the same scale. Content asks whether each candidate's numbers can be
  // balances at all, which is the question that actually differs.
  //
  // Ordered as a DISQUALIFIER, not a scorer: a span whose rows are periodic
  // coupon is removed from contention entirely, and magnitude then chooses
  // among what remains, unchanged. A span the test cannot judge (no rows
  // stating their own issue size) is left in — abstention keeps the previous
  // behaviour rather than guessing, which is why nine companies are
  // unaffected by this change.
  const contentJudged = tableClusters.map((c) => {
    const span = spanOf(c);
    return { c, span, verdict: classifySpanByContent(text.slice(span.start, span.end)) };
  });
  const survivors = contentJudged.filter((j) => j.verdict.kind !== "not-a-schedule");
  // Never disqualify the whole field. If content rules out every candidate,
  // it has told us something is wrong with the filing, not which span to
  // pick — so the ranking runs over all of them and the caller still sees
  // via=density rather than a silent not_found.
  const contended = survivors.length > 0 ? survivors : contentJudged;
  const contentDecided = survivors.length > 0 && survivors.length < contentJudged.length;

  let best = contended[0].c;
  let bestSpan = contended[0].span;
  let bestMagnitude = maxGroupedFigure(text, bestSpan.start, bestSpan.end);
  for (const { c, span } of contended.slice(1)) {
    const magnitude = maxGroupedFigure(text, span.start, span.end);
    // Ties fall back to the old rule (denser cluster wins, then earliest) so
    // a filing whose clusters are genuinely indistinguishable by magnitude
    // behaves exactly as it did before this change, rather than reordering
    // on nothing.
    if (magnitude > bestMagnitude || (magnitude === bestMagnitude && c.length > best.length)) {
      best = c;
      bestSpan = span;
      bestMagnitude = magnitude;
    }
  }

  // Provenance records which signal actually decided, so a wrong location is
  // traceable to the rule that made it — `via=content` only when content
  // narrowed the field, never when it merely abstained and magnitude chose.
  const bounds = expandToNoteBounds(text, bestSpan);
  return {
    status: "found",
    start: bounds.start,
    end: bounds.end,
    matchCount: best.length,
    via: contentDecided ? "content" : "density",
  };
}

/**
 * Session 18 diagnosis (zero-LLM-cost, real filings, all 10 companies): 26
 * of 30 baseline 10-Q/10-K filings had a locatable cluster; the other 4
 * (HCA's and CHS's Q1-2026 10-Qs, both of Cigna's 10-Qs) genuinely do NOT
 * carry an itemized per-tranche schedule at all — inspected directly, those
 * filings show only the aggregate balance-sheet debt line plus 0-3
 * scattered, non-clustering coupon mentions, while the same companies' 10-K
 * (same corpus) has a clean 12-37-match cluster. A 10-Q not repeating the
 * full ladder every quarter is normal; failing loudly PER FILING would
 * hard-crash 3 of the 10 companies on entirely ordinary data. The real
 * signal worth a hard failure is COMPANY-level: debt-maturity fires (the
 * model asserts real debt disclosure exists) but NOT ONE of the company's
 * fetched 10-Q/10-K filings had a locatable cluster anywhere — see
 * assertCompanyHasLocatableDebtNote below, called once per company after
 * classification, not per filing during corpus assembly.
 */
export class DebtNoteNotFoundError extends Error {
  constructor(public readonly companyName: string, public readonly checked: { form: string; url: string; status: DebtNoteFilingStatus }[]) {
    super(
      `${companyName}: debt-maturity fired, but the coupon/maturity density locator found no cluster (size >= ${MIN_CLUSTER_SIZE}) in ANY of this company's ${checked.length} fetched 10-Q/10-K filing(s). This is a hard, per-company failure — not a silent fallback — because every other company checked this session had the schedule locatable in at least one filing (usually the 10-K even when a given 10-Q didn't carry it). Either the locator is missing a real note (fix the locator) or this company's disclosure has an unusual shape (investigate before trusting any debtSchedule rows). Per-filing status: ${checked.map((c) => `${c.form} ${c.url} → ${c.status}`).join("; ")}`
    );
    this.name = "DebtNoteNotFoundError";
  }
}

/**
 * The lead window: how much of a long filing is sent to the model before the
 * located note is spliced or delimited.
 *
 * EXPORTED, AND THAT IS THE POINT. loop.ts carried its own copy of this
 * number as `SINGLE_EVENT_FILING_CHARS`, under a comment reading "Mirrors
 * buildExtractionText's LEAD_CHARS" — two constants, one value, two files,
 * and a comment as the only thing holding them together.
 *
 * It is load-bearing for a VERIFICATION BOUND, not just for cost.
 * amountCorroborated treats a filing at or under this length as its own
 * bound, on the reasoning that such a filing was sent to the model whole.
 * Had these two drifted, that reasoning would have silently applied to
 * filings that were never sent whole, and an amount would have been
 * corroborated against text the model never saw. One definition now.
 */
export const LEAD_CHARS = 40000;

export type DebtNoteFilingStatus = "not_applicable" | "under_cap" | "found" | "not_found";

export interface FilingExtractionResult {
  text: string;
  debtNoteStatus: DebtNoteFilingStatus;
  matchCount?: number;
  /**
   * Session 18 A1 — where the debt note was located in the FULL filing text,
   * surfaced so verification can bound an amount search to the note itself.
   * Null for a form the locator never runs on (8-K), for a document under the
   * lead cap, and when no note was found.
   */
  noteSpan?: { start: number; end: number };
  /**
   * SESSION 21, RULE 22 — whether this filer's debt disclosure is a TABLE.
   * Measured on the narrowed note (spanIsTabular), and it decides which
   * fields the extraction schema OFFERS. Undefined when no note was located,
   * where the question does not arise.
   */
  debtNoteTabular?: boolean;
}

/**
 * Builds the text actually sent to the model for one filing: unchanged for
 * an 8-K (already short, debtNoteStatus "not_applicable") or any document
 * under the lead cap ("under_cap"); for a longer 10-Q/10-K, the lead
 * LEAD_CHARS plus a clearly delimited excerpt around the located debt-note
 * cluster ("found"), or lead-only with status "not_found" when no cluster
 * exists — which, per the diagnosis above, is an ordinary, expected outcome
 * for SOME of a company's filings, not a per-filing failure. The caller is
 * responsible for the company-level check (assertCompanyHasLocatableDebtNote).
 */
/**
 * SESSION 22, STAGE 3 — THE SECOND REGION.
 *
 * An undrawn facility has no balance, so no row, so it is never in the debt
 * note: it lives in the liquidity discussion and nowhere else. Quest's
 * $750M revolver and its receivables facility are stated only there, which
 * is why its card read "the anchor filing states no revolving facility"
 * while the filing stated two. Measured across the book before wiring: the
 * section locates on 10 of 10, and Quest's own sentence — "$1.3 billion of
 * borrowing capacity available under our existing credit facilities,
 * including $518 million available under our secured receivables credit
 * facility and $750 million available under our senior unsecured revolving
 * credit facility" — is inside it.
 *
 * Appended AFTER the debt note's region and marked in its own words, so the
 * two regions are never confused for one another and neither is presented
 * as the other. Text outside both stays ordinary filing text (Rule 24's
 * corollary): nothing is removed from the corpus, only named.
 */
function appendLiquidityRegion(text: string, fullText: string): string {
  const liq = locateLiquiditySection(fullText);
  if (liq.status !== "found") return text;
  // Already visible in whatever we are about to send? Then naming it again
  // would put the same words in twice, and a model reading one occurrence as
  // corroboration of the other is a failure this codebase has already had.
  const excerpt = fullText.slice(liq.start, liq.end);
  if (text.includes(excerpt)) return text;
  return `${text}\n\n${LIQUIDITY_OPEN(liq.start)}\n\n${excerpt}\n\n${LIQUIDITY_CLOSE}`;
}

export function buildExtractionText(params: {
  form: string;
  url: string;
  fullText: string;
  /**
   * The filer's own XBRL stated total debt, when known. The debt-note
   * boundary relates the figures it sees to this and to nothing else — see
   * debtContent.ts's circularity guard. Absent, the boundary abstains and
   * cuts nothing, which is the safe direction.
   */
  xbrlStatedTotal?: number | null;
}): FilingExtractionResult {
  const { form, fullText } = params;
  if (fullText.length <= LEAD_CHARS) return { text: appendLiquidityRegion(fullText, fullText), debtNoteStatus: "under_cap" };
  if (form !== "10-Q" && form !== "10-K") return { text: fullText.slice(0, LEAD_CHARS), debtNoteStatus: "not_applicable" };

  const location = locateDebtNoteSection(fullText);
  const lead = fullText.slice(0, LEAD_CHARS);
  if (location.status === "not_found") return { text: appendLiquidityRegion(lead, fullText), debtNoteStatus: "not_found" };

  // Excerpt may overlap or sit inside the lead window (a smaller/simpler
  // filing's note might already be within LEAD_CHARS) — splice only the
  // non-overlapping remainder so the model never sees the same text twice.
  // SESSION 21 — A BOUNDARY NARROWS WHAT A REGION IS CALLED, NOT WHAT THE
  // MODEL CAN SEE. (Rule 24's corollary.)
  //
  // The debt disclosure ends before the first table carrying no debt content
  // (narrowToDebtDisclosure), and that boundary moves the CLOSE marker — it
  // does NOT truncate the corpus. Measured on UHS: the 1,168 characters cut
  // from its labelled note are a foreign-currency-contract table and a cash
  // reconciliation, and its `fx-exposure` trigger FIRES on the first and its
  // `large-cash-balance` evidence is read off the second. That content sits
  // at character ~53,000, reachable only through this span, so cutting the
  // corpus would have taken a firing trigger's evidence away to fix a
  // labelling problem.
  //
  // So the region stops being CALLED the debt note and stays visible as
  // ordinary filing text. The fabrication surface closes — the model is no
  // longer told hedge and cash figures are debt — and every other trigger
  // reads what it always read.
  const narrowed = narrowToDebtDisclosure(fullText, { start: location.start, end: location.end }, params.xbrlStatedTotal ?? null);
  const noteEnd = narrowed.end;
  // The VERIFICATION bound is the narrowed note too: a prose instrument or a
  // ladder row is required to sit inside the debt disclosure, and a figure
  // from the hedge table is not in it.
  const noteSpan = { start: location.start, end: noteEnd };

  // SESSION 19 (run B diagnosis) — EVERY BRANCH THAT HANDS INPUT TO THE
  // MODEL MARKS IT IDENTICALLY.
  //
  // This function had a marker on ONE branch. A note falling past LEAD_CHARS
  // was spliced in under an explicit "where the debt-schedule note was
  // located" banner; a note that happened to fall INSIDE the lead was handed
  // over as an unannotated 40,000-character slab, and the locator's entire
  // gain — knowing which text is the note — was discarded before the model
  // ever saw it. Which branch ran was an accident of where in the filing the
  // note sat, not a decision, and nothing in the model's input recorded that
  // a decision had been made at all.
  //
  // Molina is the cost. Its §7 Debt note sits at offset 37,461 and a "Fair
  // Value Measurements – Disclosure Only" table at 28,783 — both inside the
  // lead, nine thousand characters apart, sharing five nearly identical row
  // labels that differ only by carrying value versus face. With nothing
  // marking the note, v17 took labels from the debt note and amounts from
  // the fair-value table for three of five tranches. Verification caught and
  // dropped every composite, which is the guard working — but the ladder
  // lost three real rows to a defect that exists only because two branches
  // disagreed about what to say.
  //
  // THE RULE: a marker present only when one branch happens to run is an
  // accident, not a design. Both branches delimit the note the same way, in
  // the same words, so the model's input no longer depends on where in a
  // filing the note happens to sit.
  // SESSION 19 — THE MARKER DESCRIBES ITS PROVENANCE, IT DOES NOT ASSERT AN
  // IDENTITY.
  //
  // The first wording said "the debt-schedule note was located here", which
  // is a claim the locator is not always entitled to make. UHS is the case:
  // its locator has always landed on the INTEREST-EXPENSE table (the book's
  // only `via=density` match, every other company matching `via=heading`).
  // Unmarked, the model read that span and correctly returned no schedule.
  // Marked as a debt note, it complied — manufacturing five rows out of an
  // interest table by reading each row's issue size out of its own name.
  // Asserting a wrong locator result converts an honest failure into a
  // confident wrong answer, which is strictly worse than saying nothing.
  //
  // So the marker now states only what is true — that this region MATCHED a
  // locator — and names the out. It pairs with the v16 prompt rule that an
  // absent schedule means an EMPTY sequence, which the old wording was
  // effectively overriding.
  const OPEN = `[... the region below matched the debt-note locator at character offset ${location.start} of the full filing; it may not be a debt schedule. If it is not one — for example an interest-expense table, a fair-value disclosure, or narrative — return an EMPTY schedule sequence rather than composing rows from it ...]`;
  const CLOSE = "[... end of the region that matched the debt-note locator ...]";

  // THE BRANCH IS ON WHERE THE NOTE STARTS, NOT WHERE IT ENDS.
  //
  // Testing `location.end` leaves a third case that neither branch handles:
  // a note that STRADDLES the cap. Quest's note starts at 39,415 and runs
  // past 40,000, so the old code took the excerpt path and sliced from
  // max(39,415, 40,000) — silently cutting the note's first 585 characters,
  // its heading and opening rows among them, while the lead carried those
  // same characters unmarked. Branching on `start` makes the straddle the
  // same case as an early note: delimited from its own first character,
  // once, whole.
  if (location.start < LEAD_CHARS) {
    // The note begins inside the lead. Delimit it IN PLACE rather than
    // appending a copy — the same text twice invites the model to read one
    // occurrence as corroboration of the other. For a straddling note the
    // trailing remainder is empty, so the note simply runs to its own end.
    const text =
      fullText.slice(0, location.start) +
      `\n\n${OPEN}\n\n` +
      fullText.slice(location.start, location.end) +
      `\n\n${CLOSE}\n\n` +
      fullText.slice(location.end, Math.max(LEAD_CHARS, location.end));
    return { text: appendLiquidityRegion(text, fullText), debtNoteStatus: "found", matchCount: location.matchCount, noteSpan, debtNoteTabular: spanIsTabular(fullText, location.start, noteEnd).tabular };
  }
  const excerpt = fullText.slice(location.start, location.end);
  const text = `${lead}\n\n[... document continues; excerpt below resumes at character offset ${location.start} of the full filing ...]\n\n${OPEN}\n\n${excerpt}\n\n${CLOSE}`;
  return { text: appendLiquidityRegion(text, fullText), debtNoteStatus: "found", matchCount: location.matchCount, noteSpan, debtNoteTabular: spanIsTabular(fullText, location.start, noteEnd).tabular };
}

/**
 * Company-level hard-failure check, called once per company after
 * classification (once debt-maturity's `fired` is known) — see the class
 * doc comment above for why this is scoped to the company, not the filing.
 */
export function assertCompanyHasLocatableDebtNote(
  companyName: string,
  debtMaturityFired: boolean,
  checked: { form: string; url: string; status: DebtNoteFilingStatus }[]
): void {
  if (!debtMaturityFired) return;
  const anyFound = checked.some((c) => c.status === "found");
  if (!anyFound && checked.length > 0) throw new DebtNoteNotFoundError(companyName, checked);
}

