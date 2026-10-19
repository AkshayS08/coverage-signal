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
  /** card_spec v3.0 — the redesigned card, built from the same items. The v2.2 sections above stay as its detail and are what §5.1–§5.14 test. */
  v3?: CardV3;
}

/** card_spec v3.0 §3.9 — the one color set for all six cards. */
export const PALETTE = {
  seniorSecured: "#1F4E79",
  juniorSecured: "#2E8B8B",
  unsecured: "#5C8DBF",
  notStated: "#9AA3AD",
  scheduledOther: "#C9CED4",
  notRefinanced: "#B4440C",
  cash: "#2E7D6B",
  undrawn: "#9CCBBE",
} as const;
export type PaletteColor = (typeof PALETTE)[keyof typeof PALETTE];

/** A status tag (§2.10). `tone` decides its look: refinanced, pending confirmation, not yet refinanced (orange), or neutral. */
export interface Tag { text: Line; tone: "refinanced" | "pending" | "orange" | "neutral" }

export interface BarSegment { usd: number; color: PaletteColor; pattern?: "stripes"; title: string; /** The filer rows this segment holds (v3.1: each shares the segment's labels). */ rows?: string[] }

export interface ChartBar {
  /** "CP", "2028", or a collapsed range "2037–56". */
  label: string;
  /** The value label above the bar: a computed figure whose parts are the source figures. */
  total: Segment;
  segments: BarSegment[];
  /** What the bar's total equals (§5.15): the filer's schedule for the year, the named instruments, or the CP outstanding. */
  source: "schedule" | "named" | "cp";
  /** A bar more than twice the next-tallest is cut to fit, with a break mark (§2.5). */
  broken: boolean;
  /** The height the bar is drawn at, $; equals the total unless broken. */
  drawUsd: number;
  instruments: number;
}

export interface CardV3 {
  header: { label: string; company: string; position: Line; filing: Segment; status: Line; actionable: Line[] };
  rolledNote: Line | null;
  call: {
    label: string;
    case: "A" | "B" | "C" | "D";
    headline: Line;
    tiles: { key: "due" | "refinanced" | "notYet"; label: string; value: Segment; sub: Line; usd: number }[];
    nextTile: { value: Segment | null; instrument: Line; date: Segment | null; away: string | null } | null;
    rows: { when: Line; body: Line; tenK: boolean; tag: Tag | null; usd: number | null; isCP: boolean }[];
    notes: Line[];
    legend: string | null;
  };
  moves: { meta: Line; title: Line[]; detail: Line | null; retires: { meta: Line; items: Line[] } | null }[];
  totalDebt: { figure: Segment; segments: BarSegment[]; legend: { color: PaletteColor; label: Line; amount: Segment }[]; notes: Line[] };
  liquidity: { figure: Segment | null; segments: BarSegment[]; legend: { color: PaletteColor; label: Line; amount: Segment }[]; notes: Line[] };
  chart: {
    bars: ChartBar[];
    /** The 18-month band: it runs from the left edge to `endFraction` of the way through bar `endIndex`. */
    window: { endIndex: number; endFraction: number; label: string };
    legend: { color: PaletteColor; pattern?: "stripes"; label: string }[];
    captions: Line[];
  };
  table: {
    rows: { matures: Line; instrument: Line; tenK: boolean; face: Segment | null; status: Tag | null; inWindow: boolean; name: string }[];
    visible: number;
    /** The filer's schedule by year, kept reachable (§2.6): the v2.2 ladder blocks. */
    schedule: { heading: Line; lines: Line[] }[] | null;
  };
  facilities: { bold: Line; sub: Line | null }[];
  notShown: Line[];
  footnote: Line;
}
