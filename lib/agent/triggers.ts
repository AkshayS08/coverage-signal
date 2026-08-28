export type NeedType = "credit" | "treasury" | "distress";
export type Detectability = "PUBLIC" | "INTERNAL";

export interface TriggerDef {
  id: string;
  name: string;
  /** What the signal looks like in public filings — fed to the model verbatim. */
  signal: string;
  mappedNeed: string;
  needType: NeedType;
  detectability: Detectability;
  /**
   * 8-K item codes that hint this trigger might be present (free EDGAR
   * metadata, zero fetch cost) — used to prioritize which filings get their
   * full text pulled before any model call.
   */
  itemCodes?: string[];
}

export const TRIGGERS: TriggerDef[] = [
  // Credit / lending
  {
    id: "debt-maturity",
    name: "Debt maturity approaching",
    signal:
      "A material debt tranche (notes, term loan, revolver) matures within roughly the next 12-18 months, per the debt footnote or liquidity discussion.",
    mappedNeed: "Refinancing",
    needType: "credit",
    detectability: "PUBLIC",
  },
  {
    id: "new-debt-issuance",
    name: "New debt issuance / notes pricing",
    signal:
      "The company priced new notes, entered a new credit agreement, or drew a new term loan.",
    mappedNeed: "Refi or add-on financing",
    needType: "credit",
    detectability: "PUBLIC",
    itemCodes: ["1.01", "2.03"],
  },
  {
    id: "acquisition-announced",
    name: "Acquisition announced",
    signal: "The company announced or completed an acquisition of another business.",
    mappedNeed: "Bridge financing, then permanent",
    needType: "credit",
    detectability: "PUBLIC",
    itemCodes: ["1.01", "2.01"],
  },
  {
    id: "capex-program",
    name: "Capex program / new facility or construction",
    signal:
      "A new facility, plant, or major construction/capex program is disclosed in the MD&A or an 8-K.",
    mappedNeed: "Term loan or capex facility",
    needType: "credit",
    detectability: "PUBLIC",
  },
  {
    id: "revolver-near-capacity",
    name: "Revolver near capacity + growth",
    signal:
      "The revolving credit facility's drawn balance is close to its capacity, in a context of business growth. Capacity/drawn amounts come from the 10-Q debt footnote; growth context from MD&A. Often only partially visible.",
    mappedNeed: "Revolver upsize",
    needType: "credit",
    detectability: "PUBLIC",
  },
  {
    id: "dividend-buyback",
    name: "Dividend recap / buyback authorization",
    signal: "A new dividend, special dividend, or share buyback authorization was announced.",
    mappedNeed: "Leverage capacity conversation",
    needType: "credit",
    detectability: "PUBLIC",
    itemCodes: ["7.01", "8.01"],
  },

  // Treasury / deposits
  {
    id: "large-cash-balance",
    name: "Large cash balance building",
    signal:
      "Cash and equivalents on the balance sheet are large and/or growing quarter over quarter.",
    mappedNeed: "Liquidity management, earning on idle cash",
    needType: "treasury",
    detectability: "PUBLIC",
  },
  {
    id: "asset-sale",
    name: "Asset sale / divestiture closing",
    signal: "The company sold or is closing the sale of a business unit or asset.",
    mappedNeed: "Proceeds deposit + sweep",
    needType: "treasury",
    detectability: "PUBLIC",
    itemCodes: ["1.01", "2.01"],
  },
  {
    id: "international-expansion",
    name: "International expansion / rising foreign revenue",
    signal:
      "Foreign/international revenue is growing as a share of total revenue, per the segment or geographic footnote.",
    mappedNeed: "FX hedging, cross-border cash management",
    needType: "treasury",
    detectability: "PUBLIC",
  },
  {
    id: "new-subsidiary",
    name: "New subsidiary / entity formation",
    signal:
      "A new subsidiary or legal entity was formed. Rarely disclosed in filings unless tied to a reported acquisition.",
    mappedNeed: "New operating accounts",
    needType: "treasury",
    detectability: "INTERNAL",
    itemCodes: ["1.01"],
  },
  {
    id: "ipo-secondary",
    name: "IPO / secondary raise",
    signal: "The company completed or announced an IPO or secondary equity offering.",
    mappedNeed: "Proceeds management, treasury build-out",
    needType: "treasury",
    detectability: "PUBLIC",
    itemCodes: ["3.02", "8.01"],
  },

  // Risk / hedging
  {
    id: "floating-rate-debt",
    name: "Floating-rate debt + rate exposure",
    signal:
      "A meaningful share of outstanding debt is floating-rate (tied to SOFR or similar), per the debt footnote.",
    mappedNeed: "Interest-rate hedging",
    needType: "credit",
    detectability: "PUBLIC",
  },
  {
    id: "commodity-exposure",
    name: "Commodity / input-cost exposure",
    signal: "Material exposure to commodity or input-cost volatility, per the risk factors.",
    mappedNeed: "Commodity hedging",
    needType: "credit",
    detectability: "PUBLIC",
  },
  {
    id: "fx-exposure",
    name: "Large FX exposure disclosed",
    signal:
      "Material foreign-currency exposure disclosed in the quantitative/qualitative market risk section (Item 3).",
    mappedNeed: "FX hedging program",
    needType: "treasury",
    detectability: "PUBLIC",
  },

  // Distress / defensive
  {
    id: "covenant-breach",
    name: "Covenant breach / waiver, or going-concern / liquidity warning",
    signal:
      "A covenant breach, waiver, going-concern qualification, or liquidity warning is disclosed.",
    mappedNeed: "Restructuring or amendment support",
    needType: "distress",
    detectability: "PUBLIC",
    itemCodes: ["2.04", "1.03"],
  },
];

