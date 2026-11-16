"use client";
/**
 * Stage 2: a card for any company (sessions/27/stage2_summary.md). Search by name, ticker or CIK; pick when more than
 * one registrant matches; watch the build's stages; see the card with its trust badge, or, for a company never built,
 * the price first: within today's demo allowance it builds without asking, above it the approval screen.
 */
import { useState } from "react";
import CardView from "../cards/CardView";
import type { Card } from "@/lib/cards/types";
import styles from "./build.module.css";

type Match = { cik: string; title: string; ticker: string };
type Stage = { stage: string; status: "running" | "done" | "skipped" | "stopped"; detail: string };
const STAGES = ["Find the company", "Get its filings", "Choose the anchor", "Decide what to read", "Check the cache", "Price it", "Read the debt (3 samples)", "Extra reads, only when needed", "Read the card facts", "Apply the rules and checks", "Render"];
const BADGE: Record<string, { label: string; tone: string }> = {
  signed: { label: "Signed", tone: styles.badgeSigned }, "checks-passed": { label: "Checks passed", tone: styles.badgePassed },
  "checks-failed": { label: "Checks failed", tone: styles.badgeFailed }, "could-not-build": { label: "Could not build", tone: styles.badgeStopped },
};
const usd = (x: number) => `$${x.toFixed(2)}`;

export default function BuildPage() {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<Match | null>(null);
  const [stages, setStages] = useState<Record<string, Stage>>({});
  const [outcome, setOutcome] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setMatches(null); setNote(null); setPicked(null); setStages({}); setOutcome(null);
    const r = await (await fetch(`/api/resolve?q=${encodeURIComponent(q)}`)).json();
    if (r.kind === "one") return build(r.match);
    if (r.kind === "choose") return setMatches(r.matches);
    setOutcome({ kind: "could-not-build", stage: "Find the company", reason: r.reason });
  }

  async function build(m: Match, confirm = false, approvedUsd?: number) {
    setPicked(m); setMatches(null); setOutcome(null); setStages({}); setBusy(true);
    try {
      const res = await fetch("/api/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ match: m, confirm, approvedUsd }) });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const o = JSON.parse(line);
          if (o.type === "event") setStages((s) => ({ ...s, [o.stage]: o }));
          else setOutcome(o);
        }
      }
    } finally { setBusy(false); }
  }

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <div className={styles.brand}>Coverage Signal</div>
        <div className={styles.sub}>A debt card for any SEC registrant: every figure linked to the sentence it came from.</div>
      </header>

      <form className={styles.search} onSubmit={find}>
        <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company name, ticker or CIK" aria-label="Company name, ticker or CIK" />
        <button className={styles.button} disabled={busy || !q.trim()}>Find</button>
      </form>

      {matches && (
        <section className={styles.panel}>
          <div className={styles.panelHead}>{matches.length} registrants match “{q}”. Which one?</div>
          <ul className={styles.picker}>
            {matches.map((m) => (
              <li key={m.cik}><button className={styles.pick} onClick={() => build(m)}><span className={styles.pickTitle}>{m.title}</span><span className={styles.pickMeta}>{m.ticker} · CIK {m.cik}</span></button></li>
            ))}
          </ul>
        </section>
      )}

      {picked && (Object.keys(stages).length > 0 || busy) && (
        <section className={styles.panel}>
          <div className={styles.panelHead}>{picked.title} <span className={styles.pickMeta}>{picked.ticker} · CIK {picked.cik}</span></div>
          <ol className={styles.stages}>
            {STAGES.map((name) => {
              const s = stages[name];
              const st = s?.status ?? (busy ? "pending" : "pending");
              return (
                <li key={name} className={`${styles.stage} ${styles[`st_${st}`] ?? ""}`}>
                  <span className={styles.dot} aria-hidden>{st === "done" ? "✓" : st === "running" ? "…" : st === "skipped" ? "–" : st === "stopped" ? "✕" : "○"}</span>
                  <span className={styles.stageName}>{name}</span>
                  {s?.detail ? <span className={styles.stageDetail}>{s.detail}</span> : null}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {outcome?.kind === "priced" && (
        <section className={`${styles.panel} ${styles.price}`}>
          <div className={styles.panelHead}>{outcome.company.title} has not been built on its current filings.</div>
          <p>Typical cost {usd(outcome.price.expectedRangeUsd[0])} to {usd(outcome.price.expectedRangeUsd[1])}. Worst case <strong>{usd(outcome.price.declaredUsd)}</strong>, counted from every call the build would make, rounded up to the cent.</p>
          <ul className={styles.calls}>{outcome.price.calls.map((c: any, i: number) => <li key={i}>{c.stage}{c.sample !== "facts" ? ` (${c.sample})` : ""}: {c.count} × {usd(c.worstEachUsd)}{c.estimate ? " (estimate)" : ""}</li>)}</ul>
          {outcome.decision.kind === "run" && <><p>Within today’s demo allowance: {usd(outcome.decision.allowanceLeftUsd)} left after this card.</p><button className={styles.button} onClick={() => build(outcome.company, true, outcome.decision.declaredUsd)}>Build the card</button></>}
          {outcome.decision.kind === "needs-approval" && <div className={styles.approval}><div className={styles.panelHead}>Approval needed</div><p>{outcome.decision.why}. Approve up to <strong>{usd(outcome.decision.declaredUsd)}</strong> for this card?</p><button className={styles.button} onClick={() => build(outcome.company, true, outcome.decision.declaredUsd)}>Approve {usd(outcome.decision.declaredUsd)} and build</button></div>}
          {outcome.decision.kind === "refused" && <p className={styles.refused}>{outcome.decision.reason}</p>}
        </section>
      )}

      {outcome?.kind === "could-not-build" && (
        <section className={styles.panel}>
          <span className={`${styles.badge} ${BADGE["could-not-build"].tone}`}>Could not build</span>
          <p className={styles.reason}>{outcome.reason} <span className={styles.pickMeta}>(stopped at: {outcome.stage})</span></p>
        </section>
      )}

      {outcome?.kind === "card" && (
        <>
          <section className={styles.trust}>
            <span className={`${styles.badge} ${BADGE[outcome.badge].tone}`}>{BADGE[outcome.badge].label}</span>
            <span className={styles.trustWhy}>{outcome.reasons.join(" · ")}</span>
            <span className={styles.cost}>{outcome.costUsd === 0 ? "Built from cache: $0" : `Cost ${usd(outcome.costUsd)}`}</span>
          </section>
          <CardView card={outcome.card as Card} />
        </>
      )}
    </main>
  );
}
