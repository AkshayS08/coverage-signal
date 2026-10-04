# Coverage Signal card spec, Demo v1

Version 1.1, Oct 4, 2026. Decisions by Akshay in Phase 1. v1.1: date display rule (3.3), CHS 9¾% item corrected (4).

## 1. What the card is for

An RM opening a card asks one question first: **what changed since last week?** The card answers that at the top, then shows the full debt position underneath, every week, whether or not anything changed.

Scope for Demo v1:

- Six names, all signed at v31: Tenet, Encompass, Molina, DaVita, CHS, Cigna.
- One card per name. No portfolio view.
- The demo uses the real latest week, even if it is quiet.
- Every card renders from the deterministic cache. Building and viewing cards bills nothing.

## 2. Card layout, top to bottom

### 2.1 Header

- Company name.
- Brief week as a date range ("Sept 26 to Oct 2, 2026").
- The filing the position comes from, with its period and filing date ("10-Q for the quarter ended June 30, 2026, filed Aug 7, 2026"), linked.

### 2.2 This week

"Last week" means since the previous brief date for that name. For a name's first brief, the trailing seven days.

**Actionable filings** are listed one per line. A filing is actionable when it changes, or could change, the debt amount, liquidity, or maturities. As a rule over the class:

- A new 10-Q or 10-K, since it carries a new position.
- 8-K Items 1.01 (material agreement entered or amended), 1.02 (agreement terminated), 2.03 (new direct financial obligation), 2.04 (event accelerating an obligation), and 2.01 where the acquisition is financed with debt.
- Any filing whose text states a debt issuance, repayment, redemption, tender, facility draw or repayment, commitment change, maturity extension, waiver, or covenant amendment.

The item number is the first signal and the text the second. Neither alone decides it, the same "either signal" shape as the borrowing-base rule.

Each actionable line shows what happened, the date, the amount, the instrument type with its labels (section 3.2), one line on why it matters, and a link to the sentence.

**Everything else** is counted in one line, with each filing linked, so nothing disappears: "2 other filings this week, none affecting debt: [8-K, Item 5.02] [DEF 14A]".

**Quiet week:** "No new filings affecting debt since [previous brief date]." The full position still follows.

### 2.3 Headlines

Three headlines. A fourth slot is reserved for the tranche mix once proper seniority and security tagging is built after the demo. Each headline is one total with its breakdown by instrument type underneath. A bare amount without its type is never shown.

**Total debt**, as of the position date.
- Breakdown lines by instrument type, drawn amounts only, each with its labels.
- Example: "Senior unsecured notes $30.9B · Commercial paper ~$1.0B".

**Liquidity**, as of the position date.
- Cash, as stated.
- Undrawn capacity, one line per facility, with type, size, and maturity.
- For a borrowing-base facility, stated availability is authoritative. Otherwise availability is size minus drawn minus letters of credit.
- A commercial paper program is never counted as liquidity. It is an issuance program, not a lender commitment.

**Due in 24 months**, from the brief date.
- One line per instrument: type with labels, amount, date.
- Underneath, the next maturity: "next: $1.5B senior unsecured notes, March 2027".
- An instrument whose maturity falls after the position date but before the brief date, with no repayment yet in a filing, shows as "matured since the position date, repayment not yet confirmed in a filing". It is never silently dropped and never assumed repaid.
- Scheduled term-loan amortization is included where the filing states a schedule. Otherwise only the final maturity counts.
- A maturity stated as a year only counts when that year-end falls inside the window, and is marked "date stated as year only".
- A maturity stated as a relative term ("364 days after funding") shows those words and is not placed in the window unless a date can be computed from stated facts.

### 2.4 Maturity ladder

- Drawn debt by year, one row per instrument, with type and labels.
- Undrawn facilities shown separately as capacity, never as $0 debt.
- Instruments repaid or matured inside the period show as events, never as $0 rows (Rule 64).
- Rolled rows (Cigna) sit under one label: "as of Dec 31, 2025, per 10-K, rolled to June 30, 2026". They are visibly separate from rows the anchor filing states.
- **Each instrument appears once.** Where the same instrument appears in two sources, for example a note on the anchor ladder from an 8-K that also sits inside the rolled 10-K base, the card shows it once, under the anchor-dated source. Identity is stated-fact identity (Rule 49: rate, maturity, amount by value and unit). The roll arithmetic is unchanged.

