/**
 * SESSION 27 (Akshay, Nov 1, 2026) — RETIREMENTS MUST BALANCE.
 *
 * For each instrument, the retirements a card states between two positions
 * equal the change in outstanding face the filer's own table prints (its
 * prior period-end column to its current column), net of new issuance. A
 * mismatch is a check failure. CHS's 4¾% notes went from $1,057MM to $689MM:
 * a card reading "~$736MM repurchased in 2026 · $689MM remains" fails.
 *
 * Reads what renders: each table row's "X retired / repurchased / redeemed …
 * · Y remains", against the row's two columns in the anchor's table (located
 * by the row's label; scaled by the row's own stated amount).
 */
import { parseMoneyAmount } from "../events/position";

const txt = (l: any[] | undefined) => (l ?? []).map((s: any) => s.t ?? s.printed ?? "").join("");
/** "$736MM", "~$368MM", "$1.25B" → millions. */
const mm = (s: string): number => { const m = /([\d,.]+)\s*(MM|B)/.exec(s); return m ? Number(m[1].replace(/,/g, "")) * (m[2] === "B" ? 1000 : 1) : NaN; };
const STATUS = /([~<]?\$[\d,.]+(?:MM|B))\s+(?:repurchased|retired|redeemed)(?:\s+in\s+\d{4})?\s*·\s*(\$[\d,.]+(?:MM|B))\s+remains/i;

/** The row's two printed columns after its label: [current, prior], as numbers ("—" is zero). */
function columnsAfter(flatText: string, label: string): [number, number] | null {
  const flatLabel = label.replace(/\s+/g, " ").trim();
  for (let at = flatText.indexOf(flatLabel); at >= 0; at = flatText.indexOf(flatLabel, at + 1)) {
    const tail = flatText.slice(at + flatLabel.length, at + flatLabel.length + 80);
    const cells = [...tail.matchAll(/\(?\$?\s*([\d,]+(?:\.\d+)?|—|–)\s*\)?/g)].map((m) => (/^[—–]$/.test(m[1]) ? 0 : Number(m[1].replace(/,/g, "")))).filter((n) => Number.isFinite(n));
    if (cells.length >= 2) return [cells[0], cells[1]];
  }
  return null;
}

export function retirementBalanceViolations(card: any, result: any, textByUrl: Map<string, string>): string[] {
  const dm = result.results.find((t: any) => t.triggerId === "debt-maturity");
  const anchorText = textByUrl.get(dm?.debtScheduleSourceFiling?.url ?? "") ?? "";
  if (!anchorText) return [];
  const flatText = anchorText.replace(/\s+/g, " ");
  const rows = (dm.scheduleSequence ?? []).filter((e: any) => e.kind === "row");
  const out: string[] = [];
  for (const r of card.v3?.table?.rows ?? []) {
    const m = STATUS.exec(txt(r.status?.text));
    if (!m) continue;
    const retired = mm(m[1]), remains = mm(m[2]), hedged = /^[~<]/.test(m[1]);
    const row = rows.find((e: any) => e.label === r.name);
    const cols = row ? columnsAfter(flatText, row.label) : null;
    const currentUsd = row ? parseMoneyAmount(String(row.amount)) : null;
    if (!row || !cols || currentUsd === null || cols[0] === 0) continue;
    const perUnit = currentUsd / cols[0] / 1e6; // millions per printed unit
    const current = cols[0] * perUnit, prior = cols[1] * perUnit;
    const change = prior - current;
    const tol = hedged ? Math.max(2, prior * 0.01) : 0.5;
    if (Math.abs(change - retired) > tol || Math.abs(remains - current) > tol) out.push(`${r.name}: states ${m[1]} retired · ${m[2]} remains, but its table prints $${prior.toLocaleString("en-US")}MM → $${current.toLocaleString("en-US")}MM (a change of $${change.toLocaleString("en-US")}MM)`);
  }
  return out;
}
