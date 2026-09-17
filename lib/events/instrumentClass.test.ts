/**
 * SESSION 22, STAGE 2 — THE CLASSIFIER, ASSERTED ON THE BOOK'S OWN STRINGS.
 *
 * Every fixture below is a string a real filer actually printed, taken from
 * the Stage 2 audit of all 85 rows. A classifier tested on invented
 * vocabulary proves it can parse the vocabulary it was written against.
 *
 * Run: npx tsx lib/events/instrumentClass.test.ts
 */
import {
  classifyInstrument, priorityRank, priorityClassLabel, PRIORITY_CLASSES,
  classFromStatement, statementHead, statementCoversRow,
} from "./instrumentClass";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}
const cls = (section: string | null, name: string) =>
  classifyInstrument({ headings: [section], instrumentName: name });

console.log("\n=== [1] NOTHING IS INFERRED FROM AN ABSENCE ===");
{
  const davita = cls("Senior", "6.75% Senior Notes");
  assert(davita.priorityClass === "senior",
    `[1a] DaVita's "Senior" maps to \`senior\`, NOT \`senior-unsecured\`. Those notes are unsecured in fact and the filing does not say so; reading a security status out of the missing word "secured" is the default the stage brief forbids (got ${davita.priorityClass})`);

  const cigna = cls("senior", "6.000% Senior Notes due 2056");
  assert(cigna.priorityClass === "senior", "[1b] Cigna's lowercase \"senior\" is the same case and gets the same answer — a class map that is case-sensitive is a vocabulary guard, not a structural test (Rule 1)");

  const chs = cls("Junior-Priority Secured", "6 ⅞% Junior-Priority Secured Notes due 2029");
  assert(chs.priorityClass === "junior-priority-secured",
    "[1c] CHS's \"Junior-Priority Secured\" keeps its own value and is NOT rounded into `second-lien`. The note never uses lien numbering, and two classes that sort adjacently are still not the same claim");

  const unstated = cls(null, "Other");
  assert(unstated.priorityClass === null && unstated.priorityClassStatedAs === null,
    "[1d] a row stating no class is null — never a default, never a blank");
  assert(priorityClassLabel(unstated) === "class not stated on this row",
    `[1e] AND THE LABEL SAYS WHAT WAS CHECKED, not what the filing did. "class not disclosed" would be false for Molina, whose prose states the class where its table does not — claiming non-disclosure would report our blind spot as a fact about the filing (got "${priorityClassLabel(unstated)}")`);
}

console.log("\n=== [2] MOST SPECIFIC WINS — the ordering of the patterns is load-bearing ===");
{
  assert(cls("Senior secured first lien notes", "5.125 % due 2027").priorityClass === "first-lien",
    "[2a] Tenet's \"Senior secured first lien notes\" is first-lien, not senior-secured — the more specific reading must not be swallowed by the more general one");
  assert(cls(null, "4.625% Senior Secured Notes due 2029").priorityClass === "senior-secured",
    "[2b] \"Senior Secured\" is senior-secured and not the bare `senior` fallback");
  assert(cls("senior unsecured", "4.50% Senior Notes due 2028").priorityClass === "senior-unsecured",
    "[2c] Encompass's \"senior unsecured\" section beats the \"Senior\" in the instrument's own name — the section is the filer's deliberate grouping");
}

console.log("\n=== [3] THE NAME IS A SOURCE, WHICH IS WHY COMPLETENESS WAS POSSIBLE ===");
{
  const quest = cls(null, "4.60 % Senior Notes due December 2027");
  assert(quest.priorityClass === "senior" && quest.priorityClassFrom === "name",
    `[3a] Quest prints NO section headings, so all fourteen of its rows carried no class while every name says "Senior Notes". Read from the name, and the surface says which source it came from (got ${quest.priorityClass}/${quest.priorityClassFrom})`);

  const uhs = cls(null, "1.65% Senior Secured Notes due 2026");
  assert(uhs.priorityClass === "senior-secured" && uhs.priorityClassFrom === "name",
    "[3b] UHS is the same shape and the same fix — nine rows, no headings, the class in every name");

  const tenet = cls("Senior secured first lien notes", "5.125 % due 2027");
  assert(tenet.priorityClassFrom === "section" && tenet.priorityClassStatedAs === "Senior secured first lien notes",
    "[3c] where a heading exists it wins AND is quoted whole — a heading is one deliberate grouping and reads as one, unlike a name where only the matched words are the class");
}

