"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";
import { rankCompanies, scoreTrigger, templateBriefing } from "@/lib/rank";
import type { RankedCompany } from "@/lib/rank";
import type { CompanyResult, RunStreamEvent, TriggerResult } from "@/lib/agent";
import type { DraftedBriefing } from "@/lib/rank/briefing";

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

/** Real SEC EDGAR browse page for a resolved CIK — same data the fetch layer already reads from. */
function edgarCompanyUrl(cik: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`;
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

// Supporting triggers beyond this many (already sorted highest-scoring
// first) collapse behind a "show N more" toggle instead of listing every
// fired trigger on the card.
const VISIBLE_SUPPORTING_COUNT = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Home() {
  const [book, setBook] = useState(DEFAULT_BOOK);
  const [passphrase, setPassphrase] = useState("");
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [results, setResults] = useState<CompanyResult[]>([]);
  const [briefings, setBriefings] = useState<Record<string, DraftedBriefing>>({});
  const [running, setRunning] = useState(false);
  const [asOfDate, setAsOfDate] = useState<Date | null>(null);

  const { calls, monitor } = useMemo(() => rankCompanies(results), [results]);
  const displayCalls = useMemo(
    () =>
      calls.map((rc) => ({
        ...rc,
        briefing: briefings[rc.company] ?? rc.briefing,
      })),
    [calls, briefings]
  );
  const treasuryCallCount = useMemo(
    () => calls.filter((rc) => rc.topTrigger.needType === "treasury").length,
    [calls]
  );
  // Monitor entries get the exact same full-detail shape as a call card —
  // the threshold only decides which list a company defaults into, not
  // whether its detail exists. Built from the same raw per-company results
  // and the same exported scoreTrigger/templateBriefing used by the ranker,
  // so this is display-only: no scoring or threshold logic is duplicated.
  const monitorCards: RankedCompany[] = useMemo(
    () =>
      monitor.map((m) => {
        const result = results.find((r) => r.company === m.company);
        const triggers = (result?.results ?? [])
          .filter((t) => t.fired && (t.needType === "credit" || t.needType === "treasury"))
          .map((trigger) => ({ trigger, score: scoreTrigger(trigger) }))
          .sort((a, b) => b.score - a.score)
          .map((s) => s.trigger);
        return {
          company: m.company,
          cik: result?.cik ?? "",
          ticker: result?.ticker ?? "",
          score: m.score,
          triggers,
          topTrigger: m.topTrigger,
          briefing: briefings[m.company] ?? templateBriefing(triggers),
        };
      }),
    [monitor, results, briefings]
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
    setBriefings({});
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
        if (event.briefing) {
          const briefing = event.briefing;
          setBriefings((prev) => ({ ...prev, [event.result.company]: briefing }));
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

  function renderTrigger(t: TriggerResult, isHeadline: boolean) {
    return (
      <div className={isHeadline ? styles.headlineTrigger : styles.supportingTrigger}>
        <div className={styles.triggerHeaderRow}>
          <span
            className={`${styles.badge} ${
              t.needType === "treasury" ? styles.badgeTreasury : styles.badgeCredit
            }`}
          >
            {t.needType}
          </span>
          <span className={styles.triggerName}>{t.triggerName}</span>
          <span className={styles.mappedNeed}>→ {t.mappedNeed}</span>
        </div>
        {t.evidence && <p className={styles.evidenceLine}>{t.evidence.trim()}</p>}
        <div className={styles.citations}>
          {t.citations.map((c, ci) => (
            <a key={ci} href={c.url} target="_blank" rel="noreferrer" className={styles.citation}>
              {c.form} {c.date} ↗
            </a>
          ))}
        </div>
      </div>
    );
  }

  // Shared by call cards (always visible, ranked) and monitor entries
  // (collapsed by default, expanded on demand) — same full detail either
  // way. rankLabel is omitted for monitor entries since they aren't ranked
  // against each other the way calls are.
  function renderCompanyCard(rc: RankedCompany, rankLabel?: string) {
    const isTreasuryLed = rc.topTrigger.needType === "treasury";
    const [headline, ...supporting] = rc.triggers;
    return (
      <div key={rc.company} className={`${styles.card} ${isTreasuryLed ? styles.cardTreasury : ""}`}>
        <div className={styles.cardHeader}>
          {rankLabel && <span className={styles.rankBadge}>{rankLabel}</span>}
          {rc.cik ? (
            <a
              className={styles.companyName}
              href={edgarCompanyUrl(rc.cik)}
              target="_blank"
              rel="noreferrer"
            >
              {rc.company}
            </a>
          ) : (
            <span className={styles.companyName}>{rc.company}</span>
          )}
          <span
            className={styles.scoreText}
            title="Relative priority score (treasury-weighted, recency-adjusted) — useful for ranking, not a precise metric on its own"
          >
            priority {rc.score.toFixed(2)}
          </span>
        </div>
        <div className={styles.briefing}>
          <ul className={styles.briefingBullets}>
            {rc.briefing.bullets.map((b, bi) => (
              <li key={bi}>{b}</li>
            ))}
          </ul>
          <p className={styles.briefingAngle}>
            <strong>Angle:</strong> {rc.briefing.angle}
            <span className={styles.openerSource}>
              {rc.briefing.source === "sonnet" ? "Sonnet-drafted" : "templated"}
            </span>
          </p>
        </div>
        {renderTrigger(headline, true)}
        {supporting.length > 0 && (
          <div className={styles.supportingSection}>
            <div className={styles.supportingLabel}>Also flagged</div>
            <ul className={styles.triggerList}>
              {supporting.slice(0, VISIBLE_SUPPORTING_COUNT).map((t) => (
                <li key={t.triggerId}>{renderTrigger(t, false)}</li>
              ))}
            </ul>
            {supporting.length > VISIBLE_SUPPORTING_COUNT && (
              <details className={styles.moreTriggers}>
                <summary className={styles.moreTriggersSummary}>
                  show {supporting.length - VISIBLE_SUPPORTING_COUNT} more
                </summary>
                <ul className={styles.triggerList}>
                  {supporting.slice(VISIBLE_SUPPORTING_COUNT).map((t) => (
                    <li key={t.triggerId}>{renderTrigger(t, false)}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
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
          <button
            className={styles.runButton}
            type="button"
            onClick={runAgent}
            disabled={running}
          >
            {running ? "Running..." : "Run agent"}
          </button>
        </div>
      </section>

      <section className={styles.panels}>
        <div className={styles.panel}>
          <details className={styles.tracePanelDetails} open>
            <summary className={styles.panelTitle}>Agent trace</summary>
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
        </div>
        <div className={styles.panel}>
          <div className={styles.callSheetHeader}>
            <h2 className={styles.panelTitle}>Call sheet</h2>
            {asOfDate && (
              <p className={styles.asOfLine}>
                As of{" "}
                {asOfDate.toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}{" "}
                · based on filings retrieved from SEC EDGAR
              </p>
            )}
            <details className={styles.methodology}>
              <summary className={styles.methodologySummary}>How this works</summary>
              <p className={styles.methodologyText}>
                Coverage Signal scans each company against 15 trigger types drawn from its recent SEC
                filings (10-Ks, 10-Qs, 8-Ks), then ranks fired triggers by a treasury-weighted,
                recency-adjusted priority score — treasury/deposit signals are weighted above credit
                signals, since that&apos;s where commercial banking margin lives and where
                lending-focused coverage tends to under-call. Companies whose top signal clears a
                threshold are flagged &quot;call this week&quot;; the rest are tracked under
                &quot;monitor.&quot;
              </p>
            </details>
          </div>
          <div className={styles.panelBody}>
            {(results.length > 0 || running) && (
              <>
                <div className={styles.verdictBanner}>
                  This week: {calls.length} to call · {monitor.length} monitoring ·{" "}
                  {treasuryCallCount} treasury {treasuryCallCount === 1 ? "opportunity" : "opportunities"}
                </div>
                <div className={styles.summaryLine}>{results.length} companies assessed</div>
              </>
            )}
            {displayCalls.map((rc, i) => renderCompanyCard(rc, `#${i + 1}`))}
            {monitor.length > 0 && (
              <details className={styles.monitorSection}>
                <summary className={styles.monitorSummary}>Monitor ({monitor.length})</summary>
                <ul className={styles.monitorList}>
                  {monitorCards.map((mc) => (
                    <li key={mc.company} className={styles.monitorEntry}>
                      <details>
                        <summary className={styles.monitorEntrySummary}>
                          <span className={styles.monitorCompany}>{mc.company}</span>
                          <span className={styles.monitorTrigger}>{mc.topTrigger.triggerName}</span>
                        </summary>
                        <div className={styles.monitorEntryBody}>{renderCompanyCard(mc)}</div>
                      </details>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
