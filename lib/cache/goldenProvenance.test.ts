/**
 * SESSION 27 (Akshay, Nov 9, 2026) — EVERY GOLDEN RECORDS THE READ SET IT WAS SIGNED ON.
 *
 * Cigna's v33 golden (signed Oct 29 over its Oct 15 brief's read set) recorded no readSetAsOf, so the $0 replay read
 * it on today's read set (which holds the Nov 5 10-Q) and failed as "the filing set moved". readSetAsOf is provenance
 * metadata: recording it changes no signed content (state, sourceResult, signature).
 *   G1  every golden at the current extraction version records readSetAsOf (an ISO date)
 *   G2  readSetAsOf is not after the golden's signing date
 *   control: a golden with readSetAsOf removed fails G1
 *
 * Offline, $0. Run: npx tsx lib/cache/goldenProvenance.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const DIR = join("baselines", "golden");
const goldens = nonEmpty("the goldens at the current extraction version", readdirSync(DIR).map((f) => JSON.parse(readFileSync(join(DIR, f), "utf-8"))).filter((g) => g.extractionVersion === EXTRACTION_PROMPT_VERSION));
const records = (g: any) => typeof g.readSetAsOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g.readSetAsOf);

const missing = goldens.filter((g) => !records(g)).map((g) => g.state.company);
assert(!missing.length, `[G1] every v${EXTRACTION_PROMPT_VERSION} golden records the read set it was signed on (${goldens.length} goldens${missing.length ? `; missing: ${missing.join(", ")}` : ""})`);
const late = goldens.filter((g) => records(g) && g.readSetAsOf > g.signature.signedOn).map((g) => `${g.state.company} ${g.readSetAsOf} > ${g.signature.signedOn}`);
assert(!late.length, `[G2] no read set is dated after its signing${late.length ? `: ${late.join("; ")}` : ""}`);

const stripped = { ...goldens[0] }; delete stripped.readSetAsOf;
assert(!records(stripped), `[control] a golden without readSetAsOf fails G1`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
