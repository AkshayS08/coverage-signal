# Coverage Signal — Trigger Taxonomy (session 3 classification backbone)

The agent loop classifies every company against these 15 triggers. Each is checked; if the public filings hold no signal for it, the loop records `dataAvailable: false` rather than silently skipping it. That "searched, not found" result is deliberate — it proves the framework ran end to end and marks exactly where public data stops and internal bank data would take over.

## Design rules
- Every trigger maps to a real banking conversation. No "interesting news."
- Treasury/deposit triggers are weighted higher than credit in ranking (that's the insider skew).
- Distress triggers are flagged as "relationship," never a product pitch — the opener tone must differ.
- Detectability is marked below: PUBLIC = usually visible in an 8-K/10-Q; INTERNAL = usually only in the bank's own data (will often return `dataAvailable: false` in the demo, which is the point).

## Output shape per trigger checked
```
{
  triggerId: string,
  triggerName: string,
  fired: boolean,              // did we find a signal
  dataAvailable: boolean,      // false = we looked, public data can't show this
  evidence: string | null,     // what we found, if fired
  mappedNeed: string,
  needType: "credit" | "treasury" | "distress",
  citations: [{ form, date, url }]
}
```

## The 15 triggers

### Credit / lending
1. **Debt maturity approaching** (inside ~12-18 months) → refinancing · credit · PUBLIC
2. **New debt issuance / notes pricing** → refi or add-on financing · credit · PUBLIC
3. **Acquisition announced** → bridge financing, then permanent · credit · PUBLIC
4. **Capex program / new facility or construction** → term loan or capex facility · credit · PUBLIC
5. **Revolver near capacity + growth** → revolver upsize · credit · PUBLIC (partial — capacity from 10-Q, growth from context)
6. **Dividend recap / buyback authorization** → leverage capacity conversation · credit · PUBLIC

### Treasury / deposits (weight higher)
7. **Large cash balance building** → liquidity management, earning on idle cash · treasury · PUBLIC (from balance sheet) but shallow
8. **Asset sale / divestiture closing** → proceeds deposit + sweep · treasury · PUBLIC
9. **International expansion / rising foreign revenue** → FX hedging, cross-border cash management · treasury · PUBLIC
10. **New subsidiary / entity formation** → new operating accounts · treasury · INTERNAL (rarely in filings)
11. **IPO / secondary raise** → proceeds management, treasury build-out · treasury · PUBLIC

### Risk / hedging
12. **Floating-rate debt + rate exposure** → interest-rate hedging · credit · PUBLIC
13. **Commodity / input-cost exposure** → commodity hedging · credit · PUBLIC (from risk factors)
14. **Large FX exposure disclosed** → FX hedging program · treasury · PUBLIC

### Distress / defensive (flag as relationship, not sell)
15. **Covenant breach / waiver, or going-concern / liquidity warning** → restructuring or amendment support · distress · PUBLIC

## How the loop uses this
- For each company, walk all 15. Cheap first pass (Haiku) scans the filings for each trigger's signal.
- If a trigger's signal is ambiguous (e.g. acquisition with financing undisclosed), DIG — pull the filing detail before deciding.
- Emit per-trigger results. A company's overall verdict is "call" if any credit/treasury trigger fired; distress triggers surface separately with the relationship flag.
- Triggers that couldn't be assessed from public data return `fired: false, dataAvailable: false` — surfaced in the output as "searched, no public signal," not hidden.

## Why the "not available" results matter
The INTERNAL-tagged triggers (and shallow PUBLIC ones) will often come back `dataAvailable: false`. That is the demo's honesty and its sales pitch at once: the tool ran the full 15-trigger framework, and the blanks are precisely the treasury signals that live inside the bank. Public version proves the framework; internal version fills the blanks.
