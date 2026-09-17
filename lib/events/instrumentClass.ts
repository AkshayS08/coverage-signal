/**
 * SESSION 22, STAGE 2 — PRIORITY CLASS AND INSTRUMENT TYPE.
 *
 * Rule 32 established what was actually missing: the class string is already
 * extracted verbatim from the note's own section header and already
 * rendered, on 33 of 85 rows book-wide. What it is not is normalized, not
 * complete, carries no instrument type, and is not structural. This module
 * is the first three; ordering is the fourth and lives in position.ts.
 *
 * TWO SOURCES, BOTH THE FILER'S OWN WORDS.
 *
 *   1. The note's section heading, which arrives as `LadderRow.seniority` —
 *      Tenet's "Senior secured first lien notes:", DaVita's "Senior Secured".
 *   2. The instrument's own name — "4.625% Senior Secured Notes due 2029".
 *
 * The second is why "complete" was achievable at all. Measured across the
 * book: Quest, Centene, Molina and UHS print NO section headings, so every
 * one of their rows carried no class — 14 of Quest's 14, all of UHS's nine —
 * while their instrument names say "Senior Notes" and "Senior Secured Notes"
 * in as many words. The class was disclosed and we were not reading it.
 *
 * NOTHING IS INFERRED FROM AN ABSENCE. This is the rule the vocabulary had
 * to bend to, not the other way round:
 *
 *   - DaVita's section says "Senior Notes" and its rows carry "Senior".
 *     Those notes are unsecured in fact, and the FILING DOES NOT SAY SO.
 *     Mapping "Senior" to `senior-unsecured` would read a security status
 *     out of the absence of the word "secured" — the exact default the stage
 *     brief forbids. So the set carries `senior` for "senior, security not
 *     stated", which is what the note says and all it says. Cigna's four
 *     rows are the same case.
 *
 *   - CHS prints "Junior-Priority Secured". That is not "second lien": it is
 *     CHS's own capital structure term, and the note never uses lien
 *     numbering. It maps to `junior-priority-secured`, its own value, rather
 *     than being rounded into a lien rank the filer never claimed.
 *
 * So the normalized set is the measured set plus the classes a healthcare
 * ladder can hold, and a string that does not map keeps its own words under
 * `other` rather than being forced into a neighbouring class. The verbatim
 * is ALWAYS retained beside the normalized value, and the surface renders
 * the verbatim where the two could disagree.
 *
 * WHERE NOTHING IS STATED ON THE ROW, the class is `null` and reads "class
 * not stated on this row" — never "unsecured", never blank, and deliberately
 * NOT "not disclosed". Molina is why: its table prints no class and its names
 * say only "Notes", while the note's prose says "Each of these notes are
 * senior unsecured obligations ... and rank equally in right of payment".
 * That sentence is in no verified field, so this build cannot read it — and a
 * label claiming the filing discloses nothing would report our own blind spot
 * as a fact about the filing. An absence of disclosure, an absence of
 * seniority, and an absence of READING are three different things.
 *
 * DERIVED IN CODE FROM VERIFIED FIELDS. Both inputs — the section heading
 * and the instrument name — are already fact-guarded against the filing.
 * Nothing here asks the model anything, so there is no prompt bump and no
 * re-extraction: this is Rule 27's shape applied to a string instead of an
 * arithmetic, and the `statedAs` field is the audit trail back to the words
 * the filing printed.
 */

/** The priority stack, ordered senior-most first. The order IS the ranking. */
export const PRIORITY_CLASSES = [
  "first-lien",
  "second-lien",
  "junior-priority-secured",
  "senior-secured",
  "senior-unsecured",
  "senior",
  "subordinated",
  "mezzanine",
  "other",
] as const;
export type PriorityClass = (typeof PRIORITY_CLASSES)[number];