### 2.5 Facilities

One block per facility:

- Size, drawn, letters of credit, available, maturity.
- Borrowing-base flag where it applies, with the filer's **full sentence** behind it, not a fragment.
- Letter-of-credit sub-facilities shown as capacity (Rule 48).

### 2.6 What the tool did not show

Every withheld figure with its reason ("not stated for this date", "sentence does not state this figure"). This is the trust section. It is never hidden when empty: "Nothing withheld this week."

### 2.7 Footnote: coverage

One line on whether the ladder ties to the balance-sheet debt total.

- Ties: "Ladder ties to balance-sheet debt of $31.878B within $35M (0.11%)."
- Rolled: the same line, plus "using the rolled position".
- Gap: "Ladder covers $X of $Y. $Z is not accounted for." with a link to the coverage detail.

## 3. Display rules

### 3.1 Sources

Every amount, date, and label links to the exact sentence it came from, highlighted in the filing. That includes every "not stated" line, which links to the instrument's own sentence so the RM can read it and judge.

### 3.2 Instrument type, seniority, and security

- **Type** comes from the filing: notes, term loan A, term loan B, other term loan, revolver, ABL, commercial paper, letters of credit.
- **Seniority** (senior, subordinated) and **security** (secured, unsecured) are separate labels, each shown only where the filer states it. Never inferred.
- Fallback wording, exact:
  - Both stated: "$1.5B senior unsecured notes, March 2027"
  - Security missing: "$1.5B senior notes, March 2027 · security not stated, please refer to sources"
  - Seniority missing: "$1.5B secured notes, March 2027 · seniority not stated, please refer to sources"
  - Both missing: "$1.5B notes, March 2027 · seniority and security not stated, please refer to sources"

### 3.3 Numbers and dates

- Figures and dates are checked exactly as printed and displayed in one standard form.
- The unit word is the tool's canonical one ("million"), never the caption's inflection.
- Where a table caption declares scale, the unit comes from the caption in code (Rule 67).
- A date display never drops precision the filing printed. A bare year stays a bare year.
- A displayed date never claims more precision than the sentence it links to. Year-only stays year-only, month-year stays month-year (Rules 76 to 78).
- Approximate figures carry "~" where the filer hedged them ("approximately $1.0 billion").

## 4. Known render cases to handle

- **Cigna's four September 2025 notes** appear on the anchor ladder and inside the rolled base. Show them once (2.4). The page must not read $9B where there is $4.5B.
- **CHS borrowing base**: full ABL sentence behind the flag, not the fragment "subject to borrowing base capacity".
- CHS 9¾% notes display 2034, as the anchor states. The filed day (January 15, 2034) sits only in a pre-anchor 8-K; see the post-demo candidate.
- **Undrawn revolvers** (Cigna $6.5B, CHS ABL $1.0B) show as capacity under liquidity and facilities, never as debt.
- **Commercial paper** shows under total debt with "~" where hedged, never under liquidity.

## 5. Out of scope for Demo v1

- Portfolio view.
- Leverage (needs EBITDA, not extracted).
- Proper seniority and security tagging beyond stated labels. Post-demo, it fills headline slot 4 as the tranche mix.
- UHS, HCA, Quest, Centene.

## 6. Acceptance

A card passes when:

1. It renders from cache at $0, verified by preflight and assertFree.
2. Every figure, date, and label links to a sentence containing it.
3. No bare amount appears without its instrument type.
4. All six signed goldens still reproduce through goldenThroughLoop.
5. Akshay's read against the demo's three questions per company:
   - Does the position tie, and does it say where it comes from?
   - Is any call resting on an event, and is the event sourced?
   - Where the tool refuses, does it say why?
