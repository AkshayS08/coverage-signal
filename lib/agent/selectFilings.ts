import type { FilingEntry } from "../fetch";

// 8-K item codes that plausibly bear on one of the 15 triggers. Chosen from
// the standard SEC Item list (Item 1.01 Material Agreement, 2.01 Acquisition/
// Disposition, 2.03 New Financial Obligation, 2.04 Accelerated Obligation,
// 1.03 Bankruptcy, 3.02 Unregistered Equity Sale, 7.01/8.01 press releases).
// Everything else (5.02 officer changes, 5.07 vote results, 9.01 exhibits
// only, ...) is routine noise we don't spend a read on by default.
const HIGH_SIGNAL_ITEMS = new Set([
  "1.01",
  "1.02",
  "1.03",
  "2.01",
  "2.03",
  "2.04",
  "2.05",
  "2.06",
  "3.02",
  "7.01",
  "8.01",
]);

function has8KSignal(filing: FilingEntry): boolean {
  if (filing.form !== "8-K" || !filing.items) return false;
  return filing.items.split(",").some((code) => HIGH_SIGNAL_ITEMS.has(code.trim()));
}

/**
 * Picks the filings to read in full for the base classification pass:
 * the 2 most recent 10-Qs (current + prior quarter, so the model sees
 * quarter-over-quarter movement, not just a snapshot), the most recent
 * 10-K (the annual has the full debt schedule, risk factors, and FX/
 * commodity/rate exposure that quarterlies compress or omit), plus up to
 * 6 recent 8-Ks whose item codes suggest an actual event, newest first.
 * Falls back to the newest 8-Ks by date if none carry a high-signal item
 * code (a quiet filing period).
 */
export function selectBaselineFilings(filings: FilingEntry[]): FilingEntry[] {
  const recent10Qs = filings.filter((f) => f.form === "10-Q").slice(0, 2);
  const latest10K = filings.find((f) => f.form === "10-K");

  const eightKs = filings.filter((f) => f.form === "8-K");
  const signalEightKs = eightKs.filter(has8KSignal).slice(0, 6);
  const chosenEightKs = signalEightKs.length > 0 ? signalEightKs : eightKs.slice(0, 3);

  return [...recent10Qs, ...(latest10K ? [latest10K] : []), ...chosenEightKs];
}