console.log("\n=== [4] INSTRUMENT TYPE ===");
{
  assert(cls(null, "Term Loan B-2").instrumentType === "term-loan-b", "[4a] a B tranche is term-loan-b");
  assert(cls(null, "Tranche A Term Loan").instrumentType === "term-loan-a", "[4b] UHS spells its A tranche the other way round and still resolves");
  assert(cls(null, "Delayed Draw Term Loan A (Eleventh Amendment)").instrumentType === "delayed-draw",
    "[4c] a delayed-draw is NOT a term loan A, though it contains those words — the more specific pattern runs first");
  assert(cls(null, "Revolving Credit Agreement").instrumentType === "revolver", "[4d] revolver");
  assert(cls(null, "Commercial paper").instrumentType === "commercial-paper", "[4e] commercial paper is its own type, not a note");
  assert(cls(null, "Finance lease and financing obligations").instrumentType === "finance-lease", "[4f] finance lease");
  assert(cls(null, "Credit Facility").instrumentType === "credit-facility",
    "[4g] MOLINA'S GENERIC NAME RESOLVES ONLY AS FAR AS THE NAME ALLOWS. Its note's prose says revolver; that prose is Stage 3's to read. Until then this is a credit facility of unstated kind, which is true — calling it a revolver here would be inference dressed as extraction");
  assert(cls(null, "5.125 % due 2027").instrumentType === null || cls("Senior secured first lien notes", "5.125 % due 2027").instrumentType === "senior-note",
    "[4h] Tenet's names carry no instrument word at all, so the type comes from the section heading — both sources are needed, neither alone suffices");
}

console.log("\n=== [5] THE STACK ORDERS, AND UNCLASSED SORTS LAST ===");
{
  assert(priorityRank("first-lien") < priorityRank("senior-secured"),
    "[5a] first lien ranks above senior secured");
  assert(priorityRank("senior-secured") < priorityRank("senior-unsecured"),
    "[5b] secured above unsecured");
  assert(priorityRank("senior-unsecured") < priorityRank("subordinated"),
    "[5c] senior above subordinated");
  assert(priorityRank(null) === PRIORITY_CLASSES.length && priorityRank(null) > priorityRank("other"),
    "[5d] a row with no stated class sorts LAST — after `other`, so the unclassed group reads as its own section rather than one stray row between two classed ones");

  // The no-regression property, as a property rather than an observation.
  const oneClass = ["4.60 % Senior Notes due December 2027", "4.20 % Senior Notes due June 2029", "2.95 % Senior Notes due June 2030"]
    .map((n) => priorityRank(cls(null, n).priorityClass));
  assert(new Set(oneClass).size === 1,
    "[5e] EVERY QUEST ROW RANKS IDENTICALLY, so a class-then-maturity sort cannot re-order a single-class filer. The no-regression guarantee for Quest, Centene and Molina is a property of the sort, not a coincidence of today's data");
}

