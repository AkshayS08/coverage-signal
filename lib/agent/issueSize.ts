/**
 * SESSION 19 — AN ISSUE SIZE IN A NAME IS A NAME, NOT A BALANCE.
 *
 * Filings routinely name a tranche by the size it was issued at: "$2,500
 * million 4.25% Senior Notes due December 15, 2027" is the NAME of a note
 * whose outstanding balance that same row reports as $1,067 million. The
 * two figures are different facts and only one of them is a position.
 *
 * The render side already knew this (portfolioTable.ts split the issue size
 * off a tranche's display name so a card would not read the wrong number
 * aloud). The extraction side did not, and that asymmetry cost a whole
 * company: UHS's amounts corroborated by VALUE against the issue size
 * printed in each row's own label, inside a table that was not a debt
 * schedule at all, so five interest-expense rows verified as balances.
 *
 * One definition, two callers — the same rule the position layer already
 * states for row identity.
 */

/**
 * Splits a leading issue size off an instrument name. Returns
 * `{ issueSize: null, name: <input> }` when the name does not begin with
 * one, which is the common case.
 */
export function splitIssueSizeFromName(instrument: string): { issueSize: string | null; name: string } {
  const m = instrument.match(/^\s*(\$\s?[\d,.]+\s*(?:thousand|thousands|million|millions|billion|billions)?)\s*,?\s*(.+)$/i);
  if (!m || !m[2].trim()) return { issueSize: null, name: instrument };
  // The remainder has to BE an instrument name. Without this, "$500 million"
  // splits into "$500" + "million": the regex backtracks off the magnitude
  // word to leave `(.+)` something to match. Harmless while this only styled
  // a display name; not harmless now that a balance must corroborate against
  // the remainder, because "million" carries no figure and every amount on
  // such a row would fail.
  const remainder = m[2].trim();
  if (/^(?:thousand|thousands|million|millions|billion|billions)$/i.test(remainder)) return { issueSize: null, name: instrument };
  return { issueSize: m[1].trim(), name: remainder };
}

/**
 * The text of a verified line with any leading issue size removed — what a
 * balance must corroborate against. If a row's only money is the size in its
 * own name, this returns text with no money in it, and the amount falls
 * through to the positional/digit-group check instead of being waved
 * through by value equality against the row's own title.
 */
export function textOutsideInstrumentLabel(verifiedText: string): string {
  return splitIssueSizeFromName(verifiedText).name;
}
