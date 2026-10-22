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
 *   - retry the same read at most twice (at most 3 attempts on the failed path);
 *   - reach the ledger (Rule 68): a loop run that throws persists exactly one
 *     line, under its own company, so a run that billed before a later read
 *     failed is never off the books.
 *
 * HANGS (H1-H5): a read that never answers is a failed read too. Each is cut
 * off by the per-attempt timeout (READ_TIMEOUT_MS, set short here), retried
 * at most twice, and then stops the build with its named error, well inside
 * the test's own deadline. Without a timeout the build waits forever, which
 * the deadline reports as a hang.
 *
 * WRITES (W1-W2, Akshay, Oct 22, 2026): a write after a billed call is the
 * paid answer. It is retried at most twice and then stops the build with a
 * WriteFailedError; it is never swallowed. W1 is the path that lost Tenet's
 * proceeds-use answer in the canonical run: the proceeds-use call (answered
 * here by the test, at $0, standing in for the billed one) and then its
 * write failing. W2 is the shared answer-cache write every billed answer
 * goes through, for each of the six. Every write to an answer path is failed
 * in these cases, so the test can never store anything.
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
import { cachedBaseClassification } from "./answerCache";
import { Messages } from "@anthropic-ai/sdk/resources/messages";

type Fault = "error" | "404" | "hang";
// Short enough to keep the suite quick; production's default is 60s. Set before any read runs.
process.env.READ_TIMEOUT_MS = "1500";
const DEADLINE_MS = 30_000;
type Rule = (origin: string, path: string, method?: string) => Fault | null;
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
    const f = rule(origin, path, String(opts.method));
    if (f) {
      const k = `${origin}${path.split("?")[0]}`;
      stats.attempts.set(k, (stats.attempts.get(k) ?? 0) + 1);
      if (f === "hang") return true; // never answers
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
// W1 alone answers the proceeds-use call (a canned, zero-usage response) so the write after it is reached.
let answerProceedsUse = false;
(Messages.prototype as any).create = function (body: any) {
  stats.model++;
  if (answerProceedsUse && body?.tools?.[0]?.name === "submit_proceeds_use") return Promise.resolve({ content: [{ type: "tool_use", id: "t", name: "submit_proceeds_use", input: { proceedsUse: "unstated" } }], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: "tool_use" });
  return Promise.reject(new Error("model call refused by the test"));
};
const failAnswerWrites: Rule = (o, p, m) => (/vercel\.com$/.test(o) && p.startsWith("/api/blob") && m === "PUT" && /answer\//.test(decodeURIComponent(p)) ? "error" : null);

const PUBLIC = /\.public\.blob\.vercel-storage\.com$/;
const onPublic = (re: RegExp, f: Fault): Rule => (o, p) => (PUBLIC.test(o) && re.test(p) ? f : null);
const either = (...rs: Rule[]): Rule => (o, p) => rs.map((r) => r(o, p)).find((x) => x) ?? null;
const onSec = (re: RegExp): Rule => (o, p) => (/data\.sec\.gov|www\.sec\.gov/.test(o) && re.test(p) ? "error" : null);

interface Case { id: string; name: string; source: "blob" | "edgar" | "xbrl"; rule: (cik: string) => Rule; run: "loop" | "checkFree" | "answerWrite"; noRequest?: RegExp; error?: string; models?: number; only?: RegExp }
const CASES: Case[] = [
  { id: "R1", name: "blob: a read filing's cached text fails", source: "blob", run: "loop", rule: () => onPublic(/^\/edgar\/filing-text-v2\//, "error") },
  { id: "R2", name: "blob: the cached answer read fails", source: "blob", run: "loop", rule: (cik) => onPublic(new RegExp(`^/answer/${cik}/base`), "error") },
  { id: "R3", name: "edgar: the filing list is not cached and EDGAR fails", source: "edgar", run: "loop", rule: () => either(onPublic(/^\/edgar\/(submissions|filings)\//, "404"), onSec(/^\/submissions\//)) },
  { id: "R4", name: "xbrl: company facts fail in the cache and at EDGAR", source: "xbrl", run: "loop", rule: () => either(onPublic(/^\/edgar\/companyfacts\//, "error"), onSec(/^\/api\/xbrl\//)) },
  { id: "R5", name: "xbrl: the cached company-facts read fails while EDGAR is up (no source switch)", source: "xbrl", run: "loop", rule: () => onPublic(/^\/edgar\/companyfacts\//, "error"), noRequest: /data\.sec\.gov\/api\/xbrl\// },
  { id: "R6", name: "blob: the answer-key HEAD fails (preflight, checkFree)", source: "blob", run: "checkFree", rule: (cik) => (o, p) => (/vercel\.com$/.test(o) && p.startsWith("/api/blob") && p.includes(encodeURIComponent(`answer/${cik}/`)) ? "error" : null) },
  { id: "H1", name: "hang: a read filing's cached text never answers", source: "blob", run: "loop", rule: () => onPublic(/^\/edgar\/filing-text-v2\//, "hang") },
  { id: "H2", name: "hang: the cached answer read never answers", source: "blob", run: "loop", rule: (cik) => onPublic(new RegExp(`^/answer/${cik}/base`), "hang") },
  { id: "H3", name: "hang: the answer-key HEAD never answers (preflight, checkFree)", source: "blob", run: "checkFree", rule: (cik) => (o, p) => (/vercel\.com$/.test(o) && p.startsWith("/api/blob") && p.includes(encodeURIComponent(`answer/${cik}/`)) ? "hang" : null) },
  { id: "H4", name: "hang: the filing list is not cached and EDGAR never answers", source: "edgar", run: "loop", rule: () => (o, p) => (PUBLIC.test(o) && /^\/edgar\/(submissions|filings)\//.test(p) ? "404" : /data\.sec\.gov/.test(o) && /^\/submissions\//.test(p) ? "hang" : null) },
  { id: "H5", name: "hang: the cached company-facts read never answers", source: "xbrl", run: "loop", rule: () => onPublic(/^\/edgar\/companyfacts\//, "hang") },
  { id: "W1", name: "write: the proceeds-use answer's write fails after its call (Tenet: the one name whose proceeds-use is not cached)", source: "blob", run: "loop", rule: () => failAnswerWrites, error: "WriteFailedError", models: 1, only: /TENET/ },
  { id: "W2", name: "write: the answer-cache write of a computed answer fails", source: "blob", run: "answerWrite", rule: () => failAnswerWrites, error: "WriteFailedError", models: 0 },
];

interface Outcome { threw: boolean; name: string; source?: string; message: string; model: number; maxAttempts: number; forbidden: number; ledgerLines: number; ledgerLabel: string }
const LEDGER = "baselines/cost-log.jsonl";
const ledger = () => readFileSync(LEDGER, "utf-8").trim().split("\n");
async function attempt(company: string, cik: string, c: Case | null): Promise<Outcome> {
  rule = c ? c.rule(cik) : () => null;
  stats.model = 0; stats.attempts.clear(); stats.requests = [];
  const linesBefore = ledger().length;
  const quiet = console.log; console.log = () => {};
  const warn = console.warn; console.warn = () => {};
  let out: Outcome;
  try {
    answerProceedsUse = c?.id === "W1";
    const run = !c || c.run === "loop" ? runAgentLoop(company) : c.run === "checkFree" ? checkFree(company) : cachedBaseClassification(cik, `s27-write-test-${cik}`, async () => [] as unknown[]);
    let timer: NodeJS.Timeout | undefined;
    const hung = await Promise.race([run.then(() => false), new Promise<boolean>((r) => { timer = setTimeout(() => r(true), DEADLINE_MS); })]);
    clearTimeout(timer);
    out = { threw: false, name: "", message: hung ? `hung: still waiting after ${DEADLINE_MS / 1000}s` : "completed", model: 0, maxAttempts: 0, forbidden: 0, ledgerLines: 0, ledgerLabel: "" };
  } catch (e: any) {
    const cause = e?.cause ? ` [cause: ${e.cause?.message ?? e.cause}${e.cause?.cause ? ` / ${e.cause.cause?.code ?? e.cause.cause?.message}` : ""}]` : "";
    out = { threw: true, name: e?.name ?? "", source: e?.source, message: String(e?.message ?? e).slice(0, 160) + cause, model: 0, maxAttempts: 0, forbidden: 0, ledgerLines: 0, ledgerLabel: "" };
  } finally { console.log = quiet; console.warn = warn; rule = () => null; answerProceedsUse = false; }
  out.model = stats.model;
  out.maxAttempts = Math.max(0, ...stats.attempts.values());
  const after = ledger();
  out.ledgerLines = after.length - linesBefore;
  out.ledgerLabel = out.ledgerLines > 0 ? JSON.parse(after[after.length - 1]).company : "";
  out.forbidden = c?.noRequest ? stats.requests.filter((r) => c.noRequest!.test(r)).length : 0;
  return out;
}
const verdict = (c: Case, o: Outcome, company = ""): string[] => {
  const f: string[] = [];
  if (c.run === "loop" && (o.ledgerLines !== 1 || o.ledgerLabel !== company)) f.push(`ledger: ${o.ledgerLines} line(s) written${o.ledgerLabel ? ` under "${o.ledgerLabel}"` : ""}, expected exactly 1 under "${company}" (Rule 68 on the throwing path)`);
  if (!o.threw) f.push(o.message.startsWith("hung") ? `the build ${o.message}` : "the build did not stop");
  else if (o.name !== (c.error ?? "ReadFailedError")) f.push(`stopped with ${o.name || "an unnamed error"} ("${o.message}"), not a ${c.error ?? "ReadFailedError"}`);
  else if (o.source !== c.source) f.push(`${o.name} names source ${o.source}, expected ${c.source}`);
  if (o.model !== (c.models ?? 0)) f.push(`${o.model} model call(s) attempted, expected ${c.models ?? 0}`);
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
    for (const n of names.filter((x) => !c.only || c.only.test(x.company))) {
      const o = await attempt(n.company, n.cik, c);
      const f = verdict(c, o, n.company);
      if (f.length === 0) { passed++; console.log(`  ✓ ${n.company}: stopped with ReadFailedError (${o.source}), 0 model calls, ${o.maxAttempts} attempt(s)`); }
      else { failed++; failures.push(`${c.id} ${n.company}: ${f.join("; ")}`); console.log(`  ✗ ${n.company}: ${f.join("; ")}`); }
    }
  }
  // Negative control: no fault injected. The assertion must FAIL here.
  console.log(`\nCONTROL — no injected failure; the assertion must fail`);
  for (const n of !only || only.includes("CONTROL") ? names.slice(0, 2) : []) {
    const o = await attempt(n.company, n.cik, null);
    controls++;
    const f = verdict({ ...CASES[0], source: "blob" }, o, n.company);
    if (f.length > 0) { controlsFailedAsRequired++; console.log(`  ✓ control fails as required on ${n.company}: ${f[0]}`); }
    else console.log(`  ✗ CONTROL PASSED on ${n.company}: the check cannot tell a stopped build from a completed one`);
  }
  console.log(`\n${passed} passed, ${failed} failed; controls ${controlsFailedAsRequired} of ${controls} failed as required.`);
  if (failures.length) { console.log("\nFAILURES:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed > 0 || controlsFailedAsRequired < controls ? 1 : 0);
})();