// ---------------------------------------------------------------------------
// SESSION 22, STAGE 3 (finish) — THE NOTE'S OWN PROSE AS A THIRD SOURCE.
//
// All three statements below are complete, verbatim sentences filers in this
// book actually printed, taken from the v29 extraction. There are exactly
// three, and they disagree about everything that matters — one scopes by a
// bare kind, one by an enumeration, one by a proper name; one asserts its
// class before a ranking clause and one before a relative clause; one writes
// the class with a comma inside it. Every one of those differences broke a
// version of this rule, which is why all three are here.
// ---------------------------------------------------------------------------
const MOLINA_STMT = {
  statement: "Each of these notes are senior unsecured obligations of the Parent corporation, Molina Healthcare, Inc., and rank equally in right of payment with all existing and future senior debt, and senior to all existing and future subordinated debt of Molina Healthcare, Inc.",
  appliesTo: "Each of these notes",
};
const UHS_STMT = {
  statement: "The 2026, 2029, 2030, 2032 and 2034 Notes (collectively \"All the Notes\") are guaranteed (the \"Guarantees\") on a senior secured basis by all of our existing and future direct and indirect subsidiaries that guarantee our Credit Agreement, other first lien obligations, or any junior lien obligations (the \"Subsidiary Guarantors\").",
  appliesTo: "All the Notes (2026, 2029, 2030, 2032 and 2034 Notes)",
};
const ENCOMPASS_STMT = {
  statement: "The Senior Notes are senior, unsecured obligations of Encompass Health and rank equally with our other senior indebtedness, senior to any of our subordinated indebtedness, and effectively junior to our secured indebtedness to the extent of the value of the collateral securing such indebtedness.",
  appliesTo: "the Senior Notes",
};

console.log("\n=== [6] A SENIORITY SENTENCE NAMES CLASSES THAT ARE NOT ITS SUBJECT'S ===");
{
  // The trap, stated as the thing that would happen without the head rule.
  // CLASS_PATTERNS is ordered most-specific-first, so `first-lien` wins a
  // whole-sentence match on UHS — two notches wrong, in the unsafe
  // direction, on a demo name.
  const uhsWhole = classFromStatement(UHS_STMT.statement.replace(/\bthat\b/g, "and"));
  assert(uhsWhole === null || uhsWhole.value !== "senior-secured",
    "[6a] THE TRAP IS REAL, NOT HYPOTHETICAL. With the subject-shift boundary removed, UHS's sentence no longer resolves to senior-secured — its \"other first lien obligations\" and \"junior lien obligations\" belong to the GUARANTORS, and a whole-sentence read attributes them to the notes");

  const uhs = classFromStatement(UHS_STMT.statement);
  assert(uhs?.value === "senior-secured",
    `[6b] Read from the head — the span before "subsidiaries THAT guarantee" hands the sentence to a new subject — UHS is senior secured, which is what the sentence says about the notes (got ${uhs?.value})`);

  const molina = classFromStatement(MOLINA_STMT.statement);
  assert(molina?.value === "senior-unsecured",
    `[6c] Molina's sentence names senior unsecured, senior, AND subordinated — a ranking sentence names what is above and below its subject by construction. The head stops at "and rank equally" and holds only the assertion (got ${molina?.value})`);

  assert(!/subordinated/i.test(statementHead(MOLINA_STMT.statement)) && /senior unsecured/i.test(statementHead(MOLINA_STMT.statement)),
    "[6d] the head keeps the assertion and drops the comparison — the mechanism, asserted directly rather than only through its result");

  assert(classFromStatement("These notes are senior secured obligations and also senior unsecured obligations.") === null,
    "[6e] A HEAD NAMING TWO CLASSES IS AMBIGUOUS AND CLASSES NOTHING. Refusing is the safe direction; picking the first would be resolving an ambiguity the filing did not resolve. SYNTHETIC — no filer in this book writes this, which is the point of asserting it");

  assert(classFromStatement("Each of these notes rank equally with our senior unsecured debt.") === null,
    "[6f] the class word sits entirely inside the ranking clause, so the head names none — a comparison is not an assertion about the subject. SYNTHETIC");

  const ehc = classFromStatement(ENCOMPASS_STMT.statement);
  assert(ehc?.value === "senior-unsecured",
    `[6g] ENCOMPASS WRITES ITS CLASS WITH A COMMA IN IT — "senior, unsecured obligations". Without punctuation normalization the phrase falls past the specific rule and lands on bare \`senior\`, so a sentence containing the word "unsecured" produces "security not stated". That is rule [1a] inverted: [1a] refuses to read unsecured out of an absence, and this refuses to ignore it when it is present (got ${ehc?.value})`);
  assert(ehc?.value === classFromStatement(ENCOMPASS_STMT.statement.replace("senior, unsecured", "senior unsecured"))?.value,
    "[6h] and the comma is the ONLY thing normalized — the same sentence without it gives the same class, so nothing about what either word means was widened");
}

