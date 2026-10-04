import type { Card, CardSection, Line, Segment } from "@/lib/cards/types";
import { sentenceUrl } from "@/lib/cards/format";
import styles from "./cards.module.css";

/**
 * One card, rendered from its generated JSON. Every figure, date and label is
 * a link that opens the filing at its sentence, highlighted; hovering shows
 * the sentence and its document. A computed figure opens to the figures it
 * was computed from, each linked the same way.
 */
function Seg({ s }: { s: Segment }) {
  switch (s.k) {
    case "text":
      return <>{s.t}</>;
    case "figure":
    case "date":
    case "label":
      return (
        <a className={styles[s.k]} href={sentenceUrl(s.src.url, s.src.sentence)} target="_blank" rel="noreferrer" title={`${s.src.doc}: “${s.src.sentence}”`}>
          {s.t}
        </a>
      );
    case "notStated":
      return (
        <a className={styles.notStated} href={sentenceUrl(s.src.url, s.src.sentence)} target="_blank" rel="noreferrer" title={`${s.src.doc}: “${s.src.sentence}”`}>
          {s.t}
        </a>
      );
    case "filing":
      return (
        <a className={styles.filing} href={s.url} target="_blank" rel="noreferrer">
          {s.t}
        </a>
      );
    case "computed":
      return (
        <details className={styles.computed}>
          <summary title="Computed from the figures below; open to see each with its sentence">{s.t}</summary>
          <span className={styles.parts}>
            {s.parts.map((p, n) => (
              <span key={n} className={styles.part}>
                <a href={sentenceUrl(p.src.url, p.src.sentence)} target="_blank" rel="noreferrer" title={`${p.src.doc}: “${p.src.sentence}”`}>
                  {p.usd < 0 ? "− " : n ? "+ " : ""}
                  {p.printed}
                </a>
                <span className={styles.partDoc}> {p.src.doc}</span>
              </span>
            ))}
          </span>
        </details>
      );
  }
}

function LineView({ line, className }: { line: Line; className?: string }) {
  return (
    <div className={className ?? styles.line}>
      {line.map((s, n) => (
        <Seg key={n} s={s} />
      ))}
    </div>
  );
}

function Section({ s, lead }: { s: CardSection; lead?: boolean }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHead}>{s.heading}</h3>
      {s.lines.map((l, n) => (
        <LineView key={n} line={l} className={lead && n === 0 ? styles.headline : undefined} />
      ))}
      {(s.blocks ?? []).map((b, n) => (
        <div key={n} className={styles.block}>
          <LineView line={b.heading} className={styles.blockHead} />
          {b.lines.map((l, m) => (
            <LineView key={m} line={l} />
          ))}
        </div>
      ))}
    </section>
  );
}

export default function CardView({ card }: { card: Card }) {
  const [name, ...rest] = card.header;
  return (
    <article className={styles.card} id={`card-${card.cik}`}>
      <header className={styles.header}>
        <h2 className={styles.company}>{name.map((s) => s.t).join("")}</h2>
        {rest.map((l, n) => (
          <LineView key={n} line={l} className={styles.meta} />
        ))}
      </header>
      <Section s={card.thisWeek} />
      <div className={styles.headlines}>
        <Section s={card.headlines.totalDebt} lead />
        <Section s={card.headlines.liquidity} lead />
        <Section s={card.headlines.due24} />
      </div>
      <Section s={card.ladder} />
      <Section s={card.facilities} />
      <Section s={card.withheld} />
      <footer className={styles.footer}>
        {card.coverage.lines.map((l, n) => (
          <LineView key={n} line={l} />
        ))}
      </footer>
    </article>
  );
}
