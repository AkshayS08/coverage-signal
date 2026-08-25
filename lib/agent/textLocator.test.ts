/**
 * Session 18 (post-v16) golden tests — createTextLocator and the
 * currency-glyph tolerance.
 *
 * The invariant under test is ALIGNMENT. normalizeForMatch (used on the
 * needle) and normalizeWithMap (used on the haystack, and the source of raw
 * offsets) are two separate implementations of the same normalization. If
 * they ever disagree by a single character, createTextLocator returns a
 * position that is silently wrong, and every scale declaration read from
 * that position is read from the wrong place — a worse failure than the
 * missed matches the currency tolerance was added to fix.
 *
 * Run: npx tsx lib/agent/textLocator.test.ts
 */
import { createTextLocator, quoteAppearsIn, verifyClaim } from "./verifyQuote";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

console.log("=== createTextLocator / currency tolerance ===\n");

/** Tenet's real note text, verbatim shape: "$" on the section's first row only. */
const TENET = "Senior unsecured notes:     6.125 % due 2028 $ 1,750   $ 1,750   6.875 % due 2031 362   362   Senior secured first lien notes:     5.125 % due 2027 1,500   1,500   4.250 % due 2029 1,400   1,400";

// ============================================================================
// 1. THE REGRESSION CASE — the model's "$ "-normalized row now locates.
// ============================================================================
{
  const loc = createTextLocator(TENET);
  const at = loc.find("5.125 % due 2027 $ 1,500");
  assert(at !== null, `[1a] the model's "$ "-inserted row now LOCATES in text that prints no "$" on that row (got ${at})`);
  assert(at !== null && TENET.slice(at).startsWith("5.125"), `[1b] and the returned RAW offset points at the row's real start (got ${JSON.stringify(TENET.slice(at ?? 0, (at ?? 0) + 24))})`);
  assert(quoteAppearsIn("5.125 % due 2027 $ 1,500", TENET), "[1c] quoteAppearsIn agrees — one normalization, not two behaviours");
}

// --- The row that DOES print "$" still works, in both directions. ---
{
  const loc = createTextLocator(TENET);
  assert(loc.find("6.125 % due 2028 $ 1,750") !== null, "[2a] a row whose filing text really does carry '$' still locates");
  assert(loc.find("6.125 % due 2028 1,750") !== null, "[2b] ...and so does the same row quoted WITHOUT the '$' — tolerance runs both ways");
}

// ============================================================================
// 2. ALIGNMENT — the invariant. Every offset must point where it claims.
// ============================================================================
{
  // Cases chosen to hit the exact collapse hazard: a glyph between spaces,
  // a glyph flush against text, a glyph alone, runs of several.
  const CASES = [
    "a $ b",
    "a $b",
    "a$ b",
    "a$b",
    "total   $  1,750   next",
    "US$5 and £ 10 and € 3",
    "  $  leading",
    "trailing $  ",
    "6.125 % due 2028 $ 1,750   $ 1,750",
    "no glyphs here at all",
  ];
  let allAligned = true;
  for (const text of CASES) {
    const loc = createTextLocator(text);
    // Every substring of the ORIGINAL that survives normalization must be
    // findable, and its reported offset must land inside the original.
    const words = text.split(/\s+/).filter((w) => w.replace(/[$£€¥]/g, "").length > 0);
    for (const w of words) {
      const at = loc.find(w);
      if (at === null) { allAligned = false; console.error(`      misaligned: ${JSON.stringify(w)} not found in ${JSON.stringify(text)}`); continue; }
      if (at < 0 || at >= text.length) { allAligned = false; console.error(`      out of range: ${JSON.stringify(w)} -> ${at} in ${JSON.stringify(text)}`); }
    }
  }
  assert(allAligned, "[3] every word of every glyph-hazard case locates at an in-range raw offset");
}

// --- The specific hazard that motivated the combined run: a glyph BETWEEN
// two whitespace runs must collapse to exactly one space, matching
// normalizeForMatch, or all following offsets skew. ---
{
  const text = "alpha $ omega";
  const loc = createTextLocator(text);
  const at = loc.find("alpha omega");
  assert(at === 0, `[4a] "alpha $ omega" matches the needle "alpha omega" at offset 0 (got ${at})`);
  const om = createTextLocator(text).find("omega");
  assert(om !== null && text.slice(om) === "omega", `[4b] and "omega" still resolves to its true raw offset ${om} (got ${JSON.stringify(text.slice(om ?? 0))})`);
}

// ============================================================================
// 3. WHAT MUST STILL FAIL — tolerance is not permissiveness.
// ============================================================================
{
  const loc = createTextLocator(TENET);
  assert(loc.find("9.999 % due 2044 $ 1,500") === null, "[5a] a fabricated row is still NOT found — the glyph rule doesn't loosen the digits");
  assert(loc.find("5.125 % due 2027 $ 9,999") === null, "[5b] a real row with a fabricated amount is still NOT found");
  assert(loc.find("") === null, "[5c] an empty needle never matches");
}

