/**
 * SESSION 22, STAGE 7 — THE SIGNATURE PACKET, RENDERED. $0.
 *
 * A FORMATTER, NOT A RE-DESCRIPTION. This reads
 * files/session_22_sign_packet.json and injects it into the page verbatim;
 * every figure the reader sees is a field of that packet, and the packet is
 * built from the same calls the golden writer makes. Nothing here retypes a
 * number, and there is no path by which the page can show a figure the
 * pinned data does not hold — the rendering code reads only from the injected
 * object.
 *
 * That is the whole point: what is signed must be what gets written.
 *
 * Reusable. Session 23's signature pass over the wider book runs:
 *   npx tsx lib/cache/s22signpacket.ts                 (emit the packet)
 *   npx tsx lib/cache/s22signartifact.ts               (render every signable name)
 *   npx tsx lib/cache/s22signartifact.ts "DaVita" ...  (or a chosen subset)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { PacketCompany } from "./s22signpacket";

interface PacketDoc {
  generatedAt: string;
  asOf: string;
  extractionPromptVersion: number;
  narrationPromptVersion: number;
  companies: PacketCompany[];
}

const PACKET_PATH = "files/session_22_sign_packet.json";
const OUT_PATH = "files/session_22_signature_review.html";

const doc: PacketDoc = JSON.parse(readFileSync(PACKET_PATH, "utf8"));
const wanted = process.argv.slice(2);
const shown = wanted.length
  ? doc.companies.filter((c) => wanted.some((w) => c.company.toLowerCase().includes(w.toLowerCase())))
  : doc.companies.filter((c) => c.signable);
const excluded = doc.companies.filter((c) => !shown.includes(c));

const payload = {
  generatedAt: doc.generatedAt,
  asOf: doc.asOf,
  extractionPromptVersion: doc.extractionPromptVersion,
  narrationPromptVersion: doc.narrationPromptVersion,
  companies: shown,
  excluded: excluded.map((c) => ({
    company: c.company,
    computedPass: c.computedPass,
    computedTotal: c.computedTotal,
    failing: c.criteria.filter((x) => x.kind === "computed" && x.pass === false).map((x) => ({ id: x.id, detail: x.detail })),
  })),
};

/** `</script>` inside JSON would end the block early; escaping `<` is the standard guard. */
const json = JSON.stringify(payload).replace(/</g, "\\u003c");

