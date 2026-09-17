/**
 * SESSION 22, STAGE 3 — THE CORPUS PRIMITIVE.
 *
 * ONE RULE, AND IT IS THE ONLY REASON THIS FILE EXISTS:
 *
 *     "THE FILING DOES NOT SAY X" MAY ONLY BE CONCLUDED FROM A CORPUS THAT
 *     WAS ACTUALLY LOADED.
 *
 * An empty corpus and a corpus that says no are indistinguishable to any
 * caller that only gets a boolean back, and this project has now produced
 * that same defect SIX times, each time in a surface written days or hours
 * after the last one was logged:
 *
 *   1. Session 21's check sheet — one failed getFilingText rendered six HCA
 *      facts as unplaceable.
 *   2. `categoriesMissing`, misfiring on drawn-and-tabulated revolvers.
 *   3. `factsReferencedIn`, attributing on any-token match.
 *   4. Session 22 Stage 0's probe — totals divided by ten while one company
 *      had never been fetched.
 *   5. `checkWarm` — a blob read that THREW became `warm: false`, and every
 *      caller read that as "cold, this would bill".
 *   6. `verifyFacilities` — checked sentences against the model's
 *      self-reported `citedUrls`. Centene reported none, so the check ran
 *      against nothing and rejected all eight of its facility figures, six
 *      of them verbatim in its own anchor 10-Q. THAT ONE DELETED EVERY
 *      FACILITY A REAL COMPANY HAS.
 *
 * The sixth is why this is a primitive and not another note: the class
 * stopped being a miscounted total and started deleting instruments. Each
 * fix was correct in place and none of them fixed the class, because the
 * class is a SHAPE — a function that answers "is X in here?" with yes/no
 * when the honest answer set is yes / no / I could not look.
 *
 * So: a corpus knows whether it was loaded, `find` returns three outcomes,
 * and `absent` is unreachable unless documents are actually present. A
 * caller cannot make this mistake without deleting code.
 */
import { quoteAppearsIn } from "./verifyQuote";

export type CorpusState =
  /** Documents are loaded. An "absent" answer is a real finding about the source. */
  | "loaded"
  /** Nothing failed; there was simply nothing to load. Absence is unknowable. */
  | "empty"
  /** One or more documents could not be fetched. Absence is unknowable. */
  | "failed";

export type Lookup =
  | { outcome: "present"; url: string }
  | { outcome: "absent" }
  /** We could not look. NEVER report this as a fact about the filing. */
  | { outcome: "undetermined"; why: string };

export interface FetchFailure {
  url: string;
  message: string;
}

export class Corpus {
  readonly texts: Map<string, string>;
  readonly failures: FetchFailure[];

  constructor(texts: Map<string, string>, failures: FetchFailure[] = []) {
    this.texts = texts;
    this.failures = failures;
  }

  get state(): CorpusState {
    if (this.texts.size === 0) return this.failures.length > 0 ? "failed" : "empty";
    // PARTIAL IS NOT WHOLE. Some documents loaded and some failed means a
    // sentence we cannot find might be in the one we could not read, so
    // absence still cannot be concluded — only presence can.
    return this.failures.length > 0 ? "failed" : "loaded";
  }

  /** True only when a NEGATIVE answer from this corpus is worth anything. */
  get canConcludeAbsence(): boolean {
    return this.state === "loaded";
  }

  get size(): number {
    return this.texts.size;
  }

  private get whyNot(): string {
    if (this.state === "empty") return "no document was loaded, so absence cannot be concluded";
    return `${this.failures.length} document(s) could not be fetched (${this.failures.map((f) => f.message).join("; ").slice(0, 160)}), so absence cannot be concluded`;
  }

  /**
   * Is this quote in the corpus, and where?
   *
   * Returns "absent" ONLY from a fully loaded corpus. Otherwise
   * "undetermined", carrying the reason — which is the whole point.
   */
  find(quote: string): Lookup {
    for (const [url, text] of this.texts) {
      if (text && quoteAppearsIn(quote, text)) return { outcome: "present", url };
    }
    return this.canConcludeAbsence ? { outcome: "absent" } : { outcome: "undetermined", why: this.whyNot };
  }

  /**
   * For a surface that counts. A denominator is what was MEASURED, never
   * what was asked about — the Stage 0 defect in one method.
   */
  describe(): string {
    switch (this.state) {
      case "loaded": return `${this.texts.size} document(s) loaded`;
      case "empty": return "NO DOCUMENTS LOADED — nothing here can support a negative finding";
      case "failed": return `${this.texts.size} loaded, ${this.failures.length} FAILED — negative findings are not available`;
    }
  }
}

/**
 * Build a corpus by fetching, recording every failure rather than swallowing
 * it. A fetch that throws is a `failure`, not an absence, and the difference
 * survives all the way to the caller.
 */
export async function buildCorpus(
  urls: string[],
  fetchText: (url: string) => Promise<string>
): Promise<Corpus> {
  const texts = new Map<string, string>();
  const failures: FetchFailure[] = [];
  for (const url of urls) {
    try {
      const t = await fetchText(url);
      if (t) texts.set(url, t);
      else failures.push({ url, message: "fetched but empty" });
    } catch (e) {
      failures.push({ url, message: (e as Error).message });
    }
  }
  return new Corpus(texts, failures);
}

/** Wrap an already-fetched map. Failures are stated explicitly, never inferred from a small map. */
export function corpusOf(texts: Map<string, string>, failures: FetchFailure[] = []): Corpus {
  return new Corpus(texts, failures);
}
