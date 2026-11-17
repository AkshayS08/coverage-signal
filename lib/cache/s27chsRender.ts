/**
 * SESSION 27 (Nov 16): RE-RENDER A REFRESH CARD AT $0 from the input and facts its billed run kept (no model, no cache
 * write): the pipeline's own buildCard call (buildFor.ts), then its visible diff against production's card.
 *
 *   ANTHROPIC_API_KEY="" npx tsx lib/cache/s27chsRender.ts --dir=sessions/27/chs_refresh_v3
 *
 * The badge's stability (3 of 3 samples) is the billed run's, recorded in its diff.md; the card's own checks and the
 * facts' validity are recomputed here.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildCard } from "../cards/build";
import { factsValidFor } from "../cards/factsValidity";
import { decideBadge } from "../pipeline/badge";
import { visibleDiff } from "./s27cardDiff";

const DIR = (process.argv.find((a) => a.startsWith("--dir=")) ?? "").slice(6);
if (!DIR) { console.error("pass --dir=<the billed run's folder>"); process.exit(1); }
if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY="" so nothing can bill'); process.exit(1); }
const input = JSON.parse(readFileSync(`${DIR}/input.json`, "utf-8"));
const facts = JSON.parse(readFileSync(`${DIR}/facts.json`, "utf-8"));
const briefDate = "2026-11-16";
const weekFrom = new Date(Date.parse(`${briefDate}T00:00:00Z`) - 6 * 864e5).toISOString().slice(0, 10);
const weekFilings = (input.laterFilings ?? []).filter((f: any) => f.filingDate >= weekFrom && f.filingDate <= briefDate).map((f: any) => ({ form: f.form, filingDate: f.filingDate, items: f.items ?? "", primaryDocUrl: f.url, accessionNumber: "", reportDate: "", primaryDocument: "" }));
const card = buildCard({ result: input.result, briefDate, previousBrief: null, weekFilings, cash: input.cash, textByUrl: new Map(Object.entries(input.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: input.periodSentence, laterUrls: (input.laterFilings ?? []).filter((x: any) => x.filingDate <= briefDate).map((x: any) => x.url), facts });
const anchorUrl = input.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.url;
const bd = decideBadge({ stoppedAt: null, goldenReproduces: false, cardChecksFailed: card.v3?.checks === "failed", failures: [], samplesReproducing: 3, samples: 3, factsRead: factsValidFor(facts, input.result, anchorUrl) });
writeFileSync(`${DIR}/card.json`, JSON.stringify(card, null, 1) + "\n");
const prod = JSON.parse(readFileSync(`lib/cards/generated/${input.cik}.json`, "utf-8"));
writeFileSync(`${DIR}/diff.md`, [`# ${input.company}: the refresh card against production's card`, ``, `Re-rendered at $0 from this run's input and facts (lib/cache/s27chsRender.ts). Badge: **${bd.badge}** — ${bd.reasons.join("; ")} (stability: the billed run's 3 of 3).`, ``, ...visibleDiff(prod, card)].join("\n") + "\n");
console.log(`${bd.badge}: ${bd.reasons.join("; ")}. Wrote ${DIR}/card.json and diff.md.`);
