/**
 * SESSION 22, STAGE 5 — WHERE THE SEVEN HONEST NAMES ACTUALLY STAND. $0.
 *
 * Five items, measured before any of them is changed:
 *
 *   1 FACILITY MATURITY   every facility's stated maturity, and whether the
 *                         LADDER ROW for that facility carries it. Centene's
 *                         term loan is the named case: the facility states
 *                         March 5, 2030 and the ladder row states nothing, so
 *                         the strongest refi conversation on the book cannot
 *                         card.
 *   2 LIQUIDITY           the derived line as it reads today — juxtaposed or
 *                         computed.
 *   3 REVOLVER SEMANTICS  does any card's reason rest on a DRAWN balance.
 *   4 WHY-NOW             what each card's why-now actually cites.
 *   5 AT-MATURITY         filings whose retirement language says "at
 *                         maturity", against what the refi-pattern line says.
 *
 * Counting first, because "the seven names gain their real cards" is a claim
 * about a number that nobody has yet counted.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, parseMoneyAmount, matchFacility } from "../events/position";
import { buildDerivedLines } from "../events/derived";
import { buildEvents } from "../events/buildEvents";
import { isWithinMonths } from "../events/eventTiming";
import { REFI_WINDOW_MONTHS } from "../events/eligibility";

const BOOK = process.argv.slice(2).length ? process.argv.slice(2) : [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

const one = (s: string, n = 140) => s.replace(/\s+/g, " ").trim().slice(0, n);
/** The closed grammatical class Stage 5 item 5 names. */
const AT_MATURITY_RE = /\b(?:at|upon|on)\s+(?:its\s+|their\s+|the\s+)?maturit(?:y|ies)\b|\bwhen\s+due\b|\bat\s+scheduled\s+maturity\b/i;

(async () => {
  let facTotal = 0, facWithMaturity = 0, facRowCarries = 0, facInWindow = 0;
  const gaps: string[] = [];

  for (const company of BOOK) {
    const result = await runAgentLoop(company);
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    const pos = assemblePosition(result, PINNED_AS_OF);
    const facilities = dm?.facilities ?? [];

    console.log(`\n${"=".repeat(104)}\n${result.company}\n${"=".repeat(104)}`);

    // ---- 1. FACILITY MATURITY, AND WHETHER THE LADDER ROW HAS IT
    console.log(`  FACILITIES: ${facilities.length}`);
    for (const f of facilities) {
      facTotal++;
      const stated = f.maturity?.value ?? null;
      if (stated) facWithMaturity++;
      // THE ROW THE POSITION ITSELF MATCHED, not a second copy of the
      // matching rule. A harness that re-implements the thing it is auditing
      // measures its own copy — which is exactly how the first version of
      // this audit reported "NO MATCHING ROW" for facilities the position
      // had matched perfectly well.
      const row = pos.rows.find((r) => r.maturityFromFacility?.facility === f.name)
        ?? pos.rows.find((r) => matchFacility({ name: r.instrument, category: null }, [f], { byNameOnly: true }) !== null);
      const rowHas = !!row?.maturityDate;
      if (rowHas) facRowCarries++;
      const inWindow = row?.maturityDate ? isWithinMonths(row.maturityDate, PINNED_AS_OF, REFI_WINDOW_MONTHS) : false;
      if (inWindow) facInWindow++;
      console.log(`    ${f.name.slice(0, 46).padEnd(48)} [${f.category}]`);
      console.log(`        facility states maturity: ${stated ?? "— none —"}`);
      console.log(`        ladder row             : ${row ? `"${row.instrument.slice(0, 40)}" maturity=${row.maturityDate ?? "NONE"}` : "NO MATCHING ROW"}`);
      if (stated && !rowHas) {
        gaps.push(`${company}: "${f.name}" — facility states ${stated}, ladder row states none`);
        console.log(`        >>> GAP: the facility states a maturity and the ladder row does not carry it`);
      }
    }

    // ---- 2/3. THE DERIVED LINES, AS THEY READ TODAY
    const ndiTrigger = result.results.find((t) => t.triggerId === "new-debt-issuance");
    const cards = buildEvents([result], PINNED_AS_OF).flashCardCandidates
      .filter((c) => c.headlineTrigger.triggerId === "debt-maturity");
    for (const card of cards) {
      const row = pos.rows.find((r) => r.id === card.headlineRowId);
      const block = buildDerivedLines({ card, position: pos, debtMaturity: dm, newDebtIssuance: ndiTrigger, cashBalance: result.results.find((t) => t.triggerId === "large-cash-balance"), asOf: PINNED_AS_OF });
      console.log(`\n    CARD: ${(row?.instrument ?? "(no row)").slice(0, 52)}  (${row?.maturityDate ?? "?"})`);
      for (const line of block.lines) {
        console.log(`      [${line.kind}] ${one(line.text)}`);
        if (line.kind === "liquidity" && /side by side|beside/i.test(line.text)) {
          console.log(`        >>> JUXTAPOSED, not computed (item 2)`);
        }
        if (/drawn/i.test(line.text) && line.kind === "refi-pattern") {
          console.log(`        >>> A DRAWN BALANCE IN A REFI LINE (item 3)`);
        }
      }
    }

    // ---- 5. AT-MATURITY LANGUAGE IN THIS FILER'S OWN RETIREMENT TEXT
    const ndi = result.results.find((t) => t.triggerId === "new-debt-issuance");
    const texts = [
      ...(ndi?.redeems ?? []).map((c) => c.sourceLine ?? ""),
      ...(dm?.noteRetirements ?? []).map((n) => n.sourceLine),
      ...(ndi?.proceedsUses ?? []).map((u) => u.sourceLine),
    ].filter(Boolean);
    const atMaturity = texts.filter((t) => AT_MATURITY_RE.test(t));
    if (atMaturity.length) {
      console.log(`\n    AT-MATURITY LANGUAGE: ${atMaturity.length} sentence(s)`);
      for (const t of atMaturity) console.log(`      "${one(t, 150)}"`);
    }
  }

  console.log(`\n${"=".repeat(104)}\nSTAGE 5 BASELINE\n${"=".repeat(104)}`);
  console.log(`  facilities: ${facTotal}`);
  console.log(`  ...stating a maturity:            ${facWithMaturity}`);
  console.log(`  ...whose LADDER ROW carries it:   ${facRowCarries}`);
  console.log(`  ...in the ${REFI_WINDOW_MONTHS}-month window today:     ${facInWindow}`);
  console.log(`\n  GAPS — facility states a maturity, ladder row does not: ${gaps.length}`);
  for (const g of gaps) console.log(`    ${g}`);
})();
