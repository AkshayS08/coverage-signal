/**
 * SESSION 27 (Akshay, Nov 9, 2026) — THE PRICED CALL SET EQUALS THE CALL SET THE RUN WOULD MAKE, PER SAMPLE.
 *
 * A refresh's price must count every billed call its run would make, per sample: the base extraction, the referenced
 * 10-K note where the anchor directs to it (cached per sample under that sample's CACHE_BUST, so a sample whose note
 * answer is already stored makes no call), the digs (worst case: the full budget), proceeds-use, and the facts asks.
 * Cigna's Nov 9 pricing counted the base call only and omitted the note calls (callSet.test).
 */
export type Stage = "base" | "referenced-note" | "dig" | "proceeds-use" | "facts";
export type Call = { sample: string; stage: Stage; count: number };

/** The billed calls a refresh run would make. `noteCached` is keyed by sample ("canonical" or its bust). */
export function callSetFor(p: { samples: (string | null)[]; directsToTenK: boolean; noteCached: Record<string, boolean>; digBudget: number; factsAsks: number }): Call[] {
  const out: Call[] = [];
  for (const b of p.samples) {
    const sample = b ?? "canonical";
    out.push({ sample, stage: "base", count: 1 });
    if (p.directsToTenK && !p.noteCached[sample]) out.push({ sample, stage: "referenced-note", count: 1 });
    out.push({ sample, stage: "dig", count: p.digBudget }, { sample, stage: "proceeds-use", count: 1 });
  }
  out.push({ sample: "facts", stage: "facts", count: p.factsAsks });
  return out;
}

/** The calls the run would make that the pricing did not price (empty when the priced set equals the run's). */
export function unpricedCalls(priced: Call[], wouldMake: Call[]): string[] {
  const key = (c: Call) => `${c.sample}|${c.stage}`;
  const have = new Map(priced.map((c) => [key(c), c.count]));
  return wouldMake.filter((c) => (have.get(key(c)) ?? 0) < c.count).map((c) => `${c.stage} for ${c.sample} (${c.count} call${c.count === 1 ? "" : "s"}) is not priced`);
}
