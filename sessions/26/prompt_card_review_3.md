# Session 26, part 5: card review round 3 (screenshots_v5)

Akshay read all six cards in screenshots_v5. Molina, CHS and Cigna are clean. Four findings remain on Tenet, Encompass and DaVita. Each one is a rule for the whole class, and the named cards show only the shape. Everything here is presentation built from the committed snapshots. **$0: no extraction and no model calls.** Run preflight and assertFree first. If a fix needs data the snapshots lack, stop and report it.

Standing constraints are unchanged:
- Read before write (Rule 69) and enumerate before diagnosing (Rule 63).
- Tests come first. Every rule gets an assertion over all six cards plus a negative control that must fail. Report the failure counts before and after.
- The test follows the product, never the reverse.
- Update card_spec to v3.2 before writing code.
- Commit per change. Do not push.

## R1. The ladder must reconcile to the face total (Tenet, DaVita, Encompass)

**The finding, from the screenshots' own numbers.** Check it against the snapshots before fixing.

- **Tenet:**
  - The bars sum to 13,017.
  - The caption lists $671MM of finance leases, mortgages and other notes as "not shown on the chart."
  - 13,017 + 671 = 13,688, against a face total of 13,333. The overage of 355 is exactly the scheduled other principal inside the 2026–2030 bars (45 + 143 + 72 + 57 + 38). That principal comes from the same $671MM bucket, and it is where the $260MM of in-window amortization in the call box comes from.
  - So the caption says the $671MM is not on the chart while roughly $355MM of it is. The other ~$316MM, falling after 2033, appears nowhere.
- **DaVita:**
  - The bars sum to 10,800.2. The named instruments sum to 10,647.9, which leaves 152.3 of scheduled other principal in the bars.
  - The caption excludes $39.5MM + $160.1MM = $199.6MM. Bars plus caption come to 10,999.8, against a face total of 10,847.5. That is over by 152.3, and ~47.3 is missing after 2033.
- **Encompass:** bars plus the caption's items also fail to tie. Enumerate it the same way.
- **The positive controls tie exactly:**
  - CHS: 9,420 + 350 = 9,770.
  - Molina: 3,800.
  - Cigna: 32,043.

**The rule.**
- Every dollar of face sits in exactly one place: a bar, or the caption's "not shown" list. Never both.
- Chart bars plus the caption's not-shown items equal the face total exactly.
- Carrying-value-only items are listed separately, labelled as carrying value, and never counted in the equation.
- Where the filer's schedule already includes an item's principal year by year:
  - the caption says that item's principal is "included in scheduled other principal";
  - the caption does not list the item as not shown;
  - only the part the schedule doesn't place is listed.
- The schedule's amount after the last year column ("thereafter") renders as a final bar ("2034+", or the range form when the long-ladder rule applies). It is never dropped.

**The test.**
- Assert bars + not-shown = face total on all six cards.
- Assert that no item is both in the bars and in the caption.
- Negative controls:
  - a card with the thereafter bar removed must fail;
  - a card whose caption re-lists scheduled principal must fail.

## R2. A move and a row about the same instrument must agree (Encompass)

**The finding.**
- Recent debt moves say "Refinanced · redeemed May 2026: $400MM 4.50% senior notes due 2028."
- The call box, the tile and the ladder row say "$400MM of 4.50% senior notes due 2028 are not yet refinanced."
- A reader sees the same notes as both retired and outstanding. The likely cause is a partial redemption (for example, $800MM before and $400MM remaining). Confirm the before and after amounts from the 10-Q sentence before writing anything. Do not assume.

**The rule.**
- When a move retires part of an instrument that still appears on the card, the move card states what remains: "$400MM redeemed · $400MM remains."
- The ladder row's status column carries the same note, in the §3 partial form already used on CHS and Tenet.
- Where the call box headlines that instrument, it adds one clause naming the earlier partial retirement.
- A move must match its row even when the row's maturity is year-only and the move's is month-and-year. Matching is by issuer instrument identity (coupon, labels, maturity year), never by exact date string.

**Also on this row class:**
- The Encompass 2034 row shows 491 in the Face column, with no carrying-value tag. The move card says $500MM was issued.
- A figure in the Face column is face. A carrying value is labelled "(carrying value)" everywhere it appears, including bar labels.
- Show the face where it is stated. Where only carrying value is stated, label it.

