/**
 * SESSION 27 (Akshay, Nov 9, 2026) — PARAGRAPH BREAKS ARE KEPT IN THE TEXT STEP (retiring decision 13's approximation).
 *
 * EDGAR's inline-XBRL documents arrive as one line, and the text step collapsed every break, so "the same paragraph"
 * (the antecedent rule, Nov 7) was approximated as three sentences back. The text step now ends each block element
 * (p, div, tr, li, h1-h6, br, table) with a paragraph break ("\n\n").
 *   P1  block elements end in a paragraph break; inline elements (span, b, ix:nonFraction) and <br> do not end a paragraph
 *   P2  a sentence's words are unchanged: the text with breaks, flattened, equals the old text, flattened
 *   P3  the cache is versioned (filing-text-v3), so no entry cached under the old regime is replayed as the new
 *   control: the old regime's output (every break collapsed) has no paragraph break
 *
 * Offline, $0. Run: npx tsx lib/fetch/paragraphBreaks.test.ts
 */
import { readFileSync } from "node:fs";
import { stripHtml, stripHtmlV2 } from "./filingText";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

const html = `<div><p>In May 2026, we issued <span>$500 million</span> of <b>5.875%</b> Senior Notes due 2034 (the &#8220;2034 Notes&#8221;) at par.</p><p>The 2034 Notes mature on June 1, 2034.</p><table><tr><td>4.75% Senior Notes due 2030</td><td><ix:nonFraction>788.4</ix:nonFraction></td></tr><tr><td>Other notes payable</td><td>81.9</td></tr></table><p>We used the net proceeds from this offering, together with cash on hand,<br>to redeem the 2028 Notes.</p></div>`;
const t = stripHtml(html);
const paras = t.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
assert(paras.length >= 5 && paras[0].startsWith("In May 2026, we issued $500 million of 5.875% Senior Notes due 2034") && paras[1] === "The 2034 Notes mature on June 1, 2034.", `[P1] block elements end in a paragraph break; inline ones do not split a sentence (${paras.length} paragraphs: ${paras.map((p) => `"${p.slice(0, 40)}"`).join(", ")})`);
assert(paras.some((p) => /^4\.75% Senior Notes due 2030 788\.4$/.test(p)), `[P1] a table row is one paragraph, its cells on one line ("4.75% Senior Notes due 2030 788.4")`);
assert(paras.some((p) => flat(p) === "We used the net proceeds from this offering, together with cash on hand, to redeem the 2028 Notes."), `[P1] a <br> does not end a paragraph (the proceeds sentence is one paragraph)`);
assert(flat(t) === flat(stripHtmlV2(html)), `[P2] flattened, the text is the old text word for word`);
const src = readFileSync("lib/fetch/filingText.ts", "utf-8");
assert(/edgar\/filing-text-v3\//.test(src), `[P3] the text cache is versioned filing-text-v3`);
assert(!/\n\n/.test(stripHtmlV2(html)), `[control] the old regime's output has no paragraph break`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