console.log("\n=== [7] A GROUP STATEMENT REACHES ONLY ITS OWN SCOPE ===");
{
  const note2028 = { instrumentName: "4.375 % Notes due June 15, 2028", instrumentType: "senior-note" as const, maturityDate: "2028-06-15" };
  assert(statementCoversRow(MOLINA_STMT.appliesTo, note2028),
    "[7a] \"Each of these notes\" covers a note row — kind scope, no enumeration to satisfy");

  assert(!statementCoversRow(MOLINA_STMT.appliesTo, { instrumentName: "Credit Facility", instrumentType: "credit-facility" as const, maturityDate: "2030-12-01" }),
    "[7b] AND DOES NOT COVER MOLINA'S CREDIT FACILITY, on the same ladder under the same note. Five of its six rows clear and the sixth does not, because \"each of these notes\" is not \"everything in this note\" — widening it to make all six clear is the rule bent to fit an instance");

  assert(!statementCoversRow(UHS_STMT.appliesTo, { instrumentName: "Tranche A term loan", instrumentType: "term-loan-a" as const, maturityDate: "2030-10-01" }),
    "[7c] UHS's statement covers Notes, so its Tranche A term loan is untouched — the whole reason UHS is the negative test: it HAS a verified statement and that statement clears none of its three unclassed rows");

  assert(statementCoversRow(UHS_STMT.appliesTo, { instrumentName: "2.65% Senior Secured Notes due 2032", instrumentType: "senior-note" as const, maturityDate: "2032-09-01" }),
    "[7d] a 2032 note IS in \"All the Notes (2026, 2029, 2030, 2032 and 2034 Notes)\"");
  assert(!statementCoversRow(UHS_STMT.appliesTo, { instrumentName: "4.00% Senior Secured Notes due 2031", instrumentType: "senior-note" as const, maturityDate: "2031-09-01" }),
    "[7e] AND A 2031 NOTE IS NOT. Where the scope enumerates its members, membership is checked — a note outside the list is outside the sentence. SYNTHETIC: UHS carries no such row today, and a rule that only works on today's rows is not a rule");
  assert(!statementCoversRow(UHS_STMT.appliesTo, { instrumentName: "Senior Secured Notes", instrumentType: "senior-note" as const, maturityDate: null }),
    "[7f] a row with no stated maturity cannot be confirmed a member of an enumerated scope, so it is not treated as one — the failure direction is always toward \"class not stated\"");

  assert(!statementCoversRow("the obligations described above", { instrumentName: "4.50 % Senior Notes due 2030", instrumentType: "senior-note" as const, maturityDate: "2030-01-01" }),
    "[7g] a scope whose words no row carries covers NOTHING rather than everything. SYNTHETIC");

  // THE CASE THAT CAUGHT THE FIRST VERSION WIDENING, kept as the regression.
  // Found only by re-measuring the whole book after the wiring, not by
  // reasoning about the rule — Encompass is a demo name and this was on it.
  assert(statementCoversRow(ENCOMPASS_STMT.appliesTo, { instrumentName: "4.50 % Senior Notes due 2028", instrumentType: "senior-note", maturityDate: "2028-02-01" }),
    "[7h] Encompass's \"the Senior Notes\" covers its four Senior Notes tranches");
  assert(!statementCoversRow(ENCOMPASS_STMT.appliesTo, { instrumentName: "Other notes payable", instrumentType: "senior-note", maturityDate: "2030-01-01" }),
    "[7i] AND NOT ITS \"Other notes payable\" LINE, a residual catch-all for acquisition and miscellaneous notes. The first version compared normalized InstrumentType, which maps every line containing \"notes\" to `senior-note`, so a sentence about four named tranches classed a line it does not describe — a real sentence and a real row joined by nothing, which is the composite-fabrication shape in the class column. \"senior\" is in the scope phrase and in all four tranche names and is not in this one");
}

