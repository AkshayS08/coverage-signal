/**
 * THE CARD, AS DATA. card_spec.md v1.2.
 *
 * Every figure, date and label on a card is a SEGMENT that carries the
 * sentence it came from and the document holding that sentence (card_spec
 * 3.1, Rule 78). Text between them is plain text. A computed figure carries
 * the figures it was computed from, each with its own sentence (Rule 27), so
 * a total is never a number nobody can check.
 *
 * `cards.test.ts` walks every segment of every card and asserts the claim
 * rather than trusting the builder: a figure's sentence states it (Rule 58's
 * test), a date's sentence states it at the precision shown (Rule 77), a
 * label's sentence contains the filer's word, and a computed figure equals
 * the sum of its parts.
 */
import type { DateGranularity } from "../agent/claude";

export interface Source {
  /** The sentence, verbatim. */
  sentence: string;
  /** The filing that holds it. */
  url: string;
  /** "10-Q 2026-07-23" — which document, for the reader. */
  doc: string;
}

export type Segment =
  | { k: "text"; t: string }
  /**
   * An amount. `printed` is the figure as the filing prints it; the sentence
   * must state it. `field` names a facility figure (drawn, lettersOfCredit…),
   * whose zero is checked the way the facility guard checks one (Rule 53).
   */
  | { k: "figure"; t: string; printed: string; src: Source; field?: string; row?: string }
  /** A date shown at `granularity`; the sentence must state it at least that precisely. */
  | { k: "date"; t: string; date: string; granularity: DateGranularity; src: Source }
  /** A label word (type, seniority, security). `stated` is the filer's word, which the sentence must contain. */
  | { k: "label"; t: string; stated: string; src: Source }
  /** Arithmetic over stated figures. `usd` must equal the sum of the parts' signed values. */
  | { k: "computed"; t: string; usd: number; parts: { printed: string; usd: number; src: Source }[]; row?: string }
  /** "seniority not stated" and its kin: links to the instrument's own sentence so the reader can judge. */
  | { k: "notStated"; t: string; src: Source }
  /** A filing named by its EDGAR metadata (form, date, items), linked to the filing itself. No sentence is claimed. */
  | { k: "filing"; t: string; url: string };

export type Line = Segment[];

/**
 * CARD FACTS — the card-facts extraction's output AFTER verification
 * (lib/cards/capture/facts.ts). Every value is copied by the model with the
 * sentence that states it; code verified the sentence is in the document and
 * states the value, and the fact reproduced identically across three asks.
 * Anything that varied is not here: it is in `residual`, with the variation.
 */
export interface FactSource { sentence: string; url: string }
export interface Fact<T = string> { value: T; src: FactSource }
export interface CardFacts {
  cik: string;
  promptVersion: number;
  asks: number;
  costUsd: number;
  schedule: { period: string; amount: Fact }[];
  subFacilities: { facility: string; kind: string; amount: Fact }[];
  uncommitted: { description: Fact; amount: Fact | null }[];
  commercialPaper: { programSize: Fact | null; outstanding: Fact | null; averageRate: Fact | null; backedBy: Fact | null } | null;
  cash: { label: Fact; amount: Fact }[];
  faces: { instrument: string; face: Fact }[];
  maturities: { instrument: string; maturity: Fact }[];
  moves: {
    date: Fact;
    type: string;
    status: "completed" | "pending";
    instrument: Fact;
    face: Fact | null;
    funding: Fact | null;
    use: Fact | null;
    price: Fact | null;
  }[];
  residual: { fact: string; why: string; variation: string[] }[];
}

export interface CardSection {
  heading: string;
  /** Lines in reading order. An empty section still states why it is empty. */
  lines: Line[];
  /** Sub-blocks (one per facility, one per ladder year). */
  blocks?: { heading: Line; lines: Line[] }[];
}

export interface Card {
  cik: string;
  company: string;
  briefDate: string;
  weekFrom: string;
  weekTo: string;
  previousBrief: string | null;
  header: Line[];
  thisWeek: CardSection;
  /** card_spec v2.0 §2.3 — recent debt moves. Absent on v1 cards. */
  moves?: CardSection;
  /** v2.0 §2.4 replaces the 24-month list with the 18-month refinance window (`refi`). */
  /** v2.0 §2.4: the 18-month refinance window (`refi`) replaces v1's 24-month list (`due24`, kept only for reading v1 cards). */
  headlines: { totalDebt: CardSection; liquidity: CardSection; due24?: CardSection; refi?: CardSection };
  ladder: CardSection;
  facilities: CardSection;
  withheld: CardSection;
  coverage: CardSection;
}
