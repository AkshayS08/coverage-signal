import { extractFactTokens } from "./factTokens";

/**
 * Session 18 (post-v5): three separate real bugs — row amounts (v3), then
 * statedTotal (v4), then reconcilingLines.amount (found live in the v4
 * pilot, fixed in v5) — all had the IDENTICAL shape: a comma-grouped bare
 * number ("45,828", "10,781,013", "( 66,503 )") with no scale word and
 * often no "$" either, silently read downstream as literal face-value
 * dollars instead of the thousands/millions the filing's table actually
 * meant. Three occurrences of the same prompt instruction ("unit always
 * attached") failing to hold across three different fields is a signal the
 * fix belongs in CODE, at the schema boundary, not in prompt wording asked
 * a fourth time — the same reasoning that moved date-fabrication detection
 * into normalizeEventDate (factGuard.ts) instead of relying on the prompt
 * alone. This is the one validator every money-shaped extraction field
 * passes through before it's trusted for arithmetic (the checksum) or a
 * card decision (cashAmount's D2 gate).
 *
 * Not a duplicate of lib/events/factBase.ts's own hasDeterminableScale — that
 * one runs much later, on already-chosen CARD DISPLAY figures, and
 * deliberately TRUSTS a bare comma-grouped number (by that point it's
 * already passed tokenHasDeterminableScale's sentence-structure gate
 * upstream, so the ambiguity this file exists for has already been
 * resolved). This one runs at the SCHEMA BOUNDARY, directly on a raw
 * extracted field with no sentence-structure context available at all — the
 * exact layer all three real missing-unit bugs occurred at — so it is
 * deliberately stricter: a bare comma-grouped number is NOT trusted here.
 *
 * Deliberately reuses factTokens.ts's existing money-token classification
 * rather than a fresh regex — hasMoneyValue (moneyValue !== undefined)
 * already means "extractMoneyUnitSuffixed or extractMoneySmallDollar
 * matched," both self-contained, scale-resolved token shapes. A bareNumber
 * token (moneyUnitType "currency" OR "count") is exactly the ambiguous
 * comma-grouped case all three bugs shared — verifyQuote.ts's own doc
 * comment already establishes that a bare "$" on a table figure is NOT
 * proof of true face value (SEC tables routinely glue a "$" onto a
 * thousands-scale row figure with the real scale note living only in a
 * caption elsewhere) — so "has $" alone does not count as determinable
 * here either, deliberately stricter than verifyQuote's table-row matching
 * (which can safely resolve that ambiguity by consulting the SOURCE TEXT's
 * caption; a standalone extracted field has no such caption to consult).
 */
export interface MoneyScaleCheck {
  determinable: boolean;
  /** Present only when determinable is false — the raw value that failed, for logging. */
  raw?: string;
}

/**
 * Session 18 (post-v12): checkMoneyScale was backwards at the top end. A
 * comma-grouped figure becomes a `bareNumber` token regardless of
 * magnitude, so "$1,000,000,000" — written out to the dollar, unambiguous
 * by construction — was rejected as indeterminate, while "$ 549" was
 * accepted. Live cost: all four of Cigna's issuedTranches and its
 * cashAmount were dropped for being *too precise*.
 *
 * The ambiguity this validator exists for is a SCALED TABLE CELL: "1,481"
 * printed under an "(In millions)" caption. That ambiguity has a ceiling. A
 * bare figure at or above this threshold cannot be a scaled cell for any
 * plausible issuer — reading it as thousands would put a single line item
 * above $100 billion, and as millions above $100 trillion. Measured against
 * this book's real data, the largest genuinely-scaled table figure anywhere
 * across all 10 companies is DaVita's "10,847,516" (thousands, $10.8B) at
 * 1.08e7 — roughly 10x of headroom below the threshold — while the values
 * this recovers ($750,000,000 and up) all sit above it. Written as a
 * magnitude rule rather than a digit-count or trailing-zeros rule because
 * those both misfire on real data: DaVita's 8-digit figure IS scaled, and
 * plenty of genuine full-dollar amounts end in round zeros.
 */
const MAX_PLAUSIBLE_SCALED_TABLE_FIGURE = 100_000_000;

/**
 * True when this amount field is the accounting convention for nil — a dash,
 * alone, with nothing but a currency glyph and whitespace around it. Exported
 * because three layers need the SAME answer: the scale check (which must not
 * call it indeterminate), position.ts's parseMoneyAmount (which must value it
 * at 0, not fail to parse), and the render layer (which marks the tranche
 * repaid). A dash sitting inside a figure — a minus sign, a numeric range —
 * is deliberately not matched.
 */
export function isStatedZeroAmount(raw: string | null): boolean {
  if (raw === null) return false;
  return /^[\s$£€¥]*[-‐-―]+[\s$£€¥]*$/.test(raw);
}