console.log("\n=== [8] THE PROSE FILLS SILENCES AND NEVER OVERWRITES ===");
{
  const molinaRow = classifyInstrument({
    headings: [], instrumentName: "4.375 % Notes due June 15, 2028",
    maturityDate: "2028-06-15", noteStatement: MOLINA_STMT,
  });
  assert(molinaRow.priorityClass === "senior-unsecured" && molinaRow.priorityClassFrom === "note-statement",
    `[8a] MOLINA'S NOTE ROWS CLEAR. Six rows read "class not stated on this row" while the note's own prose said senior unsecured — the field was extracted at v29 and nothing consumed it (got ${molinaRow.priorityClass}/${molinaRow.priorityClassFrom})`);

  const molinaFacility = classifyInstrument({
    headings: [], instrumentName: "Credit Facility",
    maturityDate: "2030-12-01", noteStatement: MOLINA_STMT,
  });
  assert(molinaFacility.priorityClass === null && priorityClassLabel(molinaFacility) === "class not stated on this row",
    "[8b] and its Credit Facility does not — the label the null case was written for is still true of it, which is why the wording survives Stage 3 unchanged");

  // The overwrite guard: a row that states its own class keeps it, even
  // where a group sentence would say something different.
  const stated = classifyInstrument({
    headings: ["Senior secured first lien notes"],
    instrumentName: "5.125 % due 2027", maturityDate: "2027-11-01",
    noteStatement: { statement: "Each of these notes are senior unsecured obligations.", appliesTo: "Each of these notes" },
  });
  assert(stated.priorityClass === "first-lien" && stated.priorityClassFrom === "section",
    `[8c] THE ROW'S OWN WORDS WIN. The prose is consulted only where the section and the name both state nothing, so no class that renders today can change (got ${stated.priorityClass}/${stated.priorityClassFrom})`);

  const noStatement = classifyInstrument({ headings: [], instrumentName: "Term Loan Facility", maturityDate: "2030-03-05" });
  assert(noStatement.priorityClass === null,
    "[8d] and a filer with no statement at all is exactly as it was — eight of the ten companies pass through this change untouched by construction");

  const uhsTermLoan = classifyInstrument({
    headings: [], instrumentName: "Tranche A term loan",
    maturityDate: "2030-10-01", noteStatement: UHS_STMT,
  });
  assert(uhsTermLoan.priorityClass === null,
    "[8e] UHS'S NEGATIVE TEST, END TO END: a verified statement, a row with no class, and the row still has none — because the sentence does not cover it. A wiring that cleared this row would be reading a guarantee on the Notes as a guarantee on the term loan");
}

