/**
 * SESSION 27 (Akshay, Nov 7, 2026) — EVERY CARD THAT CAN BE SHOWN OR SIGNED, ONE DEFINITION.
 *
 * Every acceptance and rulings check runs over this set, never only the published cards: the published brief's cards
 * (lib/cards/generated) and every review render on disk (sessions/27/refresh/<cik>_review_card.json, Molina's
 * sessions/27/molina_review_card.json), each with its own input and its own acceptance fixture. Encompass's refresh
 * showed why: its review card carried a false "not stated" no check saw, because the check ran on published cards only.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { nonEmpty } from "../testing/nonEmpty";

export type Shown = {
  /** "published" or "review". */
  label: "published" | "review";
  cik: string;
  /** A unique key: the CIK, plus ":review" for a review render. */
  key: string;
  card: any;
  input: any;
  inputPath: string;
  /** The acceptance fixture for this card's answer: lib/cards/fixtures/<cik>.json, or fixtures/review/<cik>.json. */
  fixturePath: string;
};

const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));

export function reviewRenders(): { cik: string; cardPath: string; inputPath: string }[] {
  const dir = join("sessions", "27", "refresh");
  const out = existsSync(dir)
    ? readdirSync(dir).filter((f) => /^\d{10}_review_card\.json$/.test(f)).map((f) => ({ cik: f.slice(0, 10), cardPath: join(dir, f), inputPath: join(dir, `${f.slice(0, 10)}_input.json`) }))
    : [];
  if (existsSync(join("sessions", "27", "molina_review_card.json"))) out.push({ cik: "0001179929", cardPath: join("sessions", "27", "molina_review_card.json"), inputPath: join("sessions", "27", "molina_review_input.json") });
  return out;
}

/** Every card that can be shown or signed, whatever the scope. Control material (a card cloned and broken) reads this. */
export function everyShownCard(): Shown[] {
  const ciks = read(join("lib", "cards", "generated", "index.json")).ciks as string[];
  const published: Shown[] = ciks.map((cik) => ({ label: "published", cik, key: cik, card: read(join("lib", "cards", "generated", `${cik}.json`)), input: read(join("lib", "cards", "inputs", `${cik}.json`)), inputPath: join("lib", "cards", "inputs", `${cik}.json`), fixturePath: join("lib", "cards", "fixtures", `${cik}.json`) }));
  const review: Shown[] = reviewRenders().map((r) => ({ label: "review", cik: r.cik, key: `${r.cik}:review`, card: read(r.cardPath), input: read(r.inputPath), inputPath: r.inputPath, fixturePath: join("lib", "cards", "fixtures", "review", `${r.cik}.json`) }));
  return nonEmpty("the cards that can be shown or signed", [...published, ...review]);
}

/**
 * SESSION 27 (Akshay, Nov 9): THE CARDS A CHECK RUNS OVER, BY SCOPE. Unset, every card. SHOWN_SCOPE=published gates
 * the release; "review" reports the review cards (not gating); "review:<cik>" gates that refresh's signing. A failing
 * review card blocks only its own signing (releaseGate.test).
 */
export function shownCards(): Shown[] {
  const scope = process.env.SHOWN_SCOPE ?? "";
  const all = everyShownCard();
  const inScope = !scope ? all : scope === "published" ? all.filter((s) => s.label === "published") : scope === "review" ? all.filter((s) => s.label === "review") : /^review:\d{10}$/.test(scope) ? all.filter((s) => s.key === `${scope.slice(7)}:review`) : null;
  if (!inScope) throw new Error(`SHOWN_SCOPE "${scope}" is not one of published, review, review:<cik>`);
  return nonEmpty(`the cards that can be shown or signed (scope ${scope || "all"})`, inScope);
}

/** Is this card in the current scope? An assertion about one named card counts only where it is. */
export function inScope(cik: string, label: "published" | "review"): boolean {
  return shownCards().some((s) => s.cik === cik && s.label === label);
}

/** Every suite whose checks run over shownCards(): the release runs them on each scope, a signing on its own card. */
export const SHOWN_SUITES = [
  "lib/cards/acceptance.test.ts", "lib/cards/annualReportSource.test.ts", "lib/cards/factsReadSet.test.ts", "lib/cards/falseNotStated.test.ts",
  "lib/cards/labelPredication.test.ts", "lib/cards/moveCitation.test.ts", "lib/cards/moveIntegrity.test.ts", "lib/cards/possibleMoves.test.ts", "lib/cards/rawAmount.test.ts",
  "lib/cards/refinancedTile.test.ts", "lib/cards/refreshRulings.test.ts", "lib/cards/retirementBalance.test.ts", "lib/cards/rulingsNov4.test.ts",
  "lib/cards/rulingsNov7.test.ts", "lib/cards/rulingsNov8.test.ts", "lib/cards/standingLabels.test.ts", "lib/cards/subFacilityScale.test.ts",
];
