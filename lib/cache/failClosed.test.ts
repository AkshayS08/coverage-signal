/**
 * SESSION 27, STAGE 1, STEP 4 — A FAILED READ IS AN ERROR, NEVER A FALLBACK.
 *
 * Over every signed name, each read the extraction depends on is failed in
 * turn, at the network, underneath the real code path (an undici dispatcher
 * sees both the blob client's requests and Node's fetch). For each, the build
 * must:
 *   - stop with a ReadFailedError naming the source (blob, edgar, xbrl);
 *   - make zero model calls (every request to the model API is refused and counted);
 *   - never switch source (a failed cached XBRL read is not replaced by a direct EDGAR read);
 *   - retry the same read at most twice (at most 3 attempts on the failed path).
 *
 * Negative control: the same assertion over a run with NO injected failure
 * must fail (the run does not stop with a ReadFailedError), so the check
 * cannot pass vacuously. The before-fix run of this file is the second
 * control: the current fallback paths must fail it.
 *
 * $0: refuses unless ANTHROPIC_API_KEY is empty, and refuses every request to
 * the model API at the network regardless.
 *
 * Run: ANTHROPIC_API_KEY="" npx tsx lib/cache/failClosed.test.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync } from "node:fs";
import { Agent, setGlobalDispatcher } from "undici";
import { runAgentLoop } from "../agent";
import { checkFree } from "./freeRun";
import { Messages } from "@anthropic-ai/sdk/resources/messages";

type Fault = "error" | "404";
type Rule = (origin: string, path: string) => Fault | null;
const stats = { model: 0, attempts: new Map<string, number>(), requests: [] as string[] };
let rule: Rule = () => null;

/** Every request in the process passes through here; a matching rule fails it, the model API is always refused. */
class FaultInjector extends Agent {
  dispatch(opts: any, handler: any) {
    const origin = String(opts.origin), path = String(opts.path);
    stats.requests.push(`${opts.method} ${origin}${path}`);
    if (/api\.anthropic\.com/.test(origin)) {
      stats.model++;
      queueMicrotask(() => handler.onError(new Error("model API refused by the test")));
      return true;
    }
    const f = rule(origin, path);
    if (f) {
      const k = `${origin}${path.split("?")[0]}`;
      stats.attempts.set(k, (stats.attempts.get(k) ?? 0) + 1);
      queueMicrotask(() => {
        if (f === "error") return handler.onError(new Error("injected read failure"));
        handler.onConnect?.(() => {});
        handler.onHeaders?.(404, [Buffer.from("content-type"), Buffer.from("text/plain")], () => {}, "Not Found");
        handler.onComplete?.([]);
      });
      return true;
    }
    return super.dispatch(opts, handler);
  }
}
setGlobalDispatcher(new FaultInjector());
// A model call can also fail before it reaches the network (no key set), so it is counted where it is made, too.
(Messages.prototype as any).create = function () { stats.model++; return Promise.reject(new Error("model call refused by the test")); };

const PUBLIC = /\.public\.blob\.vercel-storage\.com$/;
const onPublic = (re: RegExp, f: Fault): Rule => (o, p) => (PUBLIC.test(o) && re.test(p) ? f : null);
const either = (...rs: Rule[]): Rule => (o, p) => rs.map((r) => r(o, p)).find((x) => x) ?? null;
const onSec = (re: RegExp): Rule => (o, p) => (/data\.sec\.gov|www\.sec\.gov/.test(o) && re.test(p) ? "error" : null);