export function checkMoneyScale(raw: string | null): MoneyScaleCheck {
  if (raw === null || !raw.trim()) return { determinable: true }; // null/empty is a valid "nothing stated" — not a scale failure
  // Parens can fall in more than one place around a negative accounting
  // figure — "($66,503 thousand)" (whole value wrapped) and "$(66,503)
  // thousand" (dollar outside, scale word after) have both been seen for
  // real from the model. Either shape breaks extractMoneyUnitSuffixed's
  // strict $-digits-scaleword adjacency requirement if the parens are left
  // in. Stripping them here (scale determinability doesn't care about
  // sign) mirrors position.ts's own parseMoneyAmount, which already does
  // this for the identical reason — the two must treat the same input
  // consistently or a value could parse fine downstream while still being
  // wrongly flagged as indeterminate here.
  const withoutParens = raw.replace(/[()]/g, "");
  // C1 (Session 18, post-stage-2) — AN EM-DASH IS A STATED ZERO.
  //
  // "$ —" in an amount column is the accounting convention for nil, and nil
  // is a FACT: the tranche was repaid. Treating it as an undeterminable scale
  // dropped the row entirely, which loses that fact and inflates the drop
  // count with entries that were transcribed perfectly. Seven of the fourteen
  // base-ladder drops measured this session are this shape — six Cigna notes
  // repaid or reclassified at year end, and Quest's 3.45% Senior Note due
  // June 2026, matured in the quarter the filing reports.
  //
  // Scoped tightly: the whole field must be a dash, optionally with a
  // currency glyph and whitespace. A dash INSIDE a figure is a minus sign or
  // a range and is not touched.
  if (isStatedZeroAmount(withoutParens)) return { determinable: true };
  const tokens = extractFactTokens(withoutParens).filter((t) => t.kind === "money");
  if (tokens.length === 0) return { determinable: false, raw }; // no money-shaped token at all in a field meant to be one

  // Session 18 (post-v14): "$ 549" used to be accepted here as a
  // determinable FIVE HUNDRED FORTY-NINE DOLLARS, while "$1,000,000,000"
  // was rejected — precisely backwards. The cause was trusting
  // `moneyValue !== undefined`, which extractMoneySmallDollar sets for any
  // small "$"-tagged figure with no unit word. That contradicted this
  // file's own doc comment above, which already states a bare "$" on a
  // table figure is NOT proof of face value. Cigna's rows are exactly this
  // shape: "$ 549" under an "(In millions)" caption is $549 MILLION, and
  // accepting it as $549 is a silent million-fold error that Check 1 cannot
  // catch (a running-total walk is scale-invariant).
  //
  // Determinable now requires one of three POSITIVE signals, never the mere
  // presence of a parseable number:
  //   1. an explicit scale word or single-letter suffix in the value itself;
  //   2. a per-share token — a RATE, unambiguous by construction, and never
  //      a scaled table cell (guards genuine "$0.78 per share" figures,
  //      which would otherwise start failing);
  //   3. a magnitude too large to be a scaled cell (see the threshold).
  // Everything else stays indeterminate and is resolved, if at all, by the
  // filing's own governing declaration (lib/agent/loop.ts's
  // deriveScaleFromFilingDeclaration) — or dropped. Nothing is inferred.
  const hasExplicitScaleWord = scaleWordFromDeclaration(withoutParens) !== null || /\d\s*[bmk]\b/i.test(withoutParens);
  const hasPerShareToken = tokens.some((t) => t.moneyUnitType === "per-share");
  const hasUnscalableMagnitude = tokens.some(
    (t) => Math.abs(t.moneyValue ?? t.bareNumber ?? 0) >= MAX_PLAUSIBLE_SCALED_TABLE_FIGURE
  );
  const determinable = hasExplicitScaleWord || hasPerShareToken || hasUnscalableMagnitude;
  return determinable ? { determinable: true } : { determinable: false, raw };
}

export function hasDeterminableMoneyScale(raw: string | null): boolean {
  return checkMoneyScale(raw).determinable;
}

