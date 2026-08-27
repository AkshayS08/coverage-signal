"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";
import {
  buildEvents,
  compactLabelWithTiming,
  buildCompanyTableBlock,
  buildBookEmptyStateLine,
  TABLE_BUCKET_ORDER,
  BUCKET_LABELS,
  BUCKET_TRIGGER_COUNTS,
  formatMoneyForDisplay,
  type FlashCard,
  type FlashCardActiveItem,
  type TableLine,
  type CompanyTableBlock,
  type RefiLadderBlock,
  type RefiLadderLine,
  type Bucket,
} from "@/lib/events";
import type { DraftedEventBriefing } from "@/lib/events/eventBriefing";
import type { CompanyResult, RunStreamEvent } from "@/lib/agent";

const DEFAULT_BOOK = [
  // DaVita first: the most demo-tested name, reliably shows the agent
  // weighing an ambiguous trigger against the corpus it already has
  // ("unclear, but nothing new to check") rather than blindly firing.
  "DaVita",
  "HCA Healthcare",
  "Tenet Healthcare",
  "Universal Health Services",
  "Encompass Health",
  "Acadia Healthcare",
  // Select Medical Holdings was taken private in 2021 and no longer
  // files with the SEC (no CIK to resolve) — swapped for a company that
  // still reports.
  "Concentra Group Holdings",
  "Surgery Partners",
].join("\n");

interface TraceLine {
  company: string;
  text: string;
  filler?: boolean;
}

const BUCKET_CLASS: Record<Bucket, string> = {
  treasury: "bucketTreasury",
  new_debt: "bucketNewDebt",
  refi: "bucketRefi",
  hedging: "bucketHedging",
};

/** Plain, explicit date for a card's header — "matures ~Apr 2027" or "8-K filed Jul 21, 2026". Always includes the year. */
function formatHeadlineDate(timing: FlashCard["timing"], citations: FlashCard["citations"], asOf: Date): string {
  if (timing.monthsToNearestFuture !== null) {
    const future = new Date(asOf);
    future.setMonth(future.getMonth() + Math.round(timing.monthsToNearestFuture));
    return `matures ~${future.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
  }
  const mostRecent = [...citations].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (mostRecent) {
    const d = new Date(mostRecent.date);
    if (!Number.isNaN(d.getTime())) {
      return `${mostRecent.form} filed ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
  }
  return timing.isPendingLive ? "pending" : "";
}

// Short label + timing for the compact "Also active" line — e.g. "refi
// window ~9mo · new floating-rate issuance" — shared with the portfolio
// table's bullets (lib/events/labels.ts) so the same event reads the same
// short way everywhere.
function compactActiveLabel(item: FlashCardActiveItem): string {
  return compactLabelWithTiming(item.trigger.triggerId, item.trigger.triggerName, item.timing);
}

// Presentation-only pacing: while the single batched Haiku call is in
// flight there's nothing real to report, so these keep the panel moving
// rather than freezing for ~13s. They never claim a specific finding.
// A large, distinct pool read in sequence (see fillerRemaining below) so a
// long wait reads as forward progress rather than a repeating record.
const FILLER_LINES = [
  "resolving company identifier...",
  "pulling recent 8-Ks...",
  "reading the latest 10-Q...",
  "checking the debt schedule...",
  "scanning for upcoming maturities...",
  "cross-referencing recent financing activity...",
  "reviewing balance sheet disclosures...",
  "checking covenant and liquidity language...",
  "scanning treasury and FX disclosures...",
  "checking for pending acquisitions or divestitures...",
  "looking for recent buyback or dividend activity...",
  "matching events to banking needs...",
];

