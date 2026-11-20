/**
 * SESSION 27 (Akshay, Nov 20): A FILING THAT WAS READ AND FAILED ITS CHECKS is never "read at the next refresh". It was
 * read: the card says so, and why it stays on the prior position, with the gap (releaseHeader.test F2, F4).
 *
 * Recorded in baselines/failed_reads.json from the failing build's own breakage panel (the trust rule): the filing (the
 * anchor that build read), its period, and the gap its tie missed by, with the share the panel states. Cigna's Nov 5
 * 10-Q: its Sept 30 debt carried forward misses the balance sheet by $194MM (0.62%), over the 0.2% materiality line.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface FailedRead { cik: string; url: string; form: string; filingDate: string; periodEnd: string; gapUsd: number; gapPct: string | null; kind: "tie" }

const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
/** "Nov 5", "Sept 30": a day in the card's short form, without its year. */
const day = (iso: string) => `${SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** The failed read a build records: its anchor, and its breakage panel's gap. Null for a build whose checks held. */
export function failedReadFromCard(card: any, input: any): FailedRead | null {
  const b = card?.v3?.breakage;
  if (!b || card.v3.checks !== "failed") return null;
  const a = input.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling;
  const pct = /\$[\d,.]+MM \((\d+(?:\.\d+)?%)\) not attributed/.exec(txt(b.cause))?.[1] ?? null;
  return { cik: input.cik, url: a.url, form: a.form, filingDate: a.date, periodEnd: a.reportDate, gapUsd: b.gap.usd, gapPct: pct, kind: "tie" };
}

/** The header's line: "Nov 5 10-Q read: its Sept 30 debt doesn't reconcile to the balance sheet ($194MM, 0.62%), so this card stays at June 30." */
export function failedReadLine(fr: FailedRead, servedPeriodEnd: string): string {
  const gap = `$${Math.round(fr.gapUsd / 1e6).toLocaleString("en-US")}MM${fr.gapPct ? `, ${fr.gapPct}` : ""}`;
  return `${day(fr.filingDate)} ${fr.form} read: its ${day(fr.periodEnd)} debt doesn't reconcile to the balance sheet (${gap}), so this card stays at ${day(servedPeriodEnd)}.`;
}

const PATH = (root: string) => join(root, "baselines", "failed_reads.json");
export function loadFailedReads(cik: string, root = process.cwd()): FailedRead[] {
  if (!existsSync(PATH(root))) return [];
  return (JSON.parse(readFileSync(PATH(root), "utf-8")).reads as FailedRead[]).filter((r) => r.cik === cik);
}
/** Record a failed read (idempotent by filing). */
export function recordFailedRead(fr: FailedRead, root = process.cwd()): void {
  const reg = existsSync(PATH(root)) ? JSON.parse(readFileSync(PATH(root), "utf-8")) : { reads: [] as FailedRead[] };
  reg.reads = [...reg.reads.filter((r: FailedRead) => r.url !== fr.url), fr];
  writeFileSync(PATH(root), JSON.stringify(reg, null, 1) + "\n");
}