/**
 * Session 18 (post-v11) — the FOURTH occurrence of the missing-scale class
 * (row amounts → statedTotal → reconcilingLines.amount → scheduleSequence),
 * and the point at which asking the prompt a fourth time was ruled out in
 * favour of a code fix.
 *
 * The new shape, found live in Cigna's 10-K: a filing declares its table's
 * unit ONCE, in the table's own header/caption ("(In millions)"), rather
 * than repeating it on every row. The rows themselves then legitimately
 * read "$ 549" / "$ 1,481" with no unit attached anywhere on the row — so
 * checkMoneyScale (correctly, on the information it has) called 20 of
 * Cigna's 40 entries indeterminate and dropped them. Worse, the ones it did
 * NOT drop were the silent failure: a comma-free "$ 549" resolves as a
 * determinable $549 in LITERAL dollars, off by a factor of a million from
 * the $549 million the table's caption actually declared. (Check 1 cannot
 * catch that — a running-total walk is scale-invariant, so uniformly wrong
 * scale still ties perfectly. Check 2 caught it, which is exactly the split
 * the two-check design exists for.)
 *
 * So the declared unit is now captured verbatim as its own extraction field
 * (claude.ts's scheduleTableUnit / priorScheduleTableUnit /
 * balanceSheetTableUnit) and applied HERE, in code, to the amounts of that
 * table and no other. Deliberately narrow:
 *   - The row wins ONLY when it carries its OWN EXPLICIT SCALE WORD
 *     ("$2.75 billion"). "Already parses as determinable" is deliberately
 *     NOT the test — that was this function's own first cut, and its golden
 *     test caught it: "$ 549" parses perfectly well as a determinable $549
 *     in literal dollars, so a determinability test would have skipped
 *     precisely the rows Cigna got silently wrong by a factor of a million,
 *     while appearing to fix the problem. verifyQuote.ts's own doc comment
 *     already establishes the principle this rests on — a bare "$" glued
 *     onto a table figure is NOT proof of true face value; the caption is
 *     the authority for any row that doesn't name its own scale.
 *   - An amount with no unit AND no table declaration stays indeterminate
 *     and is still dropped, exactly as before. This is not a fallback that
 *     guesses a scale; it only ever applies a scale the filing itself
 *     printed.
 *   - The rewritten value must ITSELF pass checkMoneyScale, or the original
 *     is returned unchanged — the fix can never manufacture a determinable
 *     value out of something the shared validator still can't read.
 */
const SCALE_WORDS = ["billion", "million", "thousand"] as const;

/**
 * The scale word inside a verbatim table caption ("(In millions)",
 * "(amounts in thousands)", "dollars in millions except per share data"),
 * or null when the caption declares no scale at all. Reuses the same closed
 * scale vocabulary factTokens.ts already parses on the other side ("$549
 * million") rather than introducing a second, possibly-disagreeing notion
 * of what a unit word is — this is not a company-specific vocabulary guard
 * of the kind this project rules out elsewhere, it's the universal, closed
 * set of SI-style scale words the money tokenizer already depends on.
 */
export function scaleWordFromDeclaration(declaration: string | null): string | null {
  if (!declaration) return null;
  const lower = declaration.toLowerCase();
  return SCALE_WORDS.find((w) => lower.includes(w)) ?? null;
}

/**
 * An amount that already carries its own scale, by either of the two ways
 * an amount can: it names a scale word ("$2.75 billion"), or it is written
 * out to full dollar precision and is therefore too large to be a scaled
 * table cell ("$1,000,000,000" — see MAX_PLAUSIBLE_SCALED_TABLE_FIGURE).
 *
 * Both must block the table caption from being applied. The second is not
 * hypothetical: once the magnitude rule made "$1,000,000,000" determinable,
 * a naive "does it name a scale word" test would have appended the
 * caption's unit to it and produced "$1,000,000,000 million" — turning a
 * correct $1B into $1 quadrillion. The two fixes in this file interact, and
 * this is where they are reconciled.
 */
export function isSelfDescribingAmount(amount: string | null | undefined): boolean {
  // SESSION 22, STAGE 7 — A NULL AMOUNT IS NOT A CRASH.
  //
  // Found by a reproducibility re-ask: one fresh Tenet extraction returned a
  // sequence entry with a null amount, and the whole run died here on
  // `amount.replace`. The type said `string`, the schema says amount is
  // required, and the model does not always agree — which is the entire
  // reason every other field in this pipeline is defended at the boundary
  // rather than trusted from its declaration.
  //
  // An amount that is not a string describes no scale of its own, which is
  // exactly what `false` means here. The entry then falls through to the
  // normal derivation path, where a missing sourceLine or an unlocatable one
  // already returns it untouched. Nothing is invented and nothing is lost;
  // the run survives to report what it found.
  //
  // It surfaced on the demo opener, on the third re-ask, after the same
  // company had run clean dozens of times this session — which is the
  // argument for x3 in one line.
  if (typeof amount !== "string") return false;
  if (scaleWordFromDeclaration(amount)) return true;
  const tokens = extractFactTokens(amount.replace(/[()]/g, "")).filter((t) => t.kind === "money");
  return tokens.some((t) => t.bareNumber !== undefined && Math.abs(t.bareNumber) >= MAX_PLAUSIBLE_SCALED_TABLE_FIGURE);
}

/** Applies a table's own declared unit to ONE amount. See the block comment above for the exact, deliberately narrow contract — in particular why the row-wins test is "states its own scale," never "already parses." */
export function applyTableUnitToAmount(amount: string, declaration: string | null): string {
  const word = scaleWordFromDeclaration(declaration);
  if (!word) return amount; // no declaration -> stays as-is; if it was indeterminate it is still dropped downstream
  if (isSelfDescribingAmount(amount)) return amount; // the row already carries its own scale -> the row wins
  const candidate = `${amount} ${word}`;
  return checkMoneyScale(candidate).determinable ? candidate : amount;
}