export const INSTRUMENT_TYPES = [
  "senior-note",
  "term-loan-a",
  "term-loan-b",
  "term-loan",
  "revolver",
  "delayed-draw",
  "commercial-paper",
  "finance-lease",
  "credit-facility",
  "other",
] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export interface Classification {
  /** Null when the corpus states no class for this row — "not disclosed", never a default. */
  priorityClass: PriorityClass | null;
  /** The filer's own words the class came from. Null exactly when priorityClass is null. */
  priorityClassStatedAs: string | null;
  /**
   * Which of the three sources the class was read from. "note-statement" is
   * the one that is NOT on the row: the note's own prose, stating one class
   * for a group of instruments the row belongs to. The surface must say so —
   * see priorityClassLabel and the render note in app/page.tsx.
   */
  priorityClassFrom: "section" | "name" | "note-statement" | null;
  /** Null when nothing in the name or heading names a type. */
  instrumentType: InstrumentType | null;
  instrumentTypeStatedAs: string | null;
}

/** Display order for the ladder: senior-most first, unclassed last. */
export function priorityRank(c: PriorityClass | null): number {
  if (c === null) return PRIORITY_CLASSES.length;
  return PRIORITY_CLASSES.indexOf(c);
}

/**
 * How a class reads on the ladder. Never blank, never a guess.
 *
 * THE NULL LABEL SAYS WHAT WAS ACTUALLY CHECKED. It first read "class not
 * disclosed", which asserts the corpus states none — and that was false for
 * Molina, whose note says in prose "Each of these notes are senior unsecured
 * obligations ... and rank equally in right of payment" while its table
 * prints no class and its names say only "Notes". The class was disclosed;
 * it was disclosed somewhere the build did not read. Claiming non-disclosure
 * would be the tool reporting its own blind spot as a fact about the filing,
 * which is the one thing it must never do.
 *
 * STAGE 3 READS THAT SENTENCE, and the wording survives it unchanged —
 * because the distinction it was written for is still live. Molina's five
 * note rows now carry a class from the prose; its Credit Facility, on the
 * same ladder under the same note, is not covered by "each of these notes"
 * and still carries none. "Not stated ON THIS ROW" is exactly true of it,
 * and "not disclosed" would still be a claim about the filing that nothing
 * checked.
 */
export function priorityClassLabel(c: Classification): string {
  if (c.priorityClass === null) return "class not stated on this row";
  // The FILER'S WORDS WIN ON THE SURFACE. The normalized value exists to
  // sort and to group; it must never replace what the note printed, because
  // "Junior-Priority Secured" and "second lien" are not the same claim even
  // where they sort adjacently.
  return c.priorityClassStatedAs ?? c.priorityClass;
}

export function instrumentTypeLabel(c: Classification): string {
  return c.instrumentTypeStatedAs ?? "type not stated";
}

/**
 * SESSION 22, STAGE 7 (B2) — THE COLUMN NAMES WHAT THE TOOL KNOWS.
 *
 * The ladder's class column was labelled "priority class", which claims a
 * lien ranking the tool has not verified: it reads the filing's grouping
 * label and the instrument's own name, and never the credit agreement's
 * intercreditor terms. Senior secured notes may or may not be pari passu
 * with a senior secured term loan, and only the agreement says. Asserting a
 * ranking from a heading is the same move as reading a security status out of
 * a missing word.
 *
 * So the column is FACILITY TYPE, and it reads: the instrument's kind in the
 * filer's own words, with the filing's grouping label beside it where the
 * note prints one. True lien ranking across instruments is a v2 capability
 * and is deliberately not claimed here.
 */
export function facilityTypeLabel(c: Classification): string {
  const kind = c.instrumentTypeStatedAs ?? (c.instrumentType ? c.instrumentType.replace(/-/g, " ") : null);
  const grouping = c.priorityClassStatedAs;
  if (kind && grouping) {
    // Don't print the grouping twice when the name already carries it.
    return grouping.toLowerCase().includes(kind.toLowerCase()) ? grouping : `${kind} · ${grouping}`;
  }
  return kind ?? grouping ?? "type not stated";
}

