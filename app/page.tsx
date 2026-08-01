"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";
import { rankCompanies } from "@/lib/rank";
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

interface DraftedOpener {
  text: string;
  source: "sonnet" | "template";
}

// Presentation-only pacing: while the single batched Haiku call is in
// flight there's nothing real to report, so these keep the panel moving
// rather than freezing for ~13s. They never claim a specific finding.
const FILLER_LINES = [
  "scanning 15 trigger signals...",
  "cross-referencing the debt schedule...",
  "checking recent 8-Ks against the taxonomy...",
  "reviewing the balance sheet...",
  "matching filings to banking needs...",
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
  const [openers, setOpeners] = useState<Record<string, DraftedOpener>>({});
  const [running, setRunning] = useState(false);

  const ranked = useMemo(() => rankCompanies(results), [results]);
  const displayRanked = useMemo(
    () =>
      ranked.map((rc) => ({
        ...rc,
        opener: openers[rc.company]?.text ?? rc.opener,
        openerSource: openers[rc.company]?.source ?? ("template" as const),
      })),
    [ranked, openers]
  );
  const treasuryCount = useMemo(
    () => ranked.filter((rc) => rc.triggers.some((t) => t.needType === "treasury")).length,
    [ranked]
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
    setOpeners({});

    // Real trace/error lines land here instead of going straight to state,
    // so a burst (all 15 trigger lines arriving in one response) can be
    // revealed one at a time instead of dumped in a single render.
    const revealQueue: TraceLine[] = [];
    let lastAppendAt = Date.now();
    let currentCompany = companies[0] ?? "";
    let fillerIndex = 0;

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
        const text = FILLER_LINES[fillerIndex % FILLER_LINES.length];
        fillerIndex += 1;
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
        if (event.opener) {
          const opener = event.opener;
          setOpeners((prev) => ({ ...prev, [event.result.company]: opener }));
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
          <h2 className={styles.panelTitle}>Agent trace</h2>
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
        </div>
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Call sheet</h2>
          <div className={styles.panelBody}>
            {(results.length > 0 || running) && (
              <div className={styles.summaryLine}>
                {results.length} compan{results.length === 1 ? "y" : "ies"} assessed · {ranked.length} call
                {ranked.length === 1 ? "" : "s"} · {treasuryCount} treasury opportunit
                {treasuryCount === 1 ? "y" : "ies"}
              </div>
            )}
            {displayRanked.map((rc, i) => {
              const isTreasuryLed = rc.topTrigger.needType === "treasury";
              return (
                <div
                  key={rc.company}
                  className={`${styles.card} ${isTreasuryLed ? styles.cardTreasury : ""}`}
                >
                  <div className={styles.cardHeader}>
                    <span className={styles.rankBadge}>#{i + 1}</span>
                    <span className={styles.companyName}>{rc.company}</span>
                    <span className={styles.scoreText}>score {rc.score.toFixed(2)}</span>
                  </div>
                  <p className={styles.opener}>
                    &ldquo;{rc.opener}&rdquo;
                    <span className={styles.openerSource}>
                      {rc.openerSource === "sonnet" ? "Sonnet-drafted" : "templated"}
                    </span>
                  </p>
                  <ul className={styles.triggerList}>
                    {rc.triggers.map((t) => (
                      <li key={t.triggerId} className={styles.triggerItem}>
                        <span
                          className={`${styles.badge} ${
                            t.needType === "treasury" ? styles.badgeTreasury : styles.badgeCredit
                          }`}
                        >
                          {t.needType}
                        </span>
                        <span className={styles.triggerName}>{t.triggerName}</span>
                        <span className={styles.mappedNeed}>→ {t.mappedNeed}</span>
                        <span className={styles.confidence}>
                          {Math.round(t.confidence * 100)}% confidence
                        </span>
                        <div className={styles.citations}>
                          {t.citations.map((c, ci) => (
                            <a
                              key={ci}
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.citation}
                            >
                              {c.form} {c.date} ↗
                            </a>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
