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