/**
 * SESSION 19, ITEM 2a — WHICH TRIGGERS RETURN AN ARRAY.
 *
 * The rule, applied once to the class rather than per company: a trigger
 * whose real-world instance count IN ONE PERIOD is plausibly greater than
 * one returns an array of instances. A genuinely singular CONDITION — a cash
 * balance, a covenant status, a floating-rate exposure — stays scalar,
 * because there is only ever one of it to state.
 *
 * The distinction is EVENT versus CONDITION, and it is worth naming because
 * it does the work: an event happens, is dated, and can happen again next
 * week; a condition obtains, is measured, and has exactly one value at a
 * time. A company can close two divestitures in a quarter. It cannot have
 * two cash balances.
 *
 * `debt-maturity` is absent from this list because it already returns an
 * array of a richer shape — an ordered row/adjustment/subtotal sequence that
 * has to walk arithmetically — and nothing here replaces it.
 */
export const MULTI_INSTANCE_TRIGGERS = new Set<string>([
  "asset-sale",
  "acquisition-announced",
  "capex-program",
  "ipo-secondary",
  "dividend-buyback",
  "new-subsidiary",
]);

/**
 * The two calls that were close, recorded so the next person does not have
 * to re-derive them:
 *
 * `new-debt-issuance` — DECIDED NO, this session. It is plainly a
 * multi-instance event (one filer priced $500M in May and a $100M add-on in
 * August, and today those collapse into one verdict), and it already returns
 * `issuedTranches`. But that array is at the TRANCHE level, which is what
 * the position layer consumes as ladder rows. Supporting several ISSUANCES
 * each with several tranches is a NESTING change, not an array change — it
 * needs a tranche-to-issuance association that nothing currently carries.
 * Different shape, different risk, its own decision. The gap is real and
 * stated rather than half-fixed.
 *
 * `revolver-near-capacity` — DECIDED SCALAR. A company can hold several
 * credit facilities, so the instance count argument is available. It loses
 * to the event/condition test: "near capacity" is a utilization state read
 * at a point in time, not something that occurs. A second facility is
 * another instrument, not a second event.
 */
