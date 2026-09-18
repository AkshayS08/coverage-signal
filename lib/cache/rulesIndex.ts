/**
 * GENERATE docs/rules.md FROM THE BUILD LOG'S OWN HEADINGS. $0, no model calls.
 *
 * The rules index is the audit's reading list, and a hand-maintained list of
 * fifty rules is a list that disagrees with the log by the third edit.
 * So it is not hand-maintained: every line here is read out of
 * `docs/build_log.md`, and re-running this is how the index stays true.
 *
 * It DERIVES rather than describes — the same discipline the rules themselves
 * are about. If a rule's heading changes, the index changes with it; if a rule
 * has no heading, this refuses rather than quietly indexing 48 of 49.
 *
 * Run: npx tsx lib/cache/rulesIndex.ts          (writes docs/rules.md)
 *      npx tsx lib/cache/rulesIndex.ts --check  (fails if the file is stale)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOG_PATH = join(process.cwd(), "docs", "build_log.md");
const OUT_PATH = join(process.cwd(), "docs", "rules.md");

/** The highest rule number the log is expected to define. A rule added without */
/** its heading fails the completeness check below rather than vanishing. */
const HIGHEST_RULE = 50;

interface RuleHeading {
  /** The rule's number. Refinements share the number of the rule they refine. */
  n: number;
  /** The statement, with "Rule N — " stripped. */
  statement: string;
  /** Present on a refinement or a later occurrence, e.g. "refined", "seventh occurrence". */
  qualifier: string | null;
  /** The GitHub-style in-document anchor for the heading. */
  anchor: string;
  line: number;
}

/**
 * GitHub's own slug rule: lowercase, drop everything that is not a letter,
 * digit, space, hyphen or underscore, then spaces become hyphens. An em dash
 * is DROPPED rather than replaced, which is why these anchors carry a double
 * hyphen where the dash was — reproducing that is the point, since an anchor
 * that looks tidier than the one GitHub generates is an anchor that 404s.
 */
function githubAnchor(headingText: string): string {
  return headingText
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .replace(/ /g, "-");
}

function parseHeadings(log: string): RuleHeading[] {
  const out: RuleHeading[] = [];
  const lines = log.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const m = /^#{2,3} (Rule (\d+)(?:, ([^—]+?))? — (.+))$/.exec(raw.trim());
    if (!m) return;
    const [, whole, num, qualifier, statement] = m;
    out.push({
      n: Number(num),
      statement: statement.trim(),
      qualifier: qualifier ? qualifier.trim() : null,
      anchor: githubAnchor(whole),
      line: i + 1,
    });
  });
  return out;
}

const log = readFileSync(LOG_PATH, "utf-8");
const headings = parseHeadings(log);

// COMPLETENESS IS A GATE, NOT A FOOTNOTE. An index missing a rule is worse
// than no index: it reads as a complete list and is not one.
const primary = new Map<number, RuleHeading>();
const refinements: RuleHeading[] = [];
for (const h of headings) {
  if (h.qualifier === null && !primary.has(h.n)) primary.set(h.n, h);
  else refinements.push(h);
}
const missing: number[] = [];
for (let n = 1; n <= HIGHEST_RULE; n++) if (!primary.has(n)) missing.push(n);
if (missing.length) {
  console.error(
    `REFUSED: ${missing.length} rule(s) have no heading stating them in docs/build_log.md — ${missing.join(", ")}.\n` +
      `Every rule needs a "### Rule N — <statement>" heading before the index can claim to be complete.`
  );
  process.exit(1);
}

const lines: string[] = [];
lines.push("# The rules, 1 to " + HIGHEST_RULE);
lines.push("");
lines.push(
  "**Generated from `build_log.md`'s own headings by `lib/cache/rulesIndex.ts`.**"
);
lines.push(
  "Not hand-maintained: every statement below is the rule's own heading text, and"
);
lines.push(
  "every link points at the log entry that earned it. Re-run the generator after"
);
lines.push("adding a rule — it refuses to write an index with a gap in it.");
lines.push("");
lines.push(
  "Each rule is a rule over a class. The company named in its entry is the worked"
);
lines.push("example that found it, never the thing the rule is about.");
lines.push("");
lines.push("| # | The rule | Entry |");
lines.push("|---|---|---|");
for (let n = 1; n <= HIGHEST_RULE; n++) {
  const h = primary.get(n)!;
  lines.push(`| ${n} | ${h.statement} | [log](build_log.md#${h.anchor}) |`);
}
lines.push("");

if (refinements.length) {
  lines.push("## Refinements and later occurrences");
  lines.push("");
  lines.push(
    "A rule that was restated, narrowed, or hit again under its own number. These"
  );
  lines.push("do not renumber; they qualify the rule above.");
  lines.push("");
  lines.push("| # | Qualifier | What it adds | Entry |");
  lines.push("|---|---|---|---|");
  for (const h of refinements.sort((a, b) => a.n - b.n || a.line - b.line)) {
    lines.push(
      `| ${h.n} | ${h.qualifier ?? "—"} | ${h.statement} | [log](build_log.md#${h.anchor}) |`
    );
  }
  lines.push("");
}

const rendered = lines.join("\n");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT_PATH, "utf-8");
  } catch {
    console.error("REFUSED: docs/rules.md does not exist. Run without --check to write it.");
    process.exit(1);
  }
  if (current.trimEnd() !== rendered.trimEnd()) {
    console.error("STALE: docs/rules.md no longer matches build_log.md's headings. Re-run the generator.");
    process.exit(1);
  }
  console.log(`docs/rules.md is current — ${primary.size} rules, ${refinements.length} refinement(s).`);
} else {
  writeFileSync(OUT_PATH, rendered, "utf-8");
  console.log(
    `wrote docs/rules.md — ${primary.size} rules (1-${HIGHEST_RULE}, no gaps), ${refinements.length} refinement(s).`
  );
}
