/**
 * SESSION 27 (Akshay, Nov 3, 2026) — NO CHECK PASSES ON ZERO ITEMS (Rule 44).
 *
 * Every data-driven set a suite or release check evaluates (names, cards, goldens, samples) goes through nonEmpty.
 * An empty set prints a named FAIL line and exits non-zero: a check over nothing is not a check. (nonEmpty.test.ts)
 */
export function nonEmpty<T = any>(what: string, items: readonly T[] | null | undefined): T[] {
  if (!items || items.length === 0) {
    console.log(`  ✗ FAIL — [vacuous] ${what}: zero items. A check over nothing is not a check (Rule 44).`);
    console.log(`\n0 passed, 1 failed.`);
    process.exit(1);
  }
  return [...items];
}