/**
 * Ordered most specific first, because "senior secured first lien notes"
 * must not be caught by the "senior secured" rule, and "junior-priority
 * secured" must not be caught by "secured".
 */
const CLASS_PATTERNS: [RegExp, PriorityClass][] = [
  [/\bfirst[- ]lien\b|\b1st[- ]lien\b/i, "first-lien"],
  [/\bsecond[- ]lien\b|\b2nd[- ]lien\b/i, "second-lien"],
  [/\bjunior[- ]priority\b/i, "junior-priority-secured"],
  // A COMMA BETWEEN COORDINATE ADJECTIVES IS STILL ONE PHRASE. Encompass's
  // note says "senior, unsecured obligations"; without this the phrase falls
  // through to the bare `senior` rule and the class reads "senior, security
  // not stated" while the word "unsecured" sits in the sentence. That is
  // rule [1a] inverted — [1a] refuses to infer unsecured from the ABSENCE of
  // "secured", and this refuses to ignore it when it is present. Normalizing
  // punctuation between the two words is the same kind of change as matching
  // case-insensitively, not a widening of what either word means.
  [/\bsenior[,\s]+secured\b/i, "senior-secured"],
  [/\bsenior[,\s]+unsecured\b/i, "senior-unsecured"],
  [/\bsubordinated\b/i, "subordinated"],
  [/\bmezzanine\b/i, "mezzanine"],
  // LAST, AND DELIBERATELY SO. A bare "senior" says rank and says nothing
  // about security. It only applies once every more specific reading has
  // failed, and it never becomes "unsecured".
  [/\bsenior\b/i, "senior"],
];

const TYPE_PATTERNS: [RegExp, InstrumentType][] = [
  [/\bdelayed[- ]draw\b/i, "delayed-draw"],
  [/\bterm loan\s+b\b|\bterm loan b-\d/i, "term-loan-b"],
  [/\bterm loan\s+a\b|\bterm loan a-\d|\btranche a term loan\b/i, "term-loan-a"],
  [/\bterm loan\b/i, "term-loan"],
  [/\brevolv/i, "revolver"],
  // An ABL facility is a revolving borrowing base by construction, and CHS
  // carries it as capacity — but the name never says "revolving", so the
  // stated words are kept and the type is the one the structure requires.
  [/\bABL\b/i, "revolver"],
  [/\bcommercial paper\b/i, "commercial-paper"],
  [/\b(finance|financing|capital)\s+lease/i, "finance-lease"],
  [/\bnotes?\b/i, "senior-note"],
  // LAST. Molina prints "Credit Facility" and nothing else — the note's own
  // prose says revolver, and that prose is Stage 3's job to read. Until it
  // does, this is a credit facility of unstated kind, which is true.
  [/\bcredit facility\b|\bcredit agreement\b|\bfacility\b/i, "credit-facility"],
];

/**
 * The class words plus the instrument noun that immediately follows them, as
 * one contiguous span of the filer's own text. Never composed: if the noun is
 * not there, the span is not extended.
 */
const GROUPING_NOUN = /^\s+(notes?|bonds?|debentures?|facility|facilities|loans?|paper|leases?|obligations?|borrowings?)/i;

function extendToGroupingLabel(name: string, matched: string): string {
  const at = name.toLowerCase().indexOf(matched.toLowerCase());
  if (at < 0) return matched;
  const after = name.slice(at + matched.length);
  const m = GROUPING_NOUN.exec(after);
  return m ? name.slice(at, at + matched.length + m[0].length) : matched;
}

/** The matched substring, so the surface can show the words rather than the mapping. */
function firstMatch<T>(text: string, patterns: [RegExp, T][]): { value: T; matched: string } | null {
  for (const [re, value] of patterns) {
    const m = re.exec(text);
    if (m) return { value, matched: m[0] };
  }
  return null;
}

