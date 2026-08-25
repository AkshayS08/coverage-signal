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
import { createTextLocator, quoteAppearsIn } from "./verifyQuote";

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

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`); process.exit(1); }
else console.log("\nALL TEXT-LOCATOR GOLDEN TESTS PASSED");
