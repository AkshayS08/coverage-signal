/**
 * Session 17 Blocker 1 (diagnosed false, hardened anyway): asserts no
 * internal fix-tracking marker (e.g. "A1 FIX — WAS DUPLICATING NEW DEBT",
 * "B2 — STALE, REPORT ONLY") ever appears in the deployed app's actual
 * output. Diagnosis: these markers never existed in app/ or lib/ — they
 * were reader-facing callouts in a prior session's REPORT ARTIFACT (a
 * separately-published page, not part of this repo or the Vercel deploy),
 * confirmed absent from both the source (grep) and a live HTTP fetch of
 * both books before this test was written. Session 15/16 standing rule:
 * "test the machine you ship, not a fixture of it" — this reads the RAW
 * HTTP response body of an actual live run, not a reconstructed object,
 * so a marker that leaked in some way this test's authors didn't
 * anticipate (e.g. embedded in a field this file doesn't otherwise parse)
 * still gets caught.
 *
 * Run: npx tsx lib/cache/liveMarkerScan.test.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const LIVE_URL = process.env.LIVE_URL || "https://coverage-signal.vercel.app";
const BOOK_A = ["DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health"];
const BOOK_B = ["Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare"];

/** Matches "A1 FIX", "B2 —", "FIX C —", "— REPORT ONLY" in any casing — the exact shapes named in the Session 17 prompt, generalized rather than hardcoded to the five literal strings observed. */
const MARKER_RE = /\b[A-Z]\d+\s*FIX\b|—\s*REPORT ONLY\b|\bFIX\s*[A-Z]\s*—/i;

async function fetchRawBody(companies: string[]): Promise<string> {
  const passphrase = process.env.APP_PASSCODE;
  if (!passphrase) throw new Error("APP_PASSCODE not set");
  const res = await fetch(`${LIVE_URL}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companies, passphrase }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`live request failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  return res.text();
}

function findMarkers(raw: string): string[] {
  const found: string[] = [];
  const re = new RegExp(MARKER_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const context = raw.slice(Math.max(0, m.index - 60), m.index + 60);
    found.push(context.replace(/\s+/g, " ").trim());
  }
  return found;
}

async function main() {
  console.log(`Live URL: ${LIVE_URL}`);
  let failed = false;

  for (const [label, companies] of [
    ["Book A", BOOK_A],
    ["Book B", BOOK_B],
  ] as const) {
    console.log(`\nFetching ${label} raw HTTP response body...`);
    const raw = await fetchRawBody(companies);
    const markers = findMarkers(raw);
    if (markers.length === 0) {
      console.log(`  ✓ PASS — ${label}: 0 marker hits in raw response body (${raw.length} chars scanned)`);
    } else {
      failed = true;
      console.error(`  ✗ FAIL — ${label}: ${markers.length} marker hit(s):`);
      for (const m of markers) console.error(`      ...${m}...`);
    }
  }

  if (failed) {
    console.error("\nANNOTATION-LEAK CHECK FAILED");
    process.exit(1);
  } else {
    console.log("\nANNOTATION-LEAK CHECK PASSED — no fix-tracking marker in live output, either book");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
