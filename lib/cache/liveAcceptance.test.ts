/**
 * Session 14, Step 5 — the SAME acceptance protocol as acceptance.test.ts,
 * but against the deployed Vercel URL over real HTTP, not runAgentLoop in
 * process. This is the check that actually matters: Session 13 passed
 * every offline test and still shipped non-deterministic output, because
 * nothing had ever exercised the deployed app itself.
 *
 * Reads APP_PASSCODE from .env.local and sends it in the request body —
 * NEVER logged, NEVER included in any printed error (server error bodies
 * are truncated and printed, but the outgoing request never is).
 *
 * Run: npx tsx lib/cache/liveAcceptance.test.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const LIVE_URL = process.env.LIVE_URL || "https://coverage-signal.vercel.app";
const BOOK_A = ["DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health"];
const BOOK_B = ["Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare"];

interface RunStreamEvent {
  type: "trace" | "result" | "error" | "done";
  company?: string;
  text?: string;
  result?: unknown;
  eventBriefings?: unknown;
  portfolioSummary?: unknown;
  message?: string;
}

async function runBookOnceLive(companies: string[]): Promise<{ json: string; elapsedMs: number; cacheLine: string }> {
  const passphrase = process.env.APP_PASSCODE;
  if (!passphrase) {
    throw new Error("APP_PASSCODE is not set in .env.local — cannot run the live acceptance check");
  }

  const t0 = Date.now();
  const res = await fetch(`${LIVE_URL}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companies, passphrase }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`live request failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const results: unknown[] = [];
  let cacheLine = "(no cache trace line seen)";
  let finished = false;

  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      const event = JSON.parse(line) as RunStreamEvent;
      if (event.type === "result") {
        results.push({ result: event.result, eventBriefings: event.eventBriefings, portfolioSummary: event.portfolioSummary });
      } else if (event.type === "error") {
        results.push({ error: event.message });
      } else if (event.type === "trace" && event.text?.startsWith("cache:")) {
        cacheLine = event.text;
      } else if (event.type === "done") {
        finished = true;
      }
    }
  }

  const elapsedMs = Date.now() - t0;
  return { json: JSON.stringify(results, null, 2), elapsedMs, cacheLine };
}

function diffFirstLine(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) return `line ${i}:\n  a: ${al[i]}\n  b: ${bl[i]}`;
  }
  return "(no textual diff found — lengths differ?)";
}

async function runBookNTimesLive(label: string, companies: string[], n: number): Promise<string[]> {
  console.log(`\n=== ${label}: [${companies.join(", ")}] ===`);
  const jsons: string[] = [];
  for (let i = 1; i <= n; i++) {
    const { json, elapsedMs, cacheLine } = await runBookOnceLive(companies);
    jsons.push(json);
    console.log(`  run ${i}: ${elapsedMs}ms — ${cacheLine}`);
  }
  return jsons;
}

async function main() {
  console.log(`Live URL: ${LIVE_URL}`);
  const results: { name: string; pass: boolean }[] = [];

  const aRuns = await runBookNTimesLive("BOOK A (live), runs 1-3", BOOK_A, 3);
  const aIdentical = aRuns.every((j) => j === aRuns[0]);
  results.push({ name: "Book A (live): 3 runs byte-identical", pass: aIdentical });
  if (!aIdentical) {
    for (let i = 1; i < aRuns.length; i++) {
      if (aRuns[i] !== aRuns[0]) console.log(`  ✗ run ${i + 1} vs run 1 — ${diffFirstLine(aRuns[0], aRuns[i])}`);
    }
  }

  const bRuns = await runBookNTimesLive("BOOK B (live), runs 1-3", BOOK_B, 3);
  const bIdentical = bRuns.every((j) => j === bRuns[0]);
  results.push({ name: "Book B (live): 3 runs byte-identical", pass: bIdentical });
  if (!bIdentical) {
    for (let i = 1; i < bRuns.length; i++) {
      if (bRuns[i] !== bRuns[0]) console.log(`  ✗ run ${i + 1} vs run 1 — ${diffFirstLine(bRuns[0], bRuns[i])}`);
    }
  }

  console.log(`\n=== BOOK A (live), run 4 (after book B) ===`);
  const { json: a4, elapsedMs: a4ms, cacheLine: a4cache } = await runBookOnceLive(BOOK_A);
  console.log(`  run 4: ${a4ms}ms — ${a4cache}`);
  const a4Identical = a4 === aRuns[0];
  results.push({ name: "Book A (live): run 4 (post-book-B) still identical to runs 1-3", pass: a4Identical });
  if (!a4Identical) {
    console.log(`  ✗ run 4 vs run 1 — ${diffFirstLine(aRuns[0], a4)}`);
  }

  console.log(`\n=== SUMMARY (live) ===`);
  for (const r of results) {
    console.log(`  ${r.pass ? "✓ PASS" : "✗ FAIL"} — ${r.name}`);
  }

  if (results.every((r) => r.pass)) {
    console.log("\nLIVE ACCEPTANCE PASSED");
  } else {
    console.log("\nLIVE ACCEPTANCE FAILED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
