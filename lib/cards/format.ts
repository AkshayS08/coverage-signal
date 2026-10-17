/**
 * CARD DISPLAY FORMS — one standard form per kind of value (card_spec 3.3).
 * Verification always runs on the as-printed value; these only render.
 */
import type { DateGranularity } from "../agent/claude";

import { parseMoneyAmount } from "../events/position";


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

/**
 * CARD_SPEC v2.0 §3.3 — EVERY AMOUNT IN $MM, AT THE SOURCE'S OWN PRECISION.
 *
 * "$13,333MM", "$1,450MM", "$396.9MM". Decimals only where the source carries
 * them, or one where a thousands figure converts ("$188,482 thousand" →
 * "$188.5MM"); billions convert in code ("$1.900 billion" → "$1,900MM").
 * Never rounded beyond the source: "$1,549 million" is never "$1.5B". The
 * printed form is what verification reads; this is display only.
 */
export function mmDecimals(printed: string): number {
  const dec = ((/[\d,]+\.(\d+)/.exec(printed) ?? [])[1] ?? "").length;
  if (/thousand/i.test(printed)) return 1;
  if (/billion/i.test(printed)) return Math.max(0, dec - 3);
  return dec;
}

export function formatMM(usd: number, decimals = 0): string {
  // v2.1 §3.3: a decimal shows only where it is non-zero — "$2,750MM", never "$2,750.0MM".
  const body = (Math.abs(usd) / 1e6).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return usd < 0 ? `($${body}MM)` : `$${body}MM`;
}

/**
 * The hedge the filer put on THIS figure: "~" for approximately, "<" for less
 * than. A hedge governs only the figure it qualifies — "approximately $ 751
 * million … the $ 32 million of outstanding letters of credit" hedges the 751
 * and not the 32.
 */
export function hedgeMark(sentence: string, printed: string): "" | "~" | "<" {
  const want = parseMoneyAmount(printed);
  const digits = (printed.match(/[\d,]+(?:\.\d+)?/) ?? [""])[0];
  for (const m of sentence.matchAll(/\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|thousand))?/gi)) {
    const v = parseMoneyAmount(m[0]);
    const same = (want !== null && v !== null && Math.abs(v - want) < 1) || (digits && m[0].includes(digits));
    if (!same) continue;
    const before = sentence.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    if (/(?:approximately|about|approx\.?|roughly|nearly|an estimated)\s*\$?\s*$/i.test(before)) return "~";
    if (/(?:less than|fewer than|under)\s*\$?\s*$/i.test(before)) return "<";
  }
  return "";
}
export const hedgedIn = (sentence: string, printed: string) => hedgeMark(sentence, printed) !== "";

/** An amount as the card shows it. A stated absence is "$0", never "nil", and is never hedged. */
export function displayAmount(printed: string, sentence: string, scaledUsd?: number | null): string {
  const usd = scaledUsd ?? parseMoneyAmount(printed);
  if (usd === null) return printed.trim();
  if (usd === 0 || /^\s*\$?\s*[—–-]\s*$/.test(printed)) return "$0";
  return `${hedgeMark(sentence, printed)}${formatMM(usd, mmDecimals(printed))}`;
}

/** A computed figure: $MM at the finest precision any of its parts carries. */
export function displayUsd(usd: number, hedged = false, decimals = 0): string {
  return `${hedged ? "~" : ""}${formatMM(usd, decimals)}`;
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
