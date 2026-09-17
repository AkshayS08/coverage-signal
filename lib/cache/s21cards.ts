/**
 * SESSION 21 — THE FOUR CARDS, AS THEY RENDER.
 *
 * Presented the way an RM reads them: the card first, in its own words, then
 * the derived block beneath it, then — for every clause — the verified
 * sentence it draws from, quoted from the filing and located in it.
 *
 * `factsReferencedIn` is the SAME function the narration guard uses to decide
 * whether a clause is explained by a fact, so the provenance shown here is the
 * provenance the guard enforced, not a second opinion about it.
 *
 * Briefings come from captureBookSnapshot — the SAME path the determinism
 * protocol runs — rather than from a key recomputed here. Recomputing the
 * wording-cache key by hand missed on all four cards while the real path hit
 * 1/1 at $0: two ways of deriving one key is the same defect as two fields
 * holding one instrument, and the fix is to have one.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { captureBookSnapshot } from "./bookSnapshot";
import { getFilingText } from "../fetch";
import { buildEvents } from "../events/buildEvents";
import { buildVerifiedFactBase, type VerifiedFact } from "../events/factBase";
import { strictFactTokensMatch, factOwnText } from "../events/numberGuard";
import { extractFactTokens } from "../agent/factTokens";
import { assemblePosition } from "../events/position";
import { buildDerivedLines } from "../events/derived";
import { createTextLocator } from "../agent/verifyQuote";

const ASOF = PINNED_AS_OF;
const BOOK = ["Tenet Healthcare", "Encompass Health", "Quest Diagnostics", "Centene Corporation"];
const one = (s: string, n = 300) => s.replace(/\s+/g, " ").trim().slice(0, n);
const wrap = (s: string, w = 92, pad = "  ") => {
  const words = s.split(" "); const out: string[] = []; let line = "";
  for (const word of words) { if ((line + " " + word).trim().length > w) { out.push(pad + line.trim()); line = word; } else line += " " + word; }
  if (line.trim()) out.push(pad + line.trim());
  return out.join("\n");
};

interface Briefing { source?: string; callAbout?: string; whyNow?: string; keyPoints?: string[]; failureReason?: string }

(async () => {
  const snap = await captureBookSnapshot(BOOK, ASOF);
  const byCompany = new Map<string, { eventBriefings?: { eventId: string; briefing: Briefing }[] }>();
  for (const o of JSON.parse(snap.json) as { company: string; eventBriefings?: { eventId: string; briefing: Briefing }[] }[]) byCompany.set(o.company, o);
  console.log(`
All four read from the snapshot path — ${snap.hitSummary}
`);

  for (const company of BOOK) {
    const result = await runAgentLoop(company);
    const cards = buildEvents([result], ASOF).flashCardCandidates;
    const factBase = buildVerifiedFactBase(result, ASOF);
    const pos = assemblePosition(result, ASOF);
    // The snapshot keys by the INPUT name ("Tenet Healthcare"); result.company
    // is the canonical one ("TENET HEALTHCARE CORP"). Look up by what we asked for.
    const briefings = byCompany.get(company)?.eventBriefings ?? [];

    // Every cited document, so a source sentence can be located wherever it lives.
    const corpus: { url: string; label: string; loc: { find(n: string): number | null } }[] = [];
    const seen = new Map<string, string>();
    for (const t of result.results) for (const c of t.citations) if (c.url && !seen.has(c.url)) seen.set(c.url, `${c.form ?? "filing"} ${c.date ?? ""}`.trim());
    for (const [url, label] of seen) {
      try {
        const raw = await getFilingText(url);
        corpus.push({ url, label, loc: createTextLocator(typeof raw === "string" ? raw : (raw as { text: string }).text) });
      } catch { /* a document we cannot fetch cannot place a line */ }
    }
    const place = (s: string) => {
      for (const d of corpus) { const at = d.loc.find(s); if (at !== null) return `${d.label}, char ${at.toLocaleString("en-US")}`; }
      return "NOT LOCATED — check before relying on this line";
    };

    for (const card of cards) {
      // The snapshot's eventId is company-prefixed where card.id is not, so an
      // exact match finds nothing. Suffix, then the single-card fallback.
      const b = (briefings.find((x) => x.eventId === card.id)
        ?? briefings.find((x) => x.eventId.endsWith(card.id))
        ?? (briefings.length === 1 ? briefings[0] : undefined))?.briefing ?? null;

      console.log("");
      console.log("┌" + "─".repeat(96) + "┐");
      console.log(`│  ${result.company}`.padEnd(97) + "│");
      console.log(`│  ${card.headlineTrigger.triggerName}  ·  ${card.freshnessReason}`.padEnd(97) + "│");
      console.log("└" + "─".repeat(96) + "┘");

      if (!b) { console.log("  (not drafted — the wording cache holds nothing for this card)"); continue; }
      if (b.source === "failed") { console.log(`  ⚠ NARRATION FAILED — ${b.failureReason}`); continue; }

      const clauses: { label: string; text: string }[] = [
        { label: "CALL ABOUT", text: b.callAbout ?? "" },
        { label: "WHY NOW", text: b.whyNow ?? "" },
        ...(b.keyPoints ?? []).map((k, i) => ({ label: `KEY POINT ${i + 1}`, text: k })),
      ];

      for (const c of clauses) {
        console.log("");
        console.log(`  ${c.label}`);
        console.log(wrap(c.text, 92, "    "));
        // PER FIGURE, NOT PER CLAUSE. factsReferencedIn returns every fact
        // sharing ANY token with the clause, so a cash-balance sentence
        // surfaces under a revolver bullet and the reader cannot tell which
        // sentence carries which number. Attribution is resolved token by
        // token: for each figure, rate and date the clause states, the
        // sentence that states it.
        const tokens = extractFactTokens(c.text);
        if (tokens.length === 0) { console.log("      · no figure, rate or date in this clause — nothing to trace"); continue; }
        for (const t of tokens) {
          const all = factBase.filter((f) => extractFactTokens(factOwnText(f)).some((ft) => strictFactTokensMatch(t, ft)));
          if (all.length === 0) { console.log(`      · ${t.raw} — NOT TRACEABLE to any verified fact`); continue; }
          // IDENTITY FIRST, same rule as everywhere else. A token match alone
          // cannot separate two facts stating the same figure — Tenet's
          // 5.125% due 2027 and 5.500% due 2032 are BOTH $1,500 million, and
          // picking the first match attributed the card's own tranche to the
          // other one. The card's headline row wins where it states the
          // figure; the ambiguity is reported when it remains.
          const hits = [...all].sort((a, b) =>
            Number(b.ladderRowId === card.headlineRowId) - Number(a.ladderRowId === card.headlineRowId));
          const f = hits[0];
          const ambiguous = all.length > 1 && f.ladderRowId !== card.headlineRowId;
          const src = f.verifiedText || f.normalizedText;
          console.log(`      · ${t.raw}`);
          console.log(`          "${one(src, 200)}"`);
          console.log(`          ${f.sourceFiling ? `${f.sourceFiling.form} filed ${f.sourceFiling.date}` : "source not recorded"} · ${place(src)}${hits.length > 1 ? `  (+${hits.length - 1} other verified fact${hits.length > 2 ? "s" : ""} state this same figure${ambiguous ? " — NOT resolvable to this card's own tranche" : ""})` : ""}`);
        }
      }

      const block = buildDerivedLines({
        card, position: pos,
        debtMaturity: result.results.find((t) => t.triggerId === "debt-maturity"),
        newDebtIssuance: result.results.find((t) => t.triggerId === "new-debt-issuance"),
        asOf: ASOF,
      });
      console.log("");
      console.log(`  DERIVED  (arithmetic on verified facts, as of ${ASOF.toISOString().slice(0, 10)})`);
      for (const l of block.lines) {
        console.log(`    · ${l.label}: ${l.text}`);
        for (const i of l.inputs) console.log(`         ← "${one(i, 220)}"   ${place(i)}`);
        for (const fi of l.fieldInputs) console.log(`         ← ${fi.value}  (verified field — ${fi.verifiedBy.split("—")[0].trim()})`);
      }
      for (const w of block.withheld) console.log(`    · ${w.kind}: WITHHELD — ${w.unverified.join(", ")} appears in no source sentence behind this line`);
    }
  }
})();
