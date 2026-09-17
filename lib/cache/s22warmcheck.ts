/**
 * SESSION 22 — IS THE BOOK WARM? $0, AND STRUCTURALLY $0.
 *
 * My month-impact probe asserted the cost meter AFTER each company, which
 * catches an unexpected charge but does not prevent it: Tenet's answer cache
 * had gone cold overnight and the run billed $0.1759 before the guard fired.
 * A guard that reports a spend it already made is not the guard a stage
 * declared "$0" needs.
 *
 * This is the shape that is: the base-classification cache key is derivable
 * from free inputs alone — the filings catalog and the prompt version — so a
 * hit or miss can be READ without asking the model anything. Nothing here
 * can bill, whatever the answer turns out to be.
 *
 * A miss is not a fault. It means the filing catalog moved: a new 8-K landed
 * and the corpus this company was last extracted against no longer exists.
 * That is information about the world, and it is reported as such.
 *
 * THREE STATES, NOT TWO — and this helper needed correcting on its own terms.
 * It first returned `warm: boolean`, so a blob read that FAILED became
 * `warm: false` and every caller read that as "cold, this would bill". It
 * fired immediately: a transient read failure on Tenet and DaVita aborted a
 * $0 stage claiming both would bill, and a re-run seconds later showed all
 * ten warm. That is the measured-versus-unreachable defect for the fifth
 * time in this project, inside the guard written to fix its fourth. The
 * conclusion is the one already carried to the audit session — this belongs
 * in a shared helper, because every new probe re-introduces it — and until
 * that exists, each surface states the three outcomes explicitly:
 *
 *   warm         the answer for this exact corpus is cached; running is free
 *   cold         the read SUCCEEDED and there is no entry; running would bill
 *   unreachable  we could not find out, and must not claim either
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings } from "../fetch/filings";
import { readCache } from "../fetch/cache";
import { corpusFingerprint, baseAnswerKey } from "./answerCache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

/** The same forms the loop asks for; a different set would fingerprint a different corpus. */
const FORMS = ["8-K", "10-Q", "10-K"];

export type WarmVerdict = "warm" | "cold" | "unreachable";

export interface WarmState {
  company: string;
  cik: string;
  state: WarmVerdict;
  /** True ONLY for "warm". Never true for a company we failed to ask about. */
  warm: boolean;
  /** Named so a cold company can be explained rather than just counted. */
  newestFiling: string;
  reason: string;
}

export async function checkWarm(companies: string[] = ALL): Promise<WarmState[]> {
  const out: WarmState[] = [];
  for (const company of companies) {
    try {
      const r = await getRecentFilings(company, FORMS);
      const fp = corpusFingerprint(r.filings);
      const newest = [...r.filings].sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
      const newestLabel = newest ? `${newest.form} ${newest.filingDate}` : "(none)";
      // The cache read is its own try, because a read that THROWS and a read
      // that returns nothing are the two outcomes this whole helper exists
      // to keep apart.
      let hit: unknown = null;
      try {
        hit = await readCache<unknown>(baseAnswerKey(r.cik, fp), null);
      } catch (e) {
        out.push({
          company, cik: r.cik, state: "unreachable", warm: false, newestFiling: newestLabel,
          reason: `CACHE UNREACHABLE — ${(e as Error).message}. This says nothing about whether the answer is cached; do not read it as "would bill"`,
        });
        continue;
      }
      out.push({
        company, cik: r.cik,
        state: hit !== null ? "warm" : "cold",
        warm: hit !== null,
        newestFiling: newestLabel,
        reason: hit !== null
          ? `cached at v${EXTRACTION_PROMPT_VERSION}`
          : `NO cached answer for this corpus at v${EXTRACTION_PROMPT_VERSION} — re-asking the model would bill`,
      });
    } catch (e) {
      // UNREACHABLE IS NOT COLD. A filings list we could not fetch says
      // nothing about whether the answer is cached.
      out.push({ company, cik: "", state: "unreachable", warm: false, newestFiling: "(unreachable)", reason: `FILINGS LIST UNREACHABLE — ${(e as Error).message}` });
    }
  }
  return out;
}

if (process.argv[1]?.includes("s22warmcheck")) {
  (async () => {
    const states = await checkWarm();
    console.log(`\n${"=".repeat(100)}\nANSWER-CACHE STATE, v${EXTRACTION_PROMPT_VERSION}.  $0 — the key is read, the model is never asked.\n${"=".repeat(100)}\n`);
    for (const s of states) {
      console.log(`  ${s.company.padEnd(28)} ${s.state.toUpperCase().padEnd(12)} ${s.newestFiling.padEnd(18)} ${s.reason}`);
    }
    const cold = states.filter((s) => s.state === "cold");
    const unreachable = states.filter((s) => s.state === "unreachable");
    console.log(`\n  WARM: ${states.filter((s) => s.state === "warm").length} of ${states.length}`);
    if (cold.length) console.log(`  COLD: ${cold.map((s) => s.company).join(", ")} — each one a paid re-ask before it can be measured.`);
    if (unreachable.length) console.log(`  UNREACHABLE: ${unreachable.map((s) => s.company).join(", ")} — NOT a finding about cost; we could not ask.`);
    console.log("");
  })();
}
