/**
 * SESSION 27 (Nov 9): A PUBLISHED CARD INPUT IS BUILT FROM ITS SIGNED GOLDEN'S RESULT — never from a newer answer
 * that happens to be cached at the brief's read set.
 *
 * Found recapturing the Nov 9 inputs with paragraph text: Cigna's Sept 30 refresh (billed, not signed) is now the cached
 * answer at the Nov 9 read set, and snapshot.ts preferred any cached answer, so the published input became the unsigned
 * refresh. The capture re-derives through the loop as a check only; where the re-derived result is not the golden's
 * stored result, the stored result is the input.
 *   S1  every published input's result equals its signed golden's stored result
 *   S2  snapshot.ts falls back to the stored result where the re-derived result differs
 *   control: Cigna's input with its unsigned refresh answer fails S1
 *
 * Offline, $0. Run: npx tsx lib/cards/capture/snapshotSource.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { nonEmpty } from "../../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));

const ciks: string[] = nonEmpty("the published card inputs", readdirSync(join("lib", "cards", "inputs")).filter((f) => /^\d{10}\.json$/.test(f)).map((f) => f.slice(0, 10)));
const offSigned = (input: any, cik: string) => JSON.stringify(input.result) !== JSON.stringify(read(join("baselines", "golden", `${cik}.json`)).sourceResult);
const bad = ciks.filter((cik) => offSigned(read(join("lib", "cards", "inputs", `${cik}.json`)), cik));
assert(!bad.length, `[S1] every published input's result is its signed golden's stored result (${ciks.length} inputs${bad.length ? `; not: ${bad.join(", ")}` : ""})`);

const src = readFileSync(join("lib", "cards", "capture", "snapshot.ts"), "utf-8");
assert(/JSON\.stringify\(result\)\s*!==\s*JSON\.stringify\(g\.sourceResult\)/.test(src), `[S2] snapshot.ts uses the stored result where the re-derived result differs`);

const cigna = read(join("lib", "cards", "inputs", "0001739940.json"));
const refresh = read(join("baselines", "s27-cigna-refresh.json")).names.find((n: any) => n.cik === "0001739940");
const drifted = { ...cigna, result: refresh.samples[0] };
assert(offSigned(drifted, "0001739940"), `[control] Cigna's input carrying its unsigned refresh answer fails S1`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