// ---------------------------------------------------------------------------
// SESSION 22, STAGE 4 (fix) — ONE CLASS, THREE SOURCES, NEVER TWO FIELDS.
//
// The extraction carried one idea in two fields, `section` and `seniority`,
// and the model split it between them per company. Measured at v29 across all
// ten: section-only 26 rows, seniority-only 8, both-and-disagreeing 4. Each
// pair below is a real row, with the real contents of BOTH fields.
// ---------------------------------------------------------------------------
console.log("\n=== [9] THE MERGE — reading either field alone loses a company ===");
{
  // TENET: the class landed in `section`. Ten rows, the demo opener.
  const tenet = classifyInstrument({
    headings: ["Senior secured first lien notes", null],
    instrumentName: "5.125 % due 2027", maturityDate: "2027-11-01",
  });
  assert(tenet.priorityClass === "first-lien" && tenet.priorityClassStatedAs === "Senior secured first lien notes",
    `[9a] TENET'S CLASS WAS NEVER LOST — it was in \`section\` while the classifier read \`seniority\`. Its names carry no class words at all ("5.125 % due 2027"), so the heading was its only source and ten rows read "class not stated on this row" beneath a heading that states it (got ${tenet.priorityClass})`);

  const tenetUnsecured = classifyInstrument({ headings: ["Senior unsecured notes", null], instrumentName: "6.125 % due 2028" });
  assert(tenetUnsecured.priorityClass === "senior-unsecured" && tenet.priorityClass !== tenetUnsecured.priorityClass,
    "[9b] and its TWO sections resolve to two different classes, which is the whole point of the sort — a ladder whose rows all rank the same is sorted by seniority the way an empty list is");

  // ENCOMPASS: `section` is a LOCATION, `seniority` is the CLASS. They are not
  // the same kind of thing, which is why no single-field choice works.
  const ehc = classifyInstrument({
    headings: ["Bonds payable", "senior unsecured"],
    instrumentName: "4.50 % Senior Notes due 2028", maturityDate: "2028-02-01",
  });
  assert(ehc.priorityClass === "senior-unsecured",
    `[9c] ENCOMPASS PROVES THE TWO FIELDS ARE NOT ONE FIELD DUPLICATED. \`section\` is "Bonds payable" — a location, naming no class — and \`seniority\` is "senior unsecured". Preferring \`section\` would lose it; a heading naming no class simply costs nothing, which is what makes merging safe rather than a choice between them (got ${ehc.priorityClass})`);
  assert(ehc.priorityClassStatedAs === "senior unsecured",
    "[9d] and the words shown are the heading that actually named the class, not the one that happened to come first");

  // CHS: the heading names a class no specific pattern matches, and the RANK
  // it fell back to inverted the company's own capital structure on screen.
  const chsSenior = classifyInstrument({ headings: [null, "senior-priority secured"], instrumentName: "6 % Senior Secured Notes due 2029" });
  const chsJunior = classifyInstrument({ headings: [null, "junior-priority secured"], instrumentName: "6 ⅞% Junior-Priority Secured Notes due 2029" });
  assert(chsSenior.priorityClass === "senior-secured",
    `[9e] CHS'S HEADING LEFT THE SECURITY HALF UNSTATED. "senior-priority secured" matches no specific pattern and fell to bare \`senior\` — ranking it below every unsecured note in the book. Its rows' own names say "Senior Secured Notes", which supplies exactly the half the heading did not, and that is what the cross-source refinement is for (got ${chsSenior.priorityClass})`);
  // SEPARATE, PRE-EXISTING, AND DELIBERATELY NOT FIXED HERE. With the
  // refinement applied, CHS's senior-priority notes are `senior-secured`
  // (rank 3) and its junior-priority notes are `junior-priority-secured`
  // (rank 2), so the ladder STILL renders junior above senior — because
  // PRIORITY_CLASSES itself orders junior-priority-secured above
  // senior-secured. That is an ordering defect in the stack, not in the
  // merge, and folding an unrelated fix into a targeted change is how a
  // targeted change stops being reviewable. Recorded here so it is not lost.
  assert(priorityRank(chsJunior.priorityClass) < priorityRank(chsSenior.priorityClass),
    `[9e-known] KNOWN DEFECT, ASSERTED AS-IS: PRIORITY_CLASSES ranks junior-priority-secured (${priorityRank(chsJunior.priorityClass)}) ABOVE senior-secured (${priorityRank(chsSenior.priorityClass)}), so CHS's ladder renders its junior-priority tranches first. A junior lien on the same collateral ranks BELOW a senior one; the stack order is wrong and this assertion pins the wrong behaviour so that fixing it breaks loudly here rather than silently re-ordering a ladder. Its own item, not this change's`);
  assert(chsSenior.priorityClassStatedAs === "senior-priority secured",
    `[9f] AND THE REFINEMENT CHANGES THE RANK, NEVER THE WORDS. CHS keeps its own capital-structure term on screen: "senior-priority secured" is not the same claim as "senior secured" and must not be replaced by it (Rule 32) — got "${chsSenior.priorityClassStatedAs}"`);

  // The refinement is not a licence to override.
  const noOverride = classifyInstrument({ headings: ["Senior secured first lien notes"], instrumentName: "4.625% Senior Secured Notes due 2029" });
  assert(noOverride.priorityClass === "first-lien",
    "[9g] a lower-priority source may only refine a BARE `senior`, never override a class already stated specifically — first-lien is not downgraded to senior-secured by the row's own name. SYNTHETIC");

  const bothNone = classifyInstrument({ headings: ["Long-term debt", "Bonds payable"], instrumentName: "Other" });
  assert(bothNone.priorityClass === null,
    "[9h] and headings that name no class between them still class nothing — merging widens the SOURCES, never the readings");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
