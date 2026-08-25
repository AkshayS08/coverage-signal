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
 */
const MAX_NOTE_NUMBER = 30;
const DEBT_NOTE_HEADING_RE = /(?:\bnotes?\s+)?(\d{1,2})\s*[.)–—:-]\s+((?:[A-Za-z][A-Za-z-]*\s+){0,4}?debt)\b/gi;

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
  | { status: "found"; start: number; end: number; matchCount: number }
  | { status: "not_found" };

/** A coupon rate loosely followed by a maturity year, in either order and however far HTML-to-text stripping put whitespace between them — the one shape a debt-schedule row (or a dense cluster of them) reliably has. */
const COUPON_NEAR_YEAR_RE = /\d{1,2}\.\d{2,4}\s?%[\s\S]{0,90}?\b(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\b[\s\S]{0,90}?\d{1,2}\.\d{2,4}\s?%/g;

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
function maxGroupedFigure(text: string, start: number, end: number): number {
  let max = 0;
  for (const raw of text.slice(start, end).match(GROUPED_FIGURE_RE) ?? []) {
    const n = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
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
  // debtNoteLocator.test.ts — every one of the 10 has its expected offset
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
  // and that is pinned in debtNoteLocator.test.ts [14].
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

  let best = clusters[0];
  let bestSpan = spanOf(best);
  let bestMagnitude = maxGroupedFigure(text, bestSpan.start, bestSpan.end);
  for (const c of clusters.slice(1)) {
    const span = spanOf(c);
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

  return { status: "found", start: bestSpan.start, end: bestSpan.end, matchCount: best.length };
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

const LEAD_CHARS = 40000;

export type DebtNoteFilingStatus = "not_applicable" | "under_cap" | "found" | "not_found";

export interface FilingExtractionResult {
  text: string;
  debtNoteStatus: DebtNoteFilingStatus;
  matchCount?: number;
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
export function buildExtractionText(params: { form: string; url: string; fullText: string }): FilingExtractionResult {
  const { form, fullText } = params;
  if (fullText.length <= LEAD_CHARS) return { text: fullText, debtNoteStatus: "under_cap" };
  if (form !== "10-Q" && form !== "10-K") return { text: fullText.slice(0, LEAD_CHARS), debtNoteStatus: "not_applicable" };

  const location = locateDebtNoteSection(fullText);
  const lead = fullText.slice(0, LEAD_CHARS);
  if (location.status === "not_found") return { text: lead, debtNoteStatus: "not_found" };

  // Excerpt may overlap or sit inside the lead window (a smaller/simpler
  // filing's note might already be within LEAD_CHARS) — splice only the
  // non-overlapping remainder so the model never sees the same text twice.
  if (location.end <= LEAD_CHARS) return { text: lead, debtNoteStatus: "found", matchCount: location.matchCount };
  const excerptStart = Math.max(location.start, LEAD_CHARS);
  const excerpt = fullText.slice(excerptStart, location.end);
  const text = `${lead}\n\n[... document continues; excerpt below resumes at character offset ${excerptStart} of the full filing, where the debt-schedule note was located ...]\n\n${excerpt}`;
  return { text, debtNoteStatus: "found", matchCount: location.matchCount };
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
