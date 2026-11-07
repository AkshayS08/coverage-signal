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

export function shownCards(): Shown[] {
  const ciks = read(join("lib", "cards", "generated", "index.json")).ciks as string[];
  const published: Shown[] = ciks.map((cik) => ({ label: "published", cik, key: cik, card: read(join("lib", "cards", "generated", `${cik}.json`)), input: read(join("lib", "cards", "inputs", `${cik}.json`)), inputPath: join("lib", "cards", "inputs", `${cik}.json`), fixturePath: join("lib", "cards", "fixtures", `${cik}.json`) }));
  const review: Shown[] = reviewRenders().map((r) => ({ label: "review", cik: r.cik, key: `${r.cik}:review`, card: read(r.cardPath), input: read(r.inputPath), inputPath: r.inputPath, fixturePath: join("lib", "cards", "fixtures", "review", `${r.cik}.json`) }));
  return nonEmpty("the cards that can be shown or signed", [...published, ...review]);
}