const html = `<title>Ladder Signature Review</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {
    --paper:        #f6f7f9;
    --surface:      #ffffff;
    --ink:          #131820;
    --ink-soft:     #5a6572;
    --rule:         #d9dee6;
    --rule-soft:    #e8ecf1;
    --accent:       #1f4a7a;
    --accent-soft:  #eaf0f7;
    --pass:         #1d6b4a;
    --pass-soft:    #e6f2ec;
    --fail:         #a32e35;
    --fail-soft:    #fbeaea;
    --flag:         #8a5a0b;
    --flag-soft:    #fcf2df;
    --shadow:       0 1px 2px rgba(19,24,32,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper:       #11151b;
      --surface:     #171d25;
      --ink:         #e6eaf0;
      --ink-soft:    #97a2b1;
      --rule:        #2b333d;
      --rule-soft:   #222a33;
      --accent:      #7fb0e2;
      --accent-soft: #1a2634;
      --pass:        #6cc39a;
      --pass-soft:   #15251e;
      --fail:        #e8868c;
      --fail-soft:   #2a1a1c;
      --flag:        #d9a74e;
      --flag-soft:   #282013;
      --shadow:      0 1px 2px rgba(0,0,0,.3);
    }
  }
  :root[data-theme="dark"] {
    --paper:       #11151b;
    --surface:     #171d25;
    --ink:         #e6eaf0;
    --ink-soft:    #97a2b1;
    --rule:        #2b333d;
    --rule-soft:   #222a33;
    --accent:      #7fb0e2;
    --accent-soft: #1a2634;
    --pass:        #6cc39a;
    --pass-soft:   #15251e;
    --fail:        #e8868c;
    --fail-soft:   #2a1a1c;
    --flag:        #d9a74e;
    --flag-soft:   #282013;
    --shadow:      0 1px 2px rgba(0,0,0,.3);
  }

  * { box-sizing: border-box; }
  body {
    background: var(--paper);
    color: var(--ink);
    font-family: "IBM Plex Sans", system-ui, -apple-system, sans-serif;
    font-size: 15px;
    line-height: 1.55;
    margin: 0;
    padding: 0 20px 96px;
  }
  .wrap { max-width: 1080px; margin: 0 auto; }

  /* ---------- masthead ---------- */
  header.doc { padding: 40px 0 20px; border-bottom: 2px solid var(--ink); }
  h1 {
    font-family: Newsreader, Georgia, serif;
    font-weight: 500; font-size: 2.15rem; line-height: 1.15;
    margin: 0 0 6px; text-wrap: balance; letter-spacing: -0.01em;
  }
  .standfirst { color: var(--ink-soft); max-width: 62ch; margin: 0; }
  .provenance {
    margin-top: 22px; padding: 14px 16px;
    background: var(--accent-soft); border-left: 3px solid var(--accent);
    font-size: .85rem; line-height: 1.6;
  }
  .provenance strong { color: var(--accent); }
  .provenance code {
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: .92em;
  }
  .meta {
    display: flex; flex-wrap: wrap; gap: 4px 26px;
    margin-top: 14px; font-size: .8rem; color: var(--ink-soft);
    font-family: "IBM Plex Mono", ui-monospace, monospace;
  }

  /* ---------- summary ---------- */
  section.summary { margin: 34px 0 10px; }
  h2.section {
    font-family: Newsreader, Georgia, serif; font-weight: 600;
    font-size: 1.02rem; letter-spacing: .06em; text-transform: uppercase;
    color: var(--ink-soft); margin: 0 0 12px;
  }
  .roster { display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
  .roster-row {
    display: grid; grid-template-columns: minmax(200px,2fr) repeat(3, minmax(84px,1fr)) minmax(120px,1.1fr);
    gap: 0; background: var(--surface); align-items: baseline;
  }
  .roster-row > * { padding: 9px 12px; }
  .roster-row.head {
    background: var(--rule-soft); font-size: .72rem; letter-spacing: .07em;
    text-transform: uppercase; color: var(--ink-soft); font-weight: 600;
  }
  .roster .name { font-weight: 600; }
  .num { font-family: "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }

  /* ---------- company ---------- */
  article.co {
    margin-top: 38px; background: var(--surface);
    border: 1px solid var(--rule); box-shadow: var(--shadow);
  }
  .co-head { padding: 20px 22px 16px; border-bottom: 1px solid var(--rule); }
  .co-head h3 {
    font-family: Newsreader, Georgia, serif; font-weight: 600;
    font-size: 1.42rem; margin: 0 0 3px; letter-spacing: -.005em;
  }
  .anchor-line {
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: .78rem; color: var(--ink-soft); line-height: 1.7;
  }
  .coverage {
    margin: 14px 22px 0; padding: 11px 13px;
    background: var(--paper); border: 1px solid var(--rule-soft);
    font-size: .83rem; line-height: 1.6;
  }
  .coverage .lbl {
    display: block; font-size: .68rem; letter-spacing: .08em;
    text-transform: uppercase; color: var(--ink-soft); margin-bottom: 3px; font-weight: 600;
  }

  /* ---------- ladder ---------- */
  .tablewrap { overflow-x: auto; margin: 18px 0 0; }
  table.ladder { border-collapse: collapse; width: 100%; min-width: 860px; font-size: .84rem; }
  table.ladder th {
    text-align: left; font-size: .68rem; letter-spacing: .07em; text-transform: uppercase;
    color: var(--ink-soft); font-weight: 600; padding: 8px 10px;
    border-bottom: 1px solid var(--rule); white-space: nowrap;
  }
  table.ladder td { padding: 9px 10px; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
  table.ladder tbody:last-child td { border-bottom: none; }
  .inst { font-weight: 500; }
  td.amt, td.mat { font-family: "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.cls, td.doc { color: var(--ink-soft); font-size: .8rem; }
  tbody.flagged td { background: var(--flag-soft); }
  tbody.flagged .inst::after {
    content: "honest absence"; display: inline-block; margin-left: 8px;
    font-size: .64rem; letter-spacing: .06em; text-transform: uppercase;
    color: var(--flag); border: 1px solid var(--flag); padding: 1px 5px; vertical-align: 1px;
  }

  .pill {
    display: inline-block; font-size: .64rem; letter-spacing: .05em; text-transform: uppercase;
    padding: 2px 6px; border: 1px solid currentColor; white-space: nowrap;
  }
  .pill.live { color: var(--pass); }
  .pill.cap  { color: var(--accent); }
  .pill.other{ color: var(--ink-soft); }

  .evidence td { background: var(--paper); border-bottom: 1px solid var(--rule-soft); }
  .figblock { margin-bottom: 12px; padding-left: 11px; border-left: 2px solid var(--accent); }
  .figblock.bad { border-left-color: var(--fail); }
  .rowsent { padding-left: 11px; border-left: 2px solid var(--rule); }
  .rowsent blockquote, .figblock blockquote { border-left: none; padding-left: 0; }
  .plabel {
    display: block; font-size: .68rem; letter-spacing: .07em; text-transform: uppercase;
    font-weight: 600; color: var(--ink-soft); margin-bottom: 3px;
  }
  .figblock.bad .plabel { color: var(--fail); }
  .warn { font-size: .76rem; color: var(--fail); margin-bottom: 4px; }
  .outside { font-size: .76rem; color: var(--flag); margin-bottom: 4px; }
  .chip-bad {
    display: inline-block; font-size: .64rem; letter-spacing: .05em; text-transform: uppercase;
    color: var(--fail); border: 1px solid var(--fail); padding: 1px 5px; margin-left: 4px;
  }
  .blocker {
    margin: 14px 22px 0; padding: 12px 14px;
    background: var(--fail-soft); border-left: 3px solid var(--fail); font-size: .82rem;
  }
  .blocker strong { color: var(--fail); }
  .blocker ul { margin: 6px 0 0; padding-left: 18px; }
  .blocker li { margin-bottom: 3px; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: .74rem; word-break: break-word; }
  .evidence blockquote {
    margin: 0 0 6px; padding-left: 11px; border-left: 2px solid var(--accent);
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: .78rem; line-height: 1.65; color: var(--ink);
    white-space: pre-wrap; word-break: break-word;
  }
  .asprinted { font-size: .68rem; color: var(--ink-soft); font-weight: 400; margin-top: 2px; white-space: normal; }
  .placement { font-size: .72rem; color: var(--ink-soft); font-family: "IBM Plex Mono", ui-monospace, monospace; }
  .placement.notfound { color: var(--fail); font-weight: 600; }
  button.exp {
    font: inherit; font-size: .72rem; color: var(--accent); background: none;
    border: 1px solid var(--rule); padding: 2px 7px; cursor: pointer; white-space: nowrap;
  }
  button.exp:hover { border-color: var(--accent); }
  button.exp:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* ---------- criteria ---------- */
  .crit { padding: 18px 22px 22px; border-top: 1px solid var(--rule); margin-top: 18px; }
  ol.crit-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; background: var(--rule-soft); border: 1px solid var(--rule-soft); }
  ol.crit-list li { background: var(--surface); padding: 10px 12px; display: grid; grid-template-columns: 34px 96px 1fr; gap: 10px; align-items: start; }
  li.is-fail { background: var(--fail-soft); }
  li.is-attested { background: var(--flag-soft); }
  li.is-caveat { background: var(--accent-soft); }
  .cid { font-family: "IBM Plex Mono", ui-monospace, monospace; font-weight: 500; color: var(--ink-soft); font-size: .82rem; }
  .verdict { font-size: .66rem; letter-spacing: .06em; text-transform: uppercase; font-weight: 600; padding-top: 2px; }
  .verdict.pass { color: var(--pass); }
  .verdict.fail { color: var(--fail); }
  .verdict.att  { color: var(--flag); }
  .cname { font-weight: 500; font-size: .86rem; }
  .cdetail { color: var(--ink-soft); font-size: .8rem; margin-top: 2px; word-break: break-word; }

  .signblock {
    margin: 16px 22px 22px; padding: 13px 15px;
    border: 1px dashed var(--rule); font-size: .82rem; color: var(--ink-soft);
  }
  .signblock strong { color: var(--ink); }

  footer.doc { margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--rule); font-size: .8rem; color: var(--ink-soft); }
  .excl { margin-top: 10px; font-size: .8rem; }
  .excl li { margin-bottom: 5px; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>

<div class="wrap">
  <header class="doc">
    <h1>Ladder Signature Review</h1>
    <p class="standfirst">Every figure below is a field of the signature packet. Signing a name pins this state as its golden file; a later run whose filing set matches must reproduce it, field for field.</p>
    <div class="provenance" id="prov"></div>
    <div class="meta" id="meta"></div>
  </header>

  <section class="summary">
    <h2 class="section">Presented for signature</h2>
    <div class="roster" id="roster"></div>
  </section>

  <div id="companies"></div>

  <footer class="doc">
    <div id="excluded"></div>
  </footer>
</div>

<script type="application/json" id="packet">${json}</script>
<script>
  const D = JSON.parse(document.getElementById("packet").textContent);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

  document.getElementById("prov").innerHTML =
    "<strong>Generated from the pinned data, not hand-authored.</strong> Amounts display in $millions with the filing’s own printed figure beneath — the golden pins the printed one. This page is a formatter over " +
    "<code>files/session_22_sign_packet.json</code>, which is built from the same calls the golden writer makes — " +
    "<code>deriveGoldenState</code> for the pinned rows, <code>evaluateGoldenCriteria</code> for the checklist, and the " +
    "verification sheet's own locator for every character offset. Nothing on this page is retyped, and every figure shown " +
    "was checked to appear in the rendered text sheet before the packet was written.";

  document.getElementById("meta").innerHTML = [
    "as-of " + esc(D.asOf) + " (pinned)",
    "extraction prompt v" + esc(D.extractionPromptVersion),
    "narration prompt v" + esc(D.narrationPromptVersion),
    "generated " + esc(D.generatedAt.slice(0, 19).replace("T", " ")) + "Z",
  ].map((s) => "<span>" + s + "</span>").join("");

  /* ---------- roster ---------- */
  const roster = document.getElementById("roster");
  roster.innerHTML =
    '<div class="roster-row head"><div>Company</div><div>Rows</div><div>Criteria</div><div>Filings</div><div>Flagged rows</div></div>' +
    D.companies.map((c) => {
      const flags = c.rows.filter((r) => r.honestAbsence).length;
      const comp = (c.figuresNotStatedBySentence || []).length;
      return '<div class="roster-row">' +
        '<div class="name">' + esc(c.company) + "</div>" +
        '<div class="num">' + c.rows.length + "</div>" +
        '<div class="num">' + c.computedPass + "/" + c.computedTotal + "</div>" +
        '<div class="num">' + c.filingSet.length + "</div>" +
        '<div class="num">' + (flags ? flags + " honest absence" : "—") +
          (comp ? ' <span class="chip-bad">' + comp + " unverifiable</span>" : "") + "</div>" +
        "</div>";
    }).join("");

  /* ---------- companies ---------- */
  const statusPill = (r) => {
    const cls = r.isCapacity ? "cap" : r.status === "live" ? "live" : "other";
    return '<span class="pill ' + cls + '">' + esc(r.isCapacity ? "capacity" : r.status) + "</span>";
  };

  /* A pass that carries a caveat is worth a signer's eye even though it holds. */
  /* A1 — each displayed figure with the sentence that states IT, and a plain
     statement when that sentence does not, or sits outside the anchor. */
  function figureBlock(label, p) {
    if (!p) return "";
    const bad = !p.statesFigure;
    const outside = p.outsideAnchor;
    return '<div class="figblock' + (bad ? " bad" : "") + '">' +
      '<span class="plabel">' + esc(label) + ": " + esc(p.value) + "</span>" +
      (bad ? '<div class="warn">This sentence does not state this figure. The figure is real and verified upstream; what is missing is the sentence that states it, so it cannot be checked here.</div>' : "") +
      (outside ? '<div class="outside">Stated outside the anchor filing — ' + esc(p.document) + "</div>" : "") +
      "<blockquote>" + esc(p.sentence || "(no sentence recorded for this figure)") + "</blockquote>" +
      '<div class="placement' + (/NOT FOUND/.test(p.placement) ? " notfound" : "") + '">' + esc(p.document) + " · " + esc(p.placement) + "</div>" +
      "</div>";
  }

  const isCaveat = (c) =>
    c.pass === true && /NONE EXTRACTED|HONESTLY|explicitly|gap [1-9]|DOES NOT/i.test(c.detail || "");

  document.getElementById("companies").innerHTML = D.companies.map((c, ci) => {
    const rows = c.rows.map((r, ri) => {
      const id = "ev-" + ci + "-" + ri;
      const nf = /NOT FOUND/.test(r.placement);
      return '<tbody class="' + (r.honestAbsence ? "flagged" : "") + '">' +
        "<tr>" +
          "<td>" + statusPill(r) + "</td>" +
          '<td class="inst">' + esc(r.instrument) + "</td>" +
          '<td class="amt">' + esc(r.amountMillions || r.amount) +
            (r.amountMillions ? '<div class="asprinted">' + esc(r.amount) + " as printed</div>" : "") + "</td>" +
          '<td class="mat">' + esc(r.maturityDate || "—") +
            (r.dateGranularity ? ' <span style="color:var(--ink-soft)">(' + esc(r.dateGranularity) + ")</span>" : "") + "</td>" +
          '<td class="cls">' + esc(r.facilityType) +
            (r.priorityClassFrom ? '<div class="asprinted">grouping read from the ' + esc(r.priorityClassFrom === "note-statement" ? "note's prose" : r.priorityClassFrom) + "</div>" : "") + "</td>" +
          '<td class="doc">' + esc(r.sourceDocument) + "</td>" +
          '<td><button class="exp" type="button" aria-expanded="false" aria-controls="' + id + '">Sentence</button></td>' +
        "</tr>" +
        '<tr class="evidence" id="' + id + '" hidden><td colspan="7">' +
          figureBlock("Amount", r.amountProvenance) +
          figureBlock("Maturity", r.maturityProvenance) +
          '<div class="rowsent"><span class="plabel">Row sentence</span>' +
            "<blockquote>" + esc(r.sourceLine) + "</blockquote>" +
            '<div class="placement' + (nf ? " notfound" : "") + '">' + esc(r.placement) + "</div></div>" +
        "</td></tr>" +
      "</tbody>";
    }).join("");

    const crit = c.criteria.map((x) => {
      const cls = x.pass === false ? "is-fail" : x.pass === null ? "is-attested" : isCaveat(x) ? "is-caveat" : "";
      const v = x.pass === false ? '<span class="verdict fail">fail</span>'
              : x.pass === null ? '<span class="verdict att">by hand</span>'
              : '<span class="verdict pass">pass</span>';
      return '<li class="' + cls + '"><div class="cid">' + esc(x.id) + "</div>" + v +
        '<div><div class="cname">' + esc(x.name) + '</div><div class="cdetail">' + esc(x.detail) + "</div></div></li>";
    }).join("");

    return '<article class="co">' +
      '<div class="co-head"><h3>' + esc(c.company) + "</h3>" +
        '<div class="anchor-line">CIK ' + esc(c.cik) +
          (c.anchor ? " &nbsp;·&nbsp; anchor " + esc(c.anchor.form) + " filed " + esc(c.anchor.date) +
            ", period " + esc(c.anchor.reportDate || "—") : " &nbsp;·&nbsp; no anchor") +
          " &nbsp;·&nbsp; " + c.filingSet.length + " filing(s) in the pinned set</div></div>" +
      ((c.figuresNotStatedBySentence || []).length
        ? '<div class="blocker"><strong>' + c.figuresNotStatedBySentence.length +
          " figure(s) cannot be checked against a sentence.</strong> Each is real and verified upstream; " +
          "what is missing is the sentence that states it, so a signer cannot confirm it from this page. " +
          "This blocks signature for this name.<ul>" +
          c.figuresNotStatedBySentence.map((f) => "<li>" + esc(f) + "</li>").join("") + "</ul></div>"
        : "") +
      '<div class="coverage"><span class="lbl">Coverage, as rendered</span>' + esc(c.coverageLine) + "</div>" +
      '<div class="tablewrap"><table class="ladder">' +
        "<thead><tr><th>Status</th><th>Instrument</th><th>Amount</th><th>Maturity</th><th>Facility type</th><th>Source document</th><th></th></tr></thead>" +
        rows +
      "</table></div>" +
      '<div class="crit"><h2 class="section">The nine criteria</h2><ol class="crit-list">' + crit + "</ol></div>" +
      '<div class="signblock"><strong>Unsigned.</strong> Nothing is written for ' + esc(c.company) +
        " until a signature says so. Three criteria above are marked <em>by hand</em>: the tool cannot check them about itself.</div>" +
    "</article>";
  }).join("");

  /* ---------- excluded ---------- */
  if (D.excluded.length) {
    document.getElementById("excluded").innerHTML =
      "<strong>Not presented, and why.</strong> These names are in the packet and are not signable at this as-of date." +
      '<ul class="excl">' + D.excluded.map((e) =>
        "<li><strong>" + esc(e.company) + "</strong> — " + e.computedPass + "/" + e.computedTotal + " computed. " +
        e.failing.map((f) => "Criterion " + esc(f.id) + ": " + esc(f.detail)).join(" ") + "</li>"
      ).join("") + "</ul>";
  }

  /* ---------- expand ---------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button.exp");
    if (!b) return;
    const row = document.getElementById(b.getAttribute("aria-controls"));
    const open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open));
    row.hidden = open;
    b.textContent = open ? "Sentence" : "Hide";
  });
</script>
`;

mkdirSync("files", { recursive: true });
writeFileSync(OUT_PATH, html, "utf8");
console.log(`wrote ${OUT_PATH}`);
console.log(`  companies rendered: ${shown.map((c) => c.company).join(", ")}`);
console.log(`  excluded:           ${excluded.map((c) => c.company).join(", ") || "(none)"}`);
console.log(`  flagged rows:       ${shown.flatMap((c) => c.rows.filter((r) => r.honestAbsence).map((r) => `${c.company}: ${r.instrument}`)).join(" | ")}`);
