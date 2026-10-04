/**
 * CARD DISPLAY FORMS — one standard form per kind of value (card_spec 3.3).
 * Verification always runs on the as-printed value; these only render.
 */
import type { DateGranularity } from "../agent/claude";
import { formatMoneyForDisplay, formatMoneyValue } from "../events/money";
import { parseMoneyAmount } from "../events/position";
import { statesApproximation } from "../events/rollDeltas";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** A maturity at its own precision: "September 15, 2030", "April 2030", "2034". Never finer than stated. */
export function displayDate(date: string, granularity: DateGranularity | null): string {
  const y = date.slice(0, 4);
  if (granularity === "year" || !/^\d{4}-\d{2}/.test(date)) return y;
  const m = MONTHS[Number(date.slice(5, 7)) - 1];
  if (granularity === "month") return `${m} ${y}`;
  return `${m} ${Number(date.slice(8, 10))}, ${y}`;
}

/** Header dates: "Aug 7, 2026". */
export function shortDate(iso: string): string {
  return `${SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
}

/** "Sept 28 to Oct 4, 2026" — the year once where both ends share it. */
export function weekRange(from: string, to: string): string {
  const f = shortDate(from), t = shortDate(to);
  return from.slice(0, 4) === to.slice(0, 4) ? `${f.replace(/, \d{4}$/, "")} to ${t}` : `${f} to ${t}`;
}

/** An amount in the house format, with "~" where the filer hedged THIS figure. */
export function displayAmount(printed: string, sentence: string): string {
  const shown = formatMoneyForDisplay(printed);
  // A stated zero is "nil", the filer's own claim, and is never hedged.
  if (shown === "nil" || shown === "$0") return "nil";
  return hedgedIn(sentence, printed) && shown.startsWith("$") ? `~${shown}` : shown;
}

/**
 * Did the filer hedge THIS figure? The hedge must govern the figure itself —
 * "approximately $ 751 million … the $ 32 million of outstanding letters of
 * credit" hedges the 751 and not the 32. A sentence-wide test put a "~" on
 * every figure that shared a sentence with one hedged figure.
 */
export function hedgedIn(sentence: string, printed: string): boolean {
  if (!statesApproximation(sentence)) return false;
  const want = parseMoneyAmount(printed);
  const digits = (printed.match(/[\d,]+(?:\.\d+)?/) ?? [""])[0];
  for (const m of sentence.matchAll(/\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|thousand))?/gi)) {
    const v = parseMoneyAmount(m[0]);
    const same = (want !== null && v !== null && Math.abs(v - want) < 1) || (digits && m[0].includes(digits));
    if (!same) continue;
    const before = sentence.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    if (/(approximately|about|approx\.?|roughly|nearly|an estimated)\s*\$?\s*$/i.test(before)) return true;
  }
  return false;
}

export function displayUsd(usd: number, hedged = false): string {
  const shown = formatMoneyValue(usd);
  return hedged && shown.startsWith("$") ? `~${shown}` : shown;
}

/**
 * The filing, opened at the sentence and highlighted (a text fragment). The
 * fragment names the sentence's first and last few words, which spans table
 * cells and inline markup a single quoted string would not.
 */
export function sentenceUrl(url: string, sentence: string): string {
  const words = sentence.replace(/[\s ]+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0 || !url) return url;
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D").replace(/,/g, "%2C").replace(/&/g, "%26");
  if (words.length <= 8) return `${url}#:~:text=${enc(words.join(" "))}`;
  return `${url}#:~:text=${enc(words.slice(0, 5).join(" "))},${enc(words.slice(-4).join(" "))}`;
}

/** Calendar arithmetic: date + n months, clamped to month end (BRD 8.10's convention). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function addDays(iso: string, n: number): string {
  const t = new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
