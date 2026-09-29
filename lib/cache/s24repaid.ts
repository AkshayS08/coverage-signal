/**
 * WHAT IS LABELLED `repaid`, AND WHAT SITS AT NIL? $0, book-wide.
 *
 * Rule 60's facility half shipped: a committed facility at zero is undrawn
 * capacity. Its other half was held, and is now ruled — a NON-facility tranche
 * at nil belongs to the events layer as a repayment, never to the ladder as a
 * $0 row labelled repaid.
 *
 * Before changing the status vocabulary, the book is asked what actually
 * carries it (Rule 63: enumerate, do not assume). Three separate questions,
 * because "no row says repaid" would not settle any of the others:
 *   - which rows carry status `repaid`
 *   - which rows sit at a nil amount under ANY status
 *   - which of those have a PRIOR-PERIOD balance beside them, which is what
 *     makes a nil a repayment rather than a line that was always empty
 *
 * Run: npx tsx lib/cache/s24repaid.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, parseMoneyAmount, isCommittedFacility } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

(async () => {
  let spend = 0;
  const repaid: string[] = [], nils: string[] = [];

  for (const company of ALL) {
    const r = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(r, PINNED_AS_OF);
    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const prior = ((dm?.priorScheduleSequence ?? []) as Record<string, unknown>[]);

    for (const row of pos.rows) {
      const status = String((row as unknown as { status?: string }).status ?? "—");
      const nil = parseMoneyAmount(row.amount) === 0 || /^\s*\$?\s*[—–-]\s*$/.test(row.amount);
      if (status === "repaid") repaid.push(`${company} — ${row.instrument} | ${row.amount} | capacity=${row.isCapacity} | type=${row.classification.instrumentType ?? "none"}`);
      if (!nil) continue;
      // Does the PRIOR period state a balance for it? That is what turns a nil
      // into a repayment rather than a line that never carried anything.
      const priorMatch = prior.find((e) => String(e.instrument ?? e.label ?? "").trim() === row.instrument.trim());
      const priorAmount = priorMatch ? String(priorMatch.amount ?? "—") : null;
      nils.push(
        `${company} — ${row.instrument}\n      amount ${row.amount} · status ${status} · capacity=${row.isCapacity} · ` +
        `type=${row.classification.instrumentType ?? "none"} · committedFacility=${isCommittedFacility(row.classification.instrumentType)}\n` +
        `      prior period: ${priorAmount === null ? "no matching prior entry" : priorAmount}`
      );
    }
  }

  console.log(`\n${"=".repeat(104)}\nROWS LABELLED \`repaid\`: ${repaid.length}\n${"=".repeat(104)}`);
  for (const x of repaid) console.log(`  ${x}`);
  if (repaid.length === 0) console.log(`  none — the assertion the ruling asks for already holds on today's book`);

  console.log(`\n${"=".repeat(104)}\nROWS AT A NIL AMOUNT, ANY STATUS: ${nils.length}\n${"=".repeat(104)}`);
  for (const x of nils) console.log(`\n  ${x}`);

  console.log(`\n  SPEND: $${spend.toFixed(4)} — must be $0.0000`);
})();