/**
 * SESSION 22, STAGE 3 (finish) — THE THIRD SOURCE: THE NOTE'S OWN PROSE.
 *
 * Some notes print no class on any table row and state it once, in a
 * sentence, for the whole group. Molina is the case the null label was
 * written around: six rows, none carrying a class, and the note's prose
 * saying "Each of these notes are senior unsecured obligations". The
 * sentence was extracted and verified at v29 and nothing read it, so the
 * ladder went on reporting our own blind spot.
 *
 * READING THE SENTENCE IS NOT THE EASY HALF. Measured on both statements the
 * book actually contains, a whole-sentence class match is WRONG on one of
 * two:
 *
 *   UHS   "...are guaranteed on a SENIOR SECURED basis by all of our ...
 *          subsidiaries that guarantee our Credit Agreement, other FIRST
 *          LIEN obligations, or any JUNIOR LIEN obligations."
 *
 * Three class phrases, and only the first is about the notes — the other two
 * describe obligations of the GUARANTORS. CLASS_PATTERNS is ordered
 * most-specific-first, so a whole-sentence match returns `first-lien` for a
 * senior secured instrument: a two-notch error, in the unsafe direction, on
 * a demo name.
 *
 *   Molina  "...are SENIOR UNSECURED obligations ..., and rank equally in
 *            right of payment with all existing and future SENIOR debt, and
 *            senior to all existing and future SUBORDINATED debt."
 *
 * Same shape: a seniority sentence names the classes ABOVE and BELOW its
 * subject by construction, because that is what ranking means.
 *
 * So the class is read from the sentence's HEAD — the span before the first
 * connective at which the sentence stops describing its own subject — and
 * the head must name EXACTLY ONE class. Two or more and the sentence is
 * ambiguous and classes nothing, which is the safe direction and is stated
 * rather than silently resolved. Both real statements resolve to exactly one
 * in their head; neither does across the whole sentence.
 */
export interface NoteSeniorityStatement {
  statement: string;
  /** What the sentence says it covers, in its own words — never widened here. */
  appliesTo: string;
}

/**
 * Where a seniority sentence stops describing its subject. A small CLOSED
 * set of connectives — the same kind of closed list as moneyScale.ts's
 * SCALE_WORDS or position.ts's PARTIAL_REDEMPTION_RE — not company or
 * instrument vocabulary, and not a parser.
 *
 * A relative pronoun ("subsidiaries THAT guarantee") hands the sentence to a
 * new subject; a ranking connective ("and RANK equally with", "SENIOR TO")
 * introduces the things being ranked against. Cutting early can only lose a
 * class and refuse; it can never invent one.
 */
const SUBJECT_SHIFT_RE =
  /\b(?:that|which|whose|and\s+rank|ranks?\b|ranking|senior\s+to\s+all|junior\s+to|subordinated\s+to|pari\s+passu|equally\s+(?:in|with)|compared\s+(?:to|with))\b/i;

/** The span of a seniority sentence that is still about its own subject. */
export function statementHead(statement: string): string {
  const s = statement ?? "";
  const m = SUBJECT_SHIFT_RE.exec(s);
  return (m ? s.slice(0, m.index) : s).trim();
}

/**
 * Every DISTINCT class named in a span. Matched text is consumed as it goes,
 * most-specific pattern first, so the bare `senior` rule cannot re-match the
 * "senior" inside a "senior unsecured" the earlier rule already claimed and
 * report one phrase as two conflicting classes.
 */
function distinctClassesIn(text: string): { value: PriorityClass; matched: string }[] {
  let rest = text;
  const found: { value: PriorityClass; matched: string }[] = [];
  for (const [re, value] of CLASS_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    let consumed = rest;
    while ((m = g.exec(rest)) !== null) {
      if (!found.some((f) => f.value === value)) found.push({ value, matched: m[0] });
      consumed = consumed.slice(0, m.index) + " ".repeat(m[0].length) + consumed.slice(m.index + m[0].length);
      if (m.index === g.lastIndex) g.lastIndex++;
    }
    rest = consumed;
  }
  return found;
}