interface Case { id: string; name: string; source: "blob" | "edgar" | "xbrl"; rule: (cik: string) => Rule; run: "loop" | "checkFree"; noRequest?: RegExp }
const CASES: Case[] = [
  { id: "R1", name: "blob: a read filing's cached text fails", source: "blob", run: "loop", rule: () => onPublic(/^\/edgar\/filing-text-v2\//, "error") },
  { id: "R2", name: "blob: the cached answer read fails", source: "blob", run: "loop", rule: (cik) => onPublic(new RegExp(`^/answer/${cik}/base`), "error") },
  { id: "R3", name: "edgar: the filing list is not cached and EDGAR fails", source: "edgar", run: "loop", rule: () => either(onPublic(/^\/edgar\/(submissions|filings)\//, "404"), onSec(/^\/submissions\//)) },
  { id: "R4", name: "xbrl: company facts fail in the cache and at EDGAR", source: "xbrl", run: "loop", rule: () => either(onPublic(/^\/edgar\/companyfacts\//, "error"), onSec(/^\/api\/xbrl\//)) },
  { id: "R5", name: "xbrl: the cached company-facts read fails while EDGAR is up (no source switch)", source: "xbrl", run: "loop", rule: () => onPublic(/^\/edgar\/companyfacts\//, "error"), noRequest: /data\.sec\.gov\/api\/xbrl\// },
  { id: "R6", name: "blob: the answer-key HEAD fails (preflight, checkFree)", source: "blob", run: "checkFree", rule: (cik) => (o, p) => (/vercel\.com$/.test(o) && p.startsWith("/api/blob") && p.includes(encodeURIComponent(`answer/${cik}/`)) ? "error" : null) },
];

interface Outcome { threw: boolean; name: string; source?: string; message: string; model: number; maxAttempts: number; forbidden: number }
async function attempt(company: string, cik: string, c: Case | null): Promise<Outcome> {
  rule = c ? c.rule(cik) : () => null;
  stats.model = 0; stats.attempts.clear(); stats.requests = [];
  const quiet = console.log; console.log = () => {};
  const warn = console.warn; console.warn = () => {};
  let out: Outcome;
  try {
    if (!c || c.run === "loop") await runAgentLoop(company); else await checkFree(company);
    out = { threw: false, name: "", message: "completed", model: 0, maxAttempts: 0, forbidden: 0 };
  } catch (e: any) {
    const cause = e?.cause ? ` [cause: ${e.cause?.message ?? e.cause}${e.cause?.cause ? ` / ${e.cause.cause?.code ?? e.cause.cause?.message}` : ""}]` : "";
    out = { threw: true, name: e?.name ?? "", source: e?.source, message: String(e?.message ?? e).slice(0, 160) + cause, model: 0, maxAttempts: 0, forbidden: 0 };
  } finally { console.log = quiet; console.warn = warn; rule = () => null; }
  out.model = stats.model;
  out.maxAttempts = Math.max(0, ...stats.attempts.values());
  out.forbidden = c?.noRequest ? stats.requests.filter((r) => c.noRequest!.test(r)).length : 0;
  return out;
}
const verdict = (c: Case, o: Outcome): string[] => {
  const f: string[] = [];
  if (!o.threw) f.push("the build did not stop");
  else if (o.name !== "ReadFailedError") f.push(`stopped with ${o.name || "an unnamed error"} ("${o.message}"), not a ReadFailedError`);
  else if (o.source !== c.source) f.push(`ReadFailedError names source ${o.source}, expected ${c.source}`);
  if (o.model > 0) f.push(`${o.model} model call(s) attempted`);
  if (o.maxAttempts > 3) f.push(`the failed read was attempted ${o.maxAttempts} times (at most 3: the read and two retries)`);
  if (o.forbidden > 0) f.push(`switched source: ${o.forbidden} direct request(s) to EDGAR after the cached read failed`);
  return f;
};

(async () => {
  if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY=""'); process.exit(1); }
  const names = readdirSync("baselines/golden").map((f) => JSON.parse(readFileSync(`baselines/golden/${f}`, "utf-8"))).filter((g) => g.extractionVersion === 31).map((g) => ({ company: g.state.company as string, cik: g.state.cik as string }));
  let passed = 0, failed = 0, controls = 0, controlsFailedAsRequired = 0;
  const failures: string[] = [];
  // ONLY=R1,R6,CONTROL runs a subset (for a slow before-run); the default is every case.
  const only = process.env.ONLY?.split(",");
  for (const c of CASES.filter((x) => !only || only.includes(x.id))) {
    console.log(`\n${c.id} — ${c.name}`);
    for (const n of names) {
      const o = await attempt(n.company, n.cik, c);
      const f = verdict(c, o);
      if (f.length === 0) { passed++; console.log(`  ✓ ${n.company}: stopped with ReadFailedError (${o.source}), 0 model calls, ${o.maxAttempts} attempt(s)`); }
      else { failed++; failures.push(`${c.id} ${n.company}: ${f.join("; ")}`); console.log(`  ✗ ${n.company}: ${f.join("; ")}`); }
    }
  }
  // Negative control: no fault injected. The assertion must FAIL here.
  console.log(`\nCONTROL — no injected failure; the assertion must fail`);
  for (const n of !only || only.includes("CONTROL") ? names.slice(0, 2) : []) {
    const o = await attempt(n.company, n.cik, null);
    controls++;
    const f = verdict({ ...CASES[0], source: "blob" }, o);
    if (f.length > 0) { controlsFailedAsRequired++; console.log(`  ✓ control fails as required on ${n.company}: ${f[0]}`); }
    else console.log(`  ✗ CONTROL PASSED on ${n.company}: the check cannot tell a stopped build from a completed one`);
  }
  console.log(`\n${passed} passed, ${failed} failed; controls ${controlsFailedAsRequired} of ${controls} failed as required.`);
  if (failures.length) { console.log("\nFAILURES:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed > 0 || controlsFailedAsRequired < controls ? 1 : 0);
})();
