/**
 * SESSION 27 (Akshay, Nov 16): CAN CIGNA'S OCT 16 FACTS BE TIED TO A READ SET, AT $0? Match the documents its facts input
 * put before the model (the Oct 16 card input at b88e41e, the commit that wrote the facts) against the read set the
 * signed golden reads (its recorded read set, each document with the sha256 of its full text). A match needs every
 * read-set document in that input, the same filing (its full text, fetched now from EDGAR, hashes to the recorded hash).
 * Writes sessions/27/cigna_facts/match.md. Fetches filings only; calls no model.
 *
 *   ANTHROPIC_API_KEY="" npx tsx lib/cache/s27cignaFactsMatch.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { getFilingText } from "../fetch";
import { heldByOldFactsInput } from "../cards/capture/adoptedFactsSources";

(async () => {
  if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY=""'); process.exit(1); }
  const oct16 = JSON.parse(execSync("git show b88e41e:lib/cards/inputs/0001739940.json", { encoding: "utf-8", maxBuffer: 256e6 }));
  const golden = JSON.parse(readFileSync("baselines/golden/0001739940.json", "utf-8"));
  const rs = (golden.sourceResult.recordedReadSet ?? []).filter((r: any) => r.via === "base");
  const held = new Set(heldByOldFactsInput(oct16));
  const lines = [`# Cigna: the Oct 16 facts against the signed golden's read set`, ``, `Facts written at b88e41e (Oct 16) from that day's card input (v${oct16.extractionVersion}, which records no read set). Its facts input put ${held.size} documents before the model. The signed golden (v${golden.extractionVersion}) reads ${rs.length}.`, ``, `| Read-set document | In the Oct 16 facts input | Same filing (full-text sha256) |`, `|---|---|---|`];
  let all = true;
  for (const r of rs) {
    const inInput = held.has(r.url);
    const same = createHash("sha256").update((await getFilingText(r.url)).text).digest("hex") === r.contentHash;
    if (!inInput || !same) all = false;
    lines.push(`| ${r.form} ${r.filingDate} | ${inInput ? "yes" : "**no**"} | ${same ? "yes" : "**no**"} |`);
  }
  const outside = [...held].filter((u) => !rs.some((r: any) => r.url === u));
  lines.push(``, `Documents the Oct 16 facts input held outside the read set: ${outside.length ? outside.map((u) => oct16.docs[u]?.label ?? u).join(", ") : "none"}.`, ``, all ? `**MATCH**: every read-set document was read. The facts may record this read set.` : `**NO MATCH**: the Oct 16 facts input lacked read-set documents, so its facts cannot be tied to the read set. Cigna's facts are re-read (approved up to $0.30).`);
  writeFileSync("sessions/27/cigna_facts/match.md", lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
