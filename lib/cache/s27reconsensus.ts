/**
 * SESSION 27 (Nov 16): RE-RUN VERIFICATION AND CONSENSUS OVER A FACTS RUN'S SAVED RAW ANSWERS, $0 (no client). Keeps the
 * run's read set, anchor and cost; writes the facts file again with what reproduces by identity (factConsensus.ts).
 *
 *   ANTHROPIC_API_KEY="" npx tsx lib/cache/s27reconsensus.ts <input.json> <raw.json> <facts.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { verifyAsk } from "../cards/capture/verifyFacts";
import { reproduceFacts, codeConfirms } from "../cards/capture/factConsensus";
import { scheduleByCode } from "../cards/capture/scheduleByCode";

if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY=""'); process.exit(1); }
const [inputPath, rawPath, factsPath] = process.argv.slice(2);
const snap = JSON.parse(readFileSync(inputPath, "utf-8"));
const raw = JSON.parse(readFileSync(rawPath, "utf-8"));
const prior = JSON.parse(readFileSync(factsPath, "utf-8"));
const rejected: { fact: string; why: string }[] = [];
const asks = raw.asks.map((r: any, i: number) => verifyAsk(snap, r, i === 0 ? rejected : []));
const residual = rejected.map((r) => ({ fact: r.fact, why: `not verified: ${r.why}`, variation: [] as string[] }));
const facts = { cik: prior.cik, anchorUrl: prior.anchorUrl, readSet: prior.readSet, promptVersion: prior.promptVersion, asks: prior.asks, costUsd: prior.costUsd, ...reproduceFacts(asks, residual, codeConfirms(snap)), residual };
// Nov 20: a printed maturity schedule the code can read (and that ties) is read by code.
const coded = scheduleByCode(snap);
if (coded) (facts as any).schedule = coded;
writeFileSync(factsPath, JSON.stringify(facts, null, 1) + "\n");
const was = (k: string) => (Array.isArray(prior[k]) ? prior[k].length : prior[k] ? 1 : 0), now = (k: string) => (Array.isArray((facts as any)[k]) ? (facts as any)[k].length : (facts as any)[k] ? 1 : 0);
console.log(`${snap.company}: ${["moves", "schedule", "subFacilities", "uncommitted", "cash", "faces", "maturities"].map((k) => `${k} ${was(k)}→${now(k)}`).join(", ")}; residual ${prior.residual.length}→${facts.residual.length}`);