**The test.**
- For every move naming an instrument that has a ladder row, the remaining face on the row equals the stated before-amount minus the retired amount, and both surfaces show the remainder.
- Assert that no Face-column cell holds a carrying value without its tag.
- Negative controls:
  - a card with the partial note stripped must fail;
  - a card with an untagged carrying value in the Face column must fail.

## R3. No false "not stated" and no use of a withheld figure (Encompass)

**The finding.**
- The card labels the revolver "Revolver, seniority not stated." Yet the "Not shown" panel's own label for the withheld item reads "senior secured revolving credit facility."
- Facilities says "Letters of credit outstanding not stated," while "Not shown" says letters of credit of $53.6MM were withheld.
- Liquidity shows undrawn of ~$746MM, and 1,000 − 200 − 53.6 = 746.4. That suggests the withheld figure was used in the arithmetic.

**The rules.**
1. **Seniority.** If the current filing's sentence names the facility "senior secured," then seniority and security are stated. Label it that way, colour it that way, and move it out of "not stated." Check this against the sentence, not the panel label.
2. **Withheld versus not stated.** A figure that was found but withheld is never described as "not stated" anywhere on the card. Facilities says "withheld, see Not shown."
3. **Withheld figures are never used.** A withheld figure never enters any arithmetic on the card:
   - if availability is stated in a sentence, show that figure, linked;
   - if it isn't stated, show undrawn as size − drawn, and add a note that letters of credit are withheld;
   - drop the "~" unless the source says "approximately."
4. **Panel text.** "Not shown" entries start with a capital letter and name the item in the card's own vocabulary.

**The test.**
- Assert that no figure appearing in "Not shown" is an input to any displayed computation.
- Assert that no item is both labelled "not stated" and named with that attribute in a cited sentence.
- Each assertion gets a negative control.

## R4. The grey-bars caption states the real reason (DaVita)

**The finding.**
- DaVita's caption says "This company's filings state seniority or security for few of these instruments, so most bars are grey."
- Yet $4,397.9MM (41%) is labelled senior secured in the total debt bar.
- The bars are grey for two different reasons:
  - the term loans sit in scheduled other principal, because the filer's schedule doesn't split them by instrument;
  - the notes' seniority isn't stated.

**The rule.**
- The caption is computed from the grey face, by cause:
  - "Term loans appear as scheduled principal: the filer's schedule doesn't split them by instrument."
  - "The notes' seniority is not stated."
- Name only the causes that are present.
- The "few instruments" sentence appears only when not-stated face is the majority of the charted face.

**The test.**
- The caption's causes match the grey face by cause on all six cards.
- Negative control: DaVita with the old sentence must fail.

## R5. Small fixes (one commit)

1. **Encompass Aug 13 move.** The issue price has attached to the wrong clause. Make it: "Issued at 98.75% of principal, adding to the existing notes. Used to repay part of the revolver." Rule: a price phrase attaches to the issuance or redemption it describes.
2. **One coupon format per card.** CHS shows 6⅞% in the table and 10.875% in the moves. Use the anchor filing's format throughout the card.
3. **Company names in one form.** Tenet and CHS are in capitals, while Encompass and Cigna are in mixed case. Use one rule for all six.

## R6. Akshay's ruling: commercial paper backed by the revolver reduces liquidity (Cigna)

- The ~$1,000MM of commercial paper is backed by the $6,500MM revolver, so that capacity is spoken for. Undrawn revolver counted in liquidity becomes $6,500MM − ~$1,000MM CP = ~$5,500MM, and liquidity becomes ~$11,798MM.
- The liquidity note line says: "Undrawn revolver shown net of ~$1,000MM commercial paper it backs."
- The rule applies to any card where a filing states that a facility backs commercial paper.
- Assert it over all six cards, with a negative control.

## Verify and stop

- Every new assertion is green on all six cards, each with a failing negative control.
- §5.1 to §5.14 are unchanged apart from DaVita's two ruled residuals.
- goldenThroughLoop is 20/20 at $0. Preflight is 0 of 6. There are zero console errors.
- Fresh screenshots of all six cards go to sessions/26/screenshots_v6/.
- Report:
  - per finding, the before and after numbers (the ladder equation per card);
  - what the Encompass 10-Q sentence actually states about the 2028 notes.
- card_spec v3.2 is committed.

**Stop and report. Do not push.**
