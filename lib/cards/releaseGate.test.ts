/**
 * SESSION 27 (Akshay, Nov 9, 2026) — A FAILING REVIEW CARD BLOCKS ONLY ITS OWN SIGNING, NEVER THE RELEASE.
 *
 * Every check still runs over every shown card (published and review). The release is gated on the published cards
 * (all must pass) and on every check that is not about a card; the review cards' results are reported, not gating. A
 * refresh signs only if its own review card passes every shown-card suite.
 *   R1  shownCards() honours SHOWN_SCOPE: "published", "review", "review:<cik>"; unset, every card
 *   R2  release.ts gates the offline suite on SHOWN_SCOPE=published, then runs every shown-card suite on the review
 *       cards as a report that does not stop the release
 *   R3  s27sign.ts refuses a refresh signing unless every shown-card suite passes on SHOWN_SCOPE=review:<cik>
 *   R4  no shown-card suite takes a scoped card on trust (`shown.find(...)!`); control material reads everyShownCard()
 *   control (behavioural): acceptance passes on the published cards and fails on Cigna's review card (its roll miss)
 *
 * Offline, $0. Run: npx tsx lib/cards/releaseGate.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { shownCards, everyShownCard, SHOWN_SUITES } from "./shownCards";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const withScope = <T>(scope: string | undefined, fn: () => T): T => { const was = process.env.SHOWN_SCOPE; if (scope === undefined) delete process.env.SHOWN_SCOPE; else process.env.SHOWN_SCOPE = scope; try { return fn(); } finally { if (was === undefined) delete process.env.SHOWN_SCOPE; else process.env.SHOWN_SCOPE = was; } };

const all = nonEmpty("the cards that can be shown or signed", everyShownCard());
const pub = withScope("published", shownCards), rev = withScope("review", shownCards), cig = withScope("review:0001739940", shownCards), none = withScope(undefined, shownCards);
assert(pub.length > 0 && pub.every((s) => s.label === "published") && rev.length > 0 && rev.every((s) => s.label === "review") && cig.length === 1 && cig[0].key === "0001739940:review" && none.length === all.length && pub.length + rev.length === all.length,
  `[R1] SHOWN_SCOPE: published ${pub.length}, review ${rev.length}, review:<cik> ${cig.length}, unset ${none.length} of ${all.length}`);

const rel = readFileSync(join("lib", "cache", "release.ts"), "utf-8");
assert(/SHOWN_SCOPE:\s*"published"/.test(rel) && /check\("4\. offline suite/.test(rel) && /reviewReport\(/.test(rel) && /SHOWN_SCOPE:\s*"review"/.test(rel), `[R2] release.ts gates the offline suite on the published cards and reports the review cards without gating`);

const sign = readFileSync(join("lib", "cache", "s27sign.ts"), "utf-8");
assert(/SHOWN_SCOPE:\s*`review:\$\{cik\}`/.test(sign) && /SHOWN_SUITES/.test(sign) && /REFUSING[^\n]*review card/.test(sign), `[R3] s27sign.ts refuses a refresh signing unless the shown-card suites pass on that name's review card`);

const listed = readdirSync(join("lib", "cards")).filter((f) => f.endsWith(".test.ts") && /shownCards\(\)/.test(readFileSync(join("lib", "cards", f), "utf-8"))).map((f) => `lib/cards/${f}`).filter((f) => f !== "lib/cards/releaseGate.test.ts");
// A list built from shownCards() is scoped; a `.find(...)!` on it assumes a card the scope may not hold.
const scopedLists = (src: string) => [...src.matchAll(/const (\w+)\b[^=\n]*=\s*(?:nonEmpty\([^,]+,\s*)?shownCards\(\)/g)].map((m) => m[1]);
const trusting = listed.filter((f) => { const src = readFileSync(f, "utf-8"); return scopedLists(src).some((n) => new RegExp(`\\b${n}\\.find\\(.*?\\)!`).test(src)); });
assert(!trusting.length && listed.every((f) => SHOWN_SUITES.includes(f)), `[R4] ${listed.length} shown-card suites, all in SHOWN_SUITES, none takes a scoped card on trust${trusting.length ? ` (trusting: ${trusting.join(", ")})` : ""}${listed.filter((f) => !SHOWN_SUITES.includes(f)).map((f) => `; not listed: ${f}`).join("")}`);

const acc = (scope: string) => spawnSync("npx", ["tsx", "lib/cards/acceptance.test.ts"], { encoding: "utf-8", shell: true, env: { ...process.env, ANTHROPIC_API_KEY: "", SHOWN_SCOPE: scope } });
const a = acc("published"), b = acc("review:0001739940");
const tail = (r: any) => (/(\d+ passed, \d+ failed)/.exec(r.stdout ?? "") ?? [])[1] ?? "no result";
assert(a.status === 0 && b.status !== 0, `[control] acceptance on the published cards: ${tail(a)} (exit ${a.status}); on Cigna's review card: ${tail(b)} (exit ${b.status})`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