// --- A currency glyph alone carries no identity, so a needle made only of
// glyphs must not match everything. ---
assert(createTextLocator(TENET).find("$") === null, "[6] a bare '$' needle normalizes to nothing and matches nothing");

// ============================================================================
// 4. VULGAR FRACTION ↔ DECIMAL EQUIVALENCE (Session 18, post-stage-1).
//
// CHS's real 10-Q shape: the table prints fractions, the model returns
// decimals, and the row dropped carrying an amount that was exactly right.
// ============================================================================
/** CHS's real note text, verbatim, fraction glyphs and all. */
const CHS = "6 ⅞% Senior Notes due 2028 $ 42 $ 42 6 % Senior Secured Notes due 2029 644 644 5 ¼% Senior Secured Notes due 2030 1,535 1,535 4 ¾% Senior Secured Notes due 2031 689 1,058 10 ⅞% Senior Secured Notes due 2032 1,549 2,003";

{
  const loc = createTextLocator(CHS);
  assert(loc.find("4.750% Senior Secured Notes due 2031 689") !== null, "[7a] the model's decimal row locates in a filing that prints '4 ¾%'");
  assert(loc.find("10.875% Senior Secured Notes due 2032 1,549") !== null, "[7b] a two-digit integer part binds to its fraction ('10 ⅞%' -> 10.875)");
  assert(quoteAppearsIn("5.250% Senior Secured Notes due 2030 1,535", CHS), "[7c] quoteAppearsIn agrees on the fraction rule too");
  const at = loc.find("4.750% Senior Secured Notes due 2031 689");
  assert(at !== null && CHS.slice(at).startsWith("4 ¾%"), `[7d] and the RAW offset points at the real row start, unskewed by the 1-char->3-char expansion (got ${JSON.stringify(CHS.slice(at ?? 0, (at ?? 0) + 12))})`);
}

// --- Both directions: a filing printing decimals matches a fraction needle.
// Deliberately spelled with the SAME spacing on both sides, so this asserts
// the fraction rule and nothing else. Whitespace around "%" is a separate
// variance the normalizer still preserves (one space stays one space); see
// [8c], which pins that as known and currently costless rather than
// quietly folding a second rule in under cover of this one. ---
{
  const decimalFiling = "4.750% Senior Secured Notes due 2031 689";
  assert(quoteAppearsIn("4 ¾% Senior Secured Notes due 2031 689", decimalFiling), "[8a] tolerance runs the other way — a fraction-spelled needle finds a decimal-printed row");
  assert(quoteAppearsIn("10 ⅞% Senior Secured Notes due 2032 1,549", "10.875% Senior Secured Notes due 2032 1,549"), "[8b] ...including a two-digit integer part");
  assert(!quoteAppearsIn("5 ¼% Senior Secured Notes", "5¼ % Senior Secured Notes"), "[8c] KNOWN GAP, pinned: a space moved from before the glyph to after it still misses — the 10-K's '5¼ %' spelling against the 10-Q's '5 ¼%'. Costs zero drops today (every row it could affect fails on its amount, not its rate); if that changes, this assertion flips and says so.");
}

// --- Trailing zeros alone, with no fraction involved. ---
{
  assert(quoteAppearsIn("5.00 % Senior Notes", "5.000 % Senior Notes"), "[9a] '5.00' matches '5.000' — trailing zeros carry no value");
  assert(quoteAppearsIn("$ 1,750.00", "$ 1,750"), "[9b] '1,750.00' matches '1,750'");
  assert(quoteAppearsIn("2.80 % Senior Notes due June 2031", "2.8 % Senior Notes due June 2031"), "[9c] and it converges from both sides");
}

// --- A YEAR HAS NO DECIMAL POINT and must never be touched by the
// trailing-zero rule. A maturity silently becoming "203" would be far worse
// than the drop this rule exists to fix. ---
{
  const loc = createTextLocator(CHS);
  assert(loc.find("due 2030 1,535") !== null, "[10a] a bare year is emitted exactly as printed");
  assert(loc.find("due 203 1,535") === null, "[10b] ...and is NOT truncated by the trailing-zero rule");
  assert(loc.find("1,058") !== null && loc.find("1,58") === null, "[10c] a grouped amount with no decimal point is untouched");
}

// --- Only TERMINATING fractions fold. A third would have to be rounded, and
// rounding invents precision the filing never stated. ---
{
  assert(!quoteAppearsIn("5.333% Notes", "5 ⅓% Notes"), "[11] a non-terminating fraction is left alone rather than rounded into a false match");
}

// --- Tolerance is still not permissiveness. ---
{
  const loc = createTextLocator(CHS);
  assert(loc.find("4.500% Senior Secured Notes due 2031 689") === null, "[12a] '4 ¾%' does NOT match a claimed 4.500% — the rule folds notation, not values");
  assert(loc.find("4.750% Senior Secured Notes due 2031 690") === null, "[12b] a real fraction row with a fabricated amount is still NOT found");
  assert(loc.find("4.750% Senior Secured Notes due 2031 1,000") === null, "[12c] and the CHS phantom figure finds nothing");
}