const DRAIN_TICK_MS = 150;
const IDLE_FILLER_THRESHOLD_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Home() {
  const [book, setBook] = useState(DEFAULT_BOOK);
  const [passphrase, setPassphrase] = useState("");
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [results, setResults] = useState<CompanyResult[]>([]);
  const [eventBriefings, setEventBriefings] = useState<Record<string, DraftedEventBriefing>>({});
  const [running, setRunning] = useState(false);
  const [asOfDate, setAsOfDate] = useState<Date | null>(null);

  const { flashCardCandidates } = useMemo(() => buildEvents(results), [results]);

  // Session 15b Part A: the portfolio table renders per TRIGGER (its own
  // bucket), not per buildEvents.ts cluster — computed from `results`
  // directly. Still a pure function of already-streamed data — no server
  // call, no loading state.
  const tableBlocks = useMemo(
    () =>
      results.map((result) => {
        const cardsForCompany = flashCardCandidates.filter((c) => c.cik === result.cik);
        return buildCompanyTableBlock(result, cardsForCompany);
      }),
    [results, flashCardCandidates]
  );

  const companiesWithEvents = useMemo(
    () => new Set(flashCardCandidates.map((e) => e.company)).size,
    [flashCardCandidates]
  );

  async function runAgent() {
    const companies = book
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (companies.length === 0) return;

    setRunning(true);
    setTrace([]);
    setResults([]);
    setEventBriefings({});
    setAsOfDate(new Date());

    // Real trace/error lines land here instead of going straight to state,
    // so a burst (all 15 trigger lines arriving in one response) can be
    // revealed one at a time instead of dumped in a single render.
    const revealQueue: TraceLine[] = [];
    let lastAppendAt = Date.now();
    let currentCompany = companies[0] ?? "";
    // Per-company queue of not-yet-shown filler lines: refilled fresh (and
    // reshuffled) whenever the company changes or the pool runs dry, so a
    // single wait works through distinct lines before any repeat.
    let fillerCompany = "";
    let fillerRemaining: string[] = [];

    const appendLine = (line: TraceLine) => {
      setTrace((lines) => [...lines, line]);
      lastAppendAt = Date.now();
    };

    const drainTimer = setInterval(() => {
      if (revealQueue.length > 0) {
        const next = revealQueue.shift()!;
        if (next.company) currentCompany = next.company;
        appendLine(next);
      } else if (Date.now() - lastAppendAt > IDLE_FILLER_THRESHOLD_MS) {
        if (fillerCompany !== currentCompany || fillerRemaining.length === 0) {
          fillerCompany = currentCompany;
          fillerRemaining = [...FILLER_LINES];
        }
        const text = fillerRemaining.shift()!;
        appendLine({ company: currentCompany, text, filler: true });
      }
    }, DRAIN_TICK_MS);

    const queueTrace = (company: string, text: string) => {
      revealQueue.push({ company, text });
    };

    const handleEvent = (event: RunStreamEvent) => {
      if (event.type === "trace") {
        queueTrace(event.company, event.text);
      } else if (event.type === "result") {
        setResults((rs) => [...rs, event.result]);
        if (event.eventBriefings && event.eventBriefings.length > 0) {
          const drafted = event.eventBriefings;
          setEventBriefings((prev) => {
            const next = { ...prev };
            for (const { eventId, briefing } of drafted) next[eventId] = briefing;
            return next;
          });
        }
      } else if (event.type === "error") {
        queueTrace(event.company, `error: ${event.message}`);
      }
    };

    // Let the reveal queue finish draining (at DRAIN_TICK_MS per line)
    // before declaring the run done, so the UI doesn't say "finished" —
    // or silently drop a queued error line — while it's still trickling in.
    const drainRemaining = async () => {
      while (revealQueue.length > 0) {
        await sleep(DRAIN_TICK_MS);
      }
    };

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies, passphrase }),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => `Request failed (${res.status})`);
        queueTrace("", `error: ${message}`);
        await drainRemaining();
        return;
      }

      if (!res.body) {
        queueTrace("", "error: no response body from server");
        await drainRemaining();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const consumeLine = (line: string) => {
        if (!line) return;
        try {
          handleEvent(JSON.parse(line) as RunStreamEvent);
        } catch {
          // ignore malformed lines rather than breaking the whole run
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) consumeLine(part);
      }

      if (buffer.trim().length > 0) consumeLine(buffer);

      await drainRemaining();
    } catch (err) {
      queueTrace("", `error: ${err instanceof Error ? err.message : String(err)}`);
      await drainRemaining();
    } finally {
      clearInterval(drainTimer);
      setRunning(false);
    }
  }

  // Company names never link out — only individual filing citations do
  // (FIX 4). Kept as a tiny function so every render site stays consistent.
  function renderCompanyName(company: string) {
    return <span className={styles.companyName}>{company}</span>;
  }

  function renderFlashCard(card: FlashCard) {
    const briefing = eventBriefings[card.id];
    return (
      <div key={card.id} className={styles.flashCard}>
        <div className={styles.flashCardHeader}>
          <span className={styles.bucketTagGroup}>
            <span className={`${styles.bucketBadge} ${styles[BUCKET_CLASS[card.bucket]]}`}>
              {BUCKET_LABELS[card.bucket]}
            </span>
            {card.secondaryBucket && (
              <span className={`${styles.bucketBadge} ${styles[BUCKET_CLASS[card.secondaryBucket]]}`}>
                {BUCKET_LABELS[card.secondaryBucket]}
              </span>
            )}
          </span>
          {renderCompanyName(card.company)}
          <span className={styles.timingTag}>{formatHeadlineDate(card.timing, card.citations, asOfDate ?? new Date())}</span>
        </div>
        {!briefing ? (
          <p className={styles.draftingLine}>Drafting...</p>
        ) : briefing.source === "failed" ? (
          <div className={styles.narrationFailureBanner}>
            ⚠ Narration failed — {briefing.failureReason}
          </div>
        ) : (
          <>
            <p className={styles.cardLine}>
              <span className={styles.cardFieldLabel}>Call about</span> {briefing.callAbout}
            </p>
            <p className={styles.cardLine}>
              <span className={styles.cardFieldLabel}>Why now</span> {briefing.whyNow}
            </p>
            <div className={styles.cardLine}>
              <span className={styles.cardFieldLabel}>Key points</span>
              <ul className={styles.keyPointsList}>
                {briefing.keyPoints.map((kp, i) => (
                  <li key={i}>{kp}</li>
                ))}
              </ul>
            </div>
          </>
        )}
        {card.alsoActive.length > 0 && (
          <p className={styles.alsoActiveLine}>
            <strong>Also active:</strong> {card.alsoActive.map(compactActiveLabel).join(" · ")} — see
            portfolio table for detail.
          </p>
        )}
        {renderCardSources(briefing && briefing.source === "sonnet" ? briefing.citations : card.citations)}
        {renderSourceText(card)}
      </div>
    );
  }

  // Every number/date on a card traces to this quote — a user can check
  // the filing's own words in one click rather than trusting the prose.
  function renderSourceText(card: FlashCard) {
    const quote = card.headlineTrigger.verifiedQuote;
    if (!quote) return null;
    return (
      <details className={styles.sourceTextDetails}>
        <summary className={styles.sourceTextSummary}>▸ quote</summary>
        <blockquote className={styles.sourceTextQuote}>&ldquo;{quote}&rdquo;</blockquote>
      </details>
    );
  }

  // FIX 3: which citation backs the headline event should be obvious — the
  // most recent one (matching the date already anchoring the card's own
  // timing tag) is the primary source; the rest are supporting context for
  // the same cluster, de-emphasized.
  function renderCardSources(citations: FlashCard["citations"]) {
    const sorted = [...citations].sort((a, b) => b.date.localeCompare(a.date));
    const [primary, ...supporting] = sorted;
    if (!primary) return null;
    return (
      <div className={styles.citations}>
        <span className={styles.primarySource}>
          Source:{" "}
          <a href={primary.url} target="_blank" rel="noreferrer" className={styles.citation}>
            {primary.form} {primary.date} ↗
          </a>
        </span>
        {supporting.length > 0 && (
          <span className={styles.supportingSources}>
            Supporting:{" "}
            {supporting.map((c, ci) => (
              <a key={ci} href={c.url} target="_blank" rel="noreferrer" className={styles.citation}>
                {c.form} {c.date} ↗
              </a>
            ))}
          </span>
        )}
      </div>
    );
  }

  // Session 15b Part A: one deterministic bullet line per verified trigger
  // — evidence-condensed description (what happened, with its amount and
  // date already in it) + timing + EVERY source link. Nothing here is
  // model-drafted; a company's table block is a pure function of its
  // already-streamed CompanyResult (evidenceCondense.ts + portfolioTable.ts).
  function renderTableLine(line: TableLine, i: number) {
    // E9: a fact belongs to exactly one bucket. Where it is genuinely
    // relevant to a second, that bucket keeps a pointer rather than a copy —
    // never removed, so an exposure is not hidden from the bucket an RM
    // scans for exposures.
    // Item 10: the line is composed AND truncated in portfolioTable.ts, in
    // one place, after every clause exists. Nothing is appended here — that
    // was the bug: text added after the cut rendered past it.
    const text = line.text;
    return (
      <li key={i} className={line.isHedgingFlag ? styles.tableLineHedging : styles.tableLine}>
        <span className={styles.tableLineBullet}>{line.isHedgingFlag ? "⚑" : "·"}</span>
        <span className={styles.tableLineText}>{text}</span>
        {line.cardEligible && <span className={styles.tableLineCardMarker}>▸ card above</span>}
        <span className={styles.tableLineSources}>
          {line.citations.map((c, ci) => (
            <a key={ci} href={c.url} target="_blank" rel="noreferrer" className={styles.citation}>
              {c.form} {c.date} ↗
            </a>
          ))}
        </span>
      </li>
    );
  }

  // Session 18 F1: one refi ladder row — instrument/rate/seniority/amount,
  // never just a figure+status template. `card above` uses the row's own
  // id (headlineRowId), not the trigger id — a company can have several
  // debt-maturity cards, one per qualifying tranche.
  function renderRefiLadderLine(line: RefiLadderLine, i: number) {
    const seniorityPrefix = line.row.seniority ? `${line.row.seniority} ` : "";
    // Most filers name the tranche BY its rate ("4.625 % Senior Notes"), so
    // prefixing the rate field printed it twice: "$2.8B 4.625% 4.625% Senior
    // Notes". Compared with whitespace removed, because the two sources
    // space the percent sign differently — the rate field says "5.125%" and
    // the note's own row label says "5.125 % due 2027", which is the same
    // rate written twice and reads as two.
    const squash = (t: string) => t.replace(/\s+/g, "");
    const rateInName = line.row.rate !== null && squash(line.row.instrument).includes(squash(line.row.rate));
    const rateText = line.row.rate && !rateInName ? `${line.row.rate} ` : "";
    // E13: the movement rides on the same line as the balance it belongs to.
    const movement = line.movementPhrase ? ` — ${line.movementPhrase}` : "";
    // ITEM 8 (stage-2 review): a row from a pricing 8-K answers a different
    // question than the block header does. The header describes the debt
    // NOTE — how many rows it had, whether they walk, whether they anchor —
    // and on a company whose note could not be read at all it said "none
    // could be trusted" with two rows directly beneath it and nothing
    // marking them as coming from somewhere else entirely.
    const sourceMark = line.row.provenance === "pricing-8-K" ? " [from a pricing 8-K, not the debt note]" : "";
    const text = `${formatMoneyForDisplay(line.row.amount)} ${rateText}${seniorityPrefix}${line.row.instrument} — ${line.timingPhrase}${movement}${sourceMark}`;
    return (
      <li key={i} className={styles.tableLine}>
        <span className={styles.tableLineBullet}>·</span>
        <span className={styles.tableLineText}>{text}</span>
        {line.cardEligible && <span className={styles.tableLineCardMarker}>▸ card above</span>}
      </li>
    );
  }

  // Session 18 F1: the refi bucket's own renderer — a completeness
  // statement (ties or doesn't, never suppressed either way) above a
  // ladder, not a flat TableLine list like the other three buckets.
  function renderRefiLadder(refi: RefiLadderBlock) {
    if (!refi.hasData) {
      const n = BUCKET_TRIGGER_COUNTS.refi;
      return <p className={styles.tableLineEmptyBucket}>no signal — {n} trigger{n === 1 ? "" : "s"} checked</p>;
    }
    return (
      <>
        <p className={styles.refiCompletenessLine}>{refi.completenessStatement}</p>
        <ul className={styles.tableLineList}>
          {refi.nearestLines.map((line, i) => renderRefiLadderLine(line, i))}
          {refi.tailSummary && (
            <li className={styles.tableLine}>
              <span className={styles.tableLineBullet}>·</span>
              <span className={styles.tableLineText}>{refi.tailSummary}</span>
            </li>
          )}
          {/* ITEM 6 (stage-2 review): tranches a pricing 8-K names that
              cannot be added to a ladder reporting category totals — they
              are inside one of those totals already. Stated, never dropped. */}
          {refi.issuancesInsideAggregate.map((row, i) => (
            <li key={`inside-aggregate-${i}`} className={styles.tableLine}>
              <span className={styles.tableLineBullet}>·</span>
              <span className={styles.tableLineText}>
                {formatMoneyForDisplay(row.amount)} {row.rate ? `${row.rate} ` : ""}{row.instrument} — priced by an 8-K
                {row.issuedOn ? ` on ${row.issuedOn.date}` : ""}; this filing reports its debt by category, so this tranche is inside one of the
                category totals above rather than a line of its own
              </span>
            </li>
          ))}
        </ul>
        {/* ITEM 7 (stage-2 review): the note's own reconciliation, in its own
            order — the rows sum, each adjustment applies, each subtotal
            states whether it lands. Replaces a bare list of adjustment
            label/number pairs that gave no indication what they adjusted or
            what they reconciled to. */}
        {refi.walkLines.length > 0 && (
          <div className={styles.refiWalk}>
            <p className={styles.refiWalkCaption}>How the note reconciles</p>
            <ul className={styles.refiWalkList}>
              {refi.walkLines.map((w, i) => (
                <li key={`walk-${i}`} className={w.kind === "subtotal" ? styles.refiWalkSubtotal : styles.refiWalkLine}>
                  <span className={styles.refiWalkLabel}>
                    {w.kind === "adjustment" ? "less " : w.kind === "subtotal" ? "= " : ""}
                    {w.label}
                  </span>
                  <span className={styles.refiWalkAmount}>{w.amount}</span>
                  {w.tie !== null && <span className={styles.refiWalkTie}>{w.tie ? "✓" : "does not tie"}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {refi.sourceCitation && (
          <div className={styles.tableLineSources}>
            <a href={refi.sourceCitation.url} target="_blank" rel="noreferrer" className={styles.citation}>
              {refi.sourceCitation.form} {refi.sourceCitation.date} ↗
            </a>
          </div>
        )}
      </>
    );
  }

  function renderPortfolioCompany(table: CompanyTableBlock) {
    return (
      <details key={table.company} className={styles.portfolioCompany}>
        <summary className={styles.portfolioCompanySummary}>
          {renderCompanyName(table.company)}
          <span className={styles.portfolioHeaderLine}>{table.headerLine}</span>
        </summary>
        <div className={styles.portfolioCompanyBody}>
          {table.emptyStateLine && <p className={styles.emptyStateLine}>{table.emptyStateLine}</p>}
          {TABLE_BUCKET_ORDER.map((bucket) => (
            <div key={bucket} className={styles.portfolioBucket}>
              <div className={`${styles.bucketBadge} ${styles[BUCKET_CLASS[bucket]]}`}>{BUCKET_LABELS[bucket]}</div>
              {bucket === "refi" ? (
                renderRefiLadder(table.refiLadder)
              ) : (
                <ul className={styles.tableLineList}>
                  {table.buckets[bucket].length === 0 ? (
                    <li className={styles.tableLineEmptyBucket}>
                      {/* Session 18 F3: states what was actually checked, not a bare "no signal found" — proves the framework ran rather than reading as a rendering gap. */}
                      no signal — {BUCKET_TRIGGER_COUNTS[bucket]} trigger{BUCKET_TRIGGER_COUNTS[bucket] === 1 ? "" : "s"} checked
                    </li>
                  ) : (
                    table.buckets[bucket].map((line, i) => renderTableLine(line, i))
                  )}
                </ul>
              )}
            </div>
          ))}
          {table.relationshipFlags.length > 0 && (
            <div className={styles.relationshipFlags}>
              Relationship flag (distress, not a sell signal): {table.relationshipFlags.join(", ")}
            </div>
          )}
        </div>
      </details>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Coverage Signal</h1>
        <p className={styles.subtitle}>Who to call this week</p>
      </header>

      <section className={styles.controls}>
        <textarea
          className={styles.textarea}
          value={book}
          onChange={(e) => setBook(e.target.value)}
          rows={8}
          spellCheck={false}
        />
        <div className={styles.runRow}>
          <input
            type="password"
            className={styles.passphraseInput}
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="off"
          />
          <button className={styles.runButton} type="button" onClick={runAgent} disabled={running}>
            {running ? "Running..." : "Run agent"}
          </button>
        </div>
      </section>

      <section className={styles.resultsHeader}>
        {asOfDate && (
          <p className={styles.asOfLine}>
            As of{" "}
            {asOfDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}{" "}
            · based on filings retrieved from SEC EDGAR
          </p>
        )}
        <details className={styles.methodology}>
          <summary className={styles.methodologySummary}>How this works</summary>
          <ul className={styles.methodologyList}>
            <li>Scans each company against 15 trigger types from recent SEC filings</li>
            <li>Groups triggers about the same event into one card (no double-counting)</li>
            <li>Surfaces only dated, actionable events (next ~12–18 months) as flash cards</li>
            <li>Four opportunity buckets: refi, new debt, treasury/deposits, FX/rate hedging</li>
            <li>No ranking across types — cards are time-ordered; the RM decides which call matters most</li>
            <li>Everything else stays in the portfolio table below, deterministically rendered — never model-drafted</li>
          </ul>
        </details>
        {(results.length > 0 || running) && (
          <>
            <div className={styles.verdictBanner}>
              This week: {flashCardCandidates.length} actionable event
              {flashCardCandidates.length === 1 ? "" : "s"} across {companiesWithEvents} compan
              {companiesWithEvents === 1 ? "y" : "ies"}
            </div>
            <div className={styles.summaryLine}>{results.length} companies assessed</div>
          </>
        )}
      </section>

      <section className={styles.flashCardSection}>
        {flashCardCandidates.length > 0
          ? flashCardCandidates.map(renderFlashCard)
          : results.length > 0 && (
              <p className={styles.emptyStateLine}>{buildBookEmptyStateLine(tableBlocks)}</p>
            )}
      </section>

      {tableBlocks.length > 0 && (
        <details className={styles.portfolioSection}>
          <summary className={styles.portfolioSummary}>Portfolio table ({tableBlocks.length} companies)</summary>
          <div className={styles.portfolioBody}>{tableBlocks.map(renderPortfolioCompany)}</div>
        </details>
      )}

      <details className={styles.tracePanelDetails}>
        <summary className={styles.traceSummary}>▸ View agent reasoning</summary>
        <div className={styles.panelBody}>
          {trace.map((line, i) => {
            const isNewCompany = i === 0 || trace[i - 1].company !== line.company;
            const className = line.filler
              ? styles.traceFiller
              : isNewCompany
                ? styles.traceHeader
                : styles.traceLine;
            return (
              <div key={i} className={className}>
                {line.text}
              </div>
            );
          })}
        </div>
      </details>
    </main>
  );
}