/**
 * The class a seniority sentence asserts about its own subject, or null when
 * its head names none or names more than one. Null is a refusal, not a
 * default — nothing downstream may treat it as "unsecured" or as "no class
 * is disclosed".
 */
export function classFromStatement(statement: string): { value: PriorityClass; matched: string } | null {
  const found = distinctClassesIn(statementHead(statement));

  // BARE `senior` IS A REFINEMENT OF THE OTHERS, NOT A RIVAL TO THEM.
  //
  // `senior` means "senior, and the security is not stated" — that is the
  // whole reason it exists as its own value (see rule [1a]). A head that
  // ALSO says secured or unsecured has stated the security, so the two
  // readings cannot contradict: the specific one is the same claim with the
  // missing half supplied. Encompass is why this is here rather than
  // theoretical — "The Senior Notes are senior, unsecured obligations"
  // names the class twice, once in the instrument's own name and once as the
  // assertion, and counting those as two conflicting classes refused a
  // sentence that says exactly one thing.
  //
  // Two genuinely different classes still refuse. UHS's sentence with its
  // subject-shift boundary removed names senior-secured AND first-lien, and
  // those are rival claims about different obligations — no rule here
  // resolves them, because the sentence does not.
  const specific = found.filter((f) => f.value !== "senior");
  if (specific.length === 1) return specific[0];
  if (specific.length === 0 && found.length === 1) return found[0];
  return null;
}

/**
 * Does a group statement cover THIS row? Two independent tests, both read
 * out of the filer's own `appliesTo` words and neither widened:
 *
 *   NAME         Every significant word of the scope phrase must appear in
 *                the row's own name. "Each of these notes" covers a row
 *                called "4.375 % Notes due June 15, 2028"; it does not cover
 *                Molina's "Credit Facility", on the same ladder under the
 *                same note, which therefore keeps "class not stated on this
 *                row" — the true answer, not the convenient one.
 *   ENUMERATION  "All the Notes (2026, 2029, 2030, 2032 and 2034 Notes)"
 *                names its members by maturity year. Where the scope
 *                enumerates, the row's own maturity must be in the list, and
 *                a row with no stated maturity cannot be confirmed a member
 *                and is not treated as one.
 *
 * THE NAME TEST REPLACED A NORMALIZED-TYPE TEST, WHICH WAS TOO COARSE AND WAS
 * CAUGHT WIDENING. The first version asked whether the row's InstrumentType
 * equalled the scope's, and InstrumentType maps every line containing the
 * word "notes" to `senior-note`. So Encompass's "the Senior Notes" reached
 * its "Other notes payable" line — a residual catch-all for acquisition and
 * miscellaneous notes, which is emphatically not one of the four tranches the
 * sentence is about — and classed it from a sentence that does not describe
 * it. That is the composite-fabrication shape in the class column: a real
 * sentence and a real row, joined by nothing.
 *
 * Comparing the filer's own words on both sides is what separates them:
 * "senior" is in the scope phrase and in all four tranche names, and is not
 * in "Other notes payable".
 *
 * A scope whose words the row does not carry covers NOTHING. The failure
 * direction is always toward "class not stated", never toward a class this
 * row was not shown to have — so a scope naming the filer ("the Molina
 * Healthcare Senior Notes") would cover nothing rather than everything, which
 * loses coverage and invents none.
 *
 * STATED LIMIT: "these" cannot be resolved. Molina's sentence follows its own
 * debt table and "these notes" is read as the note rows on that table, which
 * is the ordinary reading and is what the ladder is built from — but it is a
 * reading, not a quotation, and it is why the surface says the class came
 * from the note's prose rather than from the row.
 */

/**
 * Determiners, quantifiers and connectives — a small CLOSED set that carries
 * no instrument identity, so dropping them cannot change which instrument a
 * phrase names. Not company or instrument vocabulary.
 */
const SCOPE_STOPWORDS = new Set([
  "each", "of", "these", "those", "this", "the", "a", "an", "all", "any", "both",
  "our", "its", "their", "and", "or", "collectively", "certain", "outstanding",
]);