// ============================================================================
// 5. A2 — CO-OCCURRENCE MUST CARRY THE AMOUNT, NOT JUST THE CAPTION.
//
// CHS's real shape. `extractFactTokens` does not read a trailing bare table
// figure as money, so "6.875% Junior-Priority Secured Notes due 2029 350"
// tokenizes to a rate and a year and nothing else. Co-occurrence then asked
// only whether a 6.875% and a 2029 sit near each other beside one of the
// claim's own words — which every real mention of that instrument satisfies,
// anywhere in the filing. Two rows verified exactly this way, claiming $350M
// and $400M against real balances of $1,244M and $1,227M.
// ============================================================================
{
  // CHS's real 10-K shape, and the reason co-occurrence had anything to bite
  // on at all: the TABLE prints the coupon as a fraction, while the narrative
  // beside it spells the same coupon as a decimal. The model's decimal row
  // therefore co-occurs with the PROSE mention, not with the table row it
  // claims to be transcribing.
  const CHS_10K =
    "The 6⅞% Junior-Priority Secured Notes due 2029 bear interest at a rate of 6.875 % per annum. " +
    "6⅞ % Junior-Priority Secured Notes due 2029 1,244 1,244 6⅛ % Junior-Priority Secured Notes due 2030 1,227 1,227 ABL Facility — 341";
  const FABRICATED = "6.875% Junior-Priority Secured Notes due 2029 350";
  const REAL = "6.875% Junior-Priority Secured Notes due 2029 1,244";

  assert(verifyClaim(FABRICATED, [CHS_10K]).verified, "[13a] precondition — with no amount required, the fabricated row VERIFIES on caption co-occurrence alone. This is the bug.");
  assert(!verifyClaim(FABRICATED, [CHS_10K], { requireAmount: "$ 350 million" }).verified, "[13b] ...and with its own amount required it is REJECTED — 350 is not printed beside that instrument");
  const real = verifyClaim(REAL, [CHS_10K], { requireAmount: "$ 1,244 million" });
  assert(real.verified, "[13c] REVERSE: the SAME instrument with its REAL balance still verifies — the rule folds fabrication, not the fallback");
  assert(real.matchType === "co-occurrence", `[13d] ...and still via co-occurrence, so the fallback keeps doing its job (got ${real.matchType})`);
}

// --- The amount requirement must not bite a claim with nothing
// discriminating to test: a 2-digit figure occurs in every filing, and
// demanding it would invent failures rather than catch them. ---
{
  const TEXT = "Deferred debt issuance costs ( 31 ) Total $ 3,769";
  assert(
    verifyClaim("Deferred debt issuance costs ( 31 )", [TEXT], { requireAmount: "( 31 ) million" }).verified,
    "[14] a claim whose only figure is 2-digit is passed through — the check abstains rather than guessing"
  );
}

// ============================================================================
// 6. A1 — THE MATCHED SPAN IS OCCURRENCE-AWARE.
//
// A filing prints the same caption twice — once on the balance sheet, once in
// the debt note. Taking the FIRST occurrence resolved correctly-transcribed
// note rows to a position outside the note, where A1's note bound then
// rejected them. Measured live before this fix: one real subtotal lost each
// on Centene, Encompass and Molina, and UHS's walk pushed from a clean tie to
// a 24% miss. Same bug lib/fetch/scheduleCompleteness.ts already fixed for
// itself, same remedy.
// ============================================================================
{
  const TEXT = "CONDENSED CONSOLIDATED BALANCE SHEETS Long-term debt $ 16,030 Total liabilities" + " ".repeat(50) + "8. Debt Long-term debt $ 16,030 Total debt";
  const noteStart = TEXT.indexOf("8. Debt");

  const plain = verifyClaim("Long-term debt $ 16,030", [TEXT]);
  assert(plain.sourceSpan !== null && plain.sourceSpan.start < noteStart, "[15a] precondition — with no preference the match resolves to the BALANCE-SHEET occurrence, outside the note");

  const preferred = verifyClaim("Long-term debt $ 16,030", [TEXT], { preferWithin: [{ start: noteStart, end: TEXT.length }] });
  assert(preferred.sourceSpan !== null && preferred.sourceSpan.start >= noteStart, "[15b] ...and with the note preferred it resolves to the IN-NOTE occurrence");

  const absent = verifyClaim("Long-term debt $ 16,030", [TEXT], { preferWithin: [{ start: 999999, end: 1000000 }] });
  assert(absent.verified && absent.sourceSpan !== null, "[15c] preference is never a filter — with no occurrence in range the first is still returned, rather than failing");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`); process.exit(1); }
else console.log("\nALL TEXT-LOCATOR GOLDEN TESTS PASSED");