/** Significant words of a phrase, singularized, for comparison against another phrase. */
function scopeTokens(phrase: string): string[] {
  return (phrase ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")     // "(collectively "All the Notes")" — an aside, not the scope
    .replace(/[^a-z\s]+/g, " ")     // rates, years and punctuation are handled separately
    .split(/\s+/)
    .filter((w) => w.length > 1 && !SCOPE_STOPWORDS.has(w))
    .map((w) => (w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w));
}

export function statementCoversRow(
  appliesTo: string,
  row: { instrumentName?: string | null; instrumentType?: InstrumentType | null; maturityDate: string | null | undefined }
): boolean {
  const scope = appliesTo ?? "";
  const wanted = scopeTokens(scope);
  if (wanted.length === 0) return false;
  const have = new Set(scopeTokens(row.instrumentName ?? ""));
  if (!wanted.every((w) => have.has(w))) return false;

  const years = [...scope.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  if (years.length === 0) return true;
  const rowYear = Number.parseInt((row.maturityDate ?? "").slice(0, 4), 10);
  return Number.isFinite(rowYear) && years.includes(rowYear);
}

/**
 * Is `b` the same claim as `a` with the security half supplied? Bare `senior`
 * means "senior, and the security is not stated"; any more specific
 * senior-family class states it. So this is a refinement, never a conflict —
 * the same reasoning classFromStatement already applies inside one sentence,
 * applied here across sources.
 */
function refines(a: PriorityClass, b: PriorityClass): boolean {
  return a === "senior" && b !== "senior" && b !== "other";
}

/**
 * SESSION 22, STAGE 4 (fix) — ONE CLASS, THREE SOURCES, NEVER TWO FIELDS.
 *
 * The extraction carried the same idea in two places — `section` ("the note's
 * own section heading it sits under") and `seniority` ("verbatim from the
 * debt note's own section header") — and the model split one concept between
 * them arbitrarily. Measured across all ten companies at v29:
 *
 *   section only      26 rows   Tenet's 10, DaVita's 9, and others
 *   seniority only     8 rows   all CHS
 *   both, DISAGREEING  4 rows   all Encompass
 *
 * So every consumer reading one field is wrong somewhere, and which one is
 * wrong changes per company. Tenet was the visible cost: ten rows whose class
 * the filing prints above them ("Senior secured first lien notes:") read
 * "class not stated on this row", because the class landed in the field the
 * classifier did not read. The field it DID land in is the one the checksum
 * depends on, which is why it was never going to be dropped — the model was
 * reading the heading the whole time.
 *
 * Encompass proves the two fields are not even the same KIND of thing:
 * `section` is "Bonds payable", a location; `seniority` is "senior
 * unsecured", a class. Reading either alone loses a demo name.
 *
 * THE FIX IS A MERGE, NOT A PREFERENCE. Every heading string the filing
 * prints for a row arrives as one ordered list, and the class is read from
 * the first of them that names one. A heading naming no class — "Bonds
 * payable", "Long-term debt" — classes nothing and costs nothing, so there is
 * no need to decide in advance which field is the "real" one. That question
 * is what produced two fields.
 *
 * SOURCES IN PRIORITY ORDER: headings, then the row's own name, then the
 * note's prose statement. Headings lead because a section is the filer's
 * deliberate grouping of that row, and a name is what the filers who print no
 * headings fall back on.
 *
 * WITH ONE CROSS-SOURCE RULE: a bare `senior` from a higher-priority source is
 * REFINED by a more specific class from a lower one, because those are not
 * rival claims. CHS is why — its heading says "senior-priority secured",
 * which no specific pattern matches, so it resolved to bare `senior` and
 * ranked BELOW its own junior-priority notes: the ladder rendered CHS's
 * junior-priority secured tranches ABOVE its senior-priority secured ones.
 * Its rows' own names say "Senior Secured Notes", which supplies exactly the
 * half the heading left unstated.
 *
 * The refinement changes the RANK and never the words: `priorityClassStatedAs`
 * still comes from the highest-priority source that named a class, so CHS
 * keeps "senior-priority secured" on screen — its own capital-structure term,
 * which is not the same claim as "senior secured" and must not be replaced by
 * it (Rule 32, and the reason the verbatim is carried at all).
 */
export function classifyInstrument(params: {
  /**
   * EVERY heading string the filing prints for this row, in the order they
   * should be trusted. One concept, one input — see the note above.
   */
  headings?: (string | null | undefined)[];
  /** The instrument's own name, already verified. */
  instrumentName: string;
  /** This row's own maturity, needed only to test membership of an ENUMERATED scope. */
  maturityDate?: string | null;
  /**
   * The debt note's group seniority sentence, where it states one. Consulted
   * ONLY where the section and the name both state nothing, so it can never
   * change a class the row itself carries — it fills silences and nothing
   * else.
   */
  noteStatement?: NoteSeniorityStatement | null;
}): Classification {
  const headings = (params.headings ?? []).map((h) => h?.trim() || "").filter((h) => h !== "");
  const name = params.instrumentName?.trim() || "";

  // The first heading that names a class wins; headings that name none cost
  // nothing, which is what makes merging safe.
  let headingText: string | null = null;
  let fromHeading: { value: PriorityClass; matched: string } | null = null;
  for (const h of headings) {
    const m = firstMatch(h, CLASS_PATTERNS);
    if (m) { fromHeading = m; headingText = h; break; }
  }
  const fromName = firstMatch(name, CLASS_PATTERNS);

  const type =
    firstMatch(name, TYPE_PATTERNS) ??
    headings.reduce<{ value: InstrumentType; matched: string } | null>((acc, h) => acc ?? firstMatch(h, TYPE_PATTERNS), null);
  const instrumentType = type ? type.value : null;

  // THE PROSE IS THE LAST RESORT, AND ONLY WITHIN ITS OWN SCOPE.
  const stmt = params.noteStatement;
  const fromStatement =
    !fromHeading && !fromName && stmt &&
    statementCoversRow(stmt.appliesTo, { instrumentName: name, instrumentType, maturityDate: params.maturityDate })
      ? classFromStatement(stmt.statement)
      : null;

  // Highest-priority source that named a class supplies the WORDS.
  const primary = fromHeading ?? fromName ?? fromStatement;
  const primaryFrom: Classification["priorityClassFrom"] =
    fromHeading ? "section" : fromName ? "name" : fromStatement ? "note-statement" : null;

  // A lower-priority source may supply the RANK, but only by refining a bare
  // `senior` — never by overriding a class already stated specifically.
  let value = primary ? primary.value : null;
  if (value !== null) {
    for (const candidate of [fromHeading, fromName, fromStatement]) {
      if (candidate && refines(value, candidate.value)) value = candidate.value;
    }
  }

  return {
    priorityClass: value,
    // The whole heading where it came from a heading — a heading is a
    // deliberate grouping and reads as one. Just the matched words where it
    // came from a name or from the note's prose, because the rest of a name
    // is rate and maturity and the rest of a statement is the ranking.
    // B2 — THE FULL GROUPING LABEL, INCLUDING THE INSTRUMENT WORD. A heading
    // is quoted whole. A name previously contributed only the class words, so
    // "4.625% Senior Secured Notes due 2029" grouped as "Senior Secured" —
    // dropping the noun that says what the instrument IS. Extended through an
    // immediately-following instrument word, still entirely the filer's own
    // text and still a contiguous span of it.
    priorityClassStatedAs: primary
      ? fromHeading
        ? headingText
        : primary === fromName
          ? extendToGroupingLabel(name, primary.matched)
          : primary.matched
      : null,
    priorityClassFrom: primaryFrom,
    instrumentType,
    instrumentTypeStatedAs: type ? type.matched : null,
  };
}
