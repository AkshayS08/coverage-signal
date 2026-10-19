import type { BarSegment, Card, CardV3, Line, Tag } from "@/lib/cards/types";
import { LineView, Seg } from "./CardView";
import styles from "./cardsV3.module.css";

/**
 * card_spec v3.0 — the redesigned card. Layout, top to bottom: header,
 * rolled-position note, the call box, recent debt moves, total debt and
 * liquidity, the maturity chart and table, facilities and what was not shown,
 * the footnote. Every figure is the same linked segment the v2.2 sections
 * carry; chart labels and table cells open to the source figures they sum.
 */

const L = ({ line, className }: { line: Line; className?: string }) => <LineView line={line} className={className ?? styles.inline} />;

function TagView({ tag }: { tag: Tag | null }) {
  if (!tag) return null;
  return <span className={`${styles.tag} ${styles[`tag_${tag.tone}`]}`}>{tag.text.map((s, n) => <Seg key={n} s={s} />)}</span>;
}

function segStyle(s: BarSegment): React.CSSProperties {
  return s.pattern === "stripes"
    ? { background: `repeating-linear-gradient(135deg, ${s.color} 0 5px, #ffffff 5px 8px)` }
    : { background: s.color };
}

function StackedBar({ segments }: { segments: BarSegment[] }) {
  const total = segments.reduce((a, s) => a + s.usd, 0) || 1;
  return (
    <div className={styles.stack} role="img" aria-label={segments.map((s) => s.title).join(", ")}>
      {segments.map((s, n) => (
        <span key={n} title={s.title} style={{ ...segStyle(s), width: `${(s.usd / total) * 100}%` }} />
      ))}
    </div>
  );
}

function Swatch({ color, pattern }: { color: string; pattern?: "stripes" }) {
  return <span className={styles.swatch} style={pattern === "stripes" ? { background: `repeating-linear-gradient(135deg, ${color} 0 3px, #ffffff 3px 5px)` } : { background: color }} />;
}

function Chart({ chart }: { chart: CardV3["chart"] }) {
  const max = Math.max(1, ...chart.bars.map((b) => b.drawUsd));
  const n = chart.bars.length;
  const bandPct = ((chart.window.endIndex + chart.window.endFraction) / Math.max(1, n)) * 100;
  return (
    <figure className={styles.chart}>
      <div className={styles.chartLegend}>
        {chart.legend.map((l, i) => (
          <span key={i} className={styles.legendItem}>
            <Swatch color={l.color} pattern={l.pattern} />
            {l.label}
          </span>
        ))}
      </div>
      <div className={styles.plot}>
        <div className={`${styles.band} ${/nothing due/.test(chart.window.label) ? styles.quiet : ""}`} style={{ width: `${Math.min(100, bandPct)}%` }}>
          <span className={styles.bandLabel}>{chart.window.label}</span>
        </div>
        {chart.bars.map((b, i) => (
          <div key={i} className={styles.col}>
            <div className={styles.colInner}>
              {/* An empty year is shown as a gap, with no value label. */}
              <div className={styles.value}>{b.drawUsd > 0 ? <Seg s={b.total} /> : null}</div>
              <div className={styles.bar} style={{ height: `${(b.drawUsd / max) * 100}%` }}>
                {b.broken ? <span className={styles.breakMark} aria-label="cut to fit" /> : null}
                {[...b.segments].reverse().map((s, k) => (
                  <span key={k} title={s.title} style={{ ...segStyle(s), flexGrow: s.usd }} />
                ))}
              </div>
            </div>
            <div className={styles.year}>{b.label}</div>
          </div>
        ))}
      </div>
      <figcaption className={styles.caption}>
        {chart.captions.map((c, i) => (
          <L key={i} line={c} className={styles.captionLine} />
        ))}
      </figcaption>
    </figure>
  );
}

function Rows({ rows }: { rows: CardV3["table"]["rows"] }) {
  return (
    <tbody>
      {rows.map((r, i) => (
        <tr key={i} className={r.inWindow ? styles.rowWindow : undefined}>
          <td className={styles.matures}><L line={r.matures} /></td>
          <td>
            <L line={r.instrument} />
            {r.tenK ? <span className={styles.tenK}>10-K</span> : null}
          </td>
          <td className={styles.face}>{r.face ? <Seg s={r.face} /> : "—"}</td>
          <td className={styles.status}><TagView tag={r.status} /></td>
        </tr>
      ))}
    </tbody>
  );
}

function Table({ table }: { table: CardV3["table"] }) {
  const head = (
    <thead>
      <tr>
        <th>Matures</th>
        <th>Instrument</th>
        <th className={styles.face}>Face</th>
        <th>Status</th>
      </tr>
    </thead>
  );
  const shown = table.rows.slice(0, table.visible);
  const rest = table.rows.slice(table.visible);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        {head}
        <Rows rows={shown} />
      </table>
      {rest.length ? (
        <details className={styles.more}>
          <summary>Show all {table.rows.length}</summary>
          <table className={styles.table}>
            <Rows rows={rest} />
          </table>
        </details>
      ) : null}
      {table.schedule ? (
        <details className={styles.more}>
          <summary>Show scheduled amortization by year</summary>
          <div className={styles.schedule}>
            {table.schedule.map((b, i) => (
              <div key={i}>
                <L line={b.heading} className={styles.scheduleHead} />
                {b.lines.map((l, k) => (
                  <L key={k} line={l} className={styles.scheduleLine} />
                ))}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default function CardV3View({ card }: { card: Card }) {
  const v = card.v3!;
  const c = v.call;
  return (
    <article className={styles.card} id={`card-${card.cik}`}>
      {/* 1. Header */}
      <header className={styles.header}>
        <div>
          <div className={styles.kicker}>{v.header.label}</div>
          <h2 className={styles.company}>{v.header.company}</h2>
        </div>
        <div className={styles.headerRight}>
          <L line={v.header.position} />
          <div>
            <Seg s={v.header.filing} /> · <L line={v.header.status} />
          </div>
        </div>
      </header>
      {v.header.actionable.length ? (
        <div className={styles.actionable}>
          {v.header.actionable.map((l, i) => (
            <L key={i} line={l} className={styles.actionLine} />
          ))}
        </div>
      ) : null}
      {/* 2. Rolled-position note */}
      {v.rolledNote ? (
        <div className={styles.rolledNote}>
          <L line={v.rolledNote} />
        </div>
      ) : null}
      {/* 3. The call box */}
      <section className={styles.call} data-case={c.case}>
        <div className={styles.callLabel}>{c.label}</div>
        <L line={c.headline} className={styles.callHeadline} />
        {c.tiles.length ? (
          <div className={styles.tiles}>
            {c.tiles.map((tl) => (
              <div key={tl.key} className={`${styles.tile} ${tl.key === "notYet" ? styles.tileOrange : ""}`}>
                <div className={styles.tileLabel}>{tl.label}</div>
                <div className={`${styles.tileValue} ${tl.key === "refinanced" ? styles.tileRefi : ""}`}>
                  <Seg s={tl.value} />
                </div>
                <L line={tl.sub} className={styles.tileSub} />
              </div>
            ))}
          </div>
        ) : null}
        {c.nextTile ? (
          <div className={styles.nextTile}>
            <div>
              <div className={styles.tileLabel}>Next maturity</div>
              <div className={styles.tileValue}>{c.nextTile.value ? <Seg s={c.nextTile.value} /> : null}</div>
              <L line={c.nextTile.instrument} className={styles.tileSub} />
            </div>
            <div className={styles.nextRight}>
              <div className={styles.nextDate}>{c.nextTile.date ? <Seg s={c.nextTile.date} /> : null}</div>
              {c.nextTile.away ? <div className={styles.tileSub}>{c.nextTile.away}</div> : null}
            </div>
          </div>
        ) : null}
        {c.rows.map((r, i) => (
          <div key={i} className={`${styles.callRow} ${r.tag?.tone === "orange" ? styles.callRowOrange : ""}`}>
            <L line={r.when} className={styles.callWhen} />
            <span className={styles.callBody}>
              <L line={r.body} />
              {r.tenK ? <span className={styles.tenK}>10-K</span> : null}
            </span>
            <TagView tag={r.tag} />
          </div>
        ))}
        {c.notes.map((l, i) => (
          <L key={i} line={l} className={styles.callNote} />
        ))}
        {c.legend ? <div className={styles.callNote}>{c.legend}</div> : null}
      </section>
      {/* 4. Recent debt moves */}
      <section className={styles.section}>
        <h3 className={styles.sectionHead}>Recent debt moves</h3>
        {v.moves.length === 0 ? <div className={styles.muted}>No debt moves stated this year.</div> : null}
        <div className={styles.moves}>
          {v.moves.map((m, i) => (
            <div key={i} className={m.retires ? styles.movePair : styles.moveSingle}>
              <div className={styles.moveCard}>
                <L line={m.meta} className={styles.moveMeta} />
                {m.title.map((tl, k) => (
                  <L key={k} line={tl} className={styles.moveTitle} />
                ))}
                {m.detail ? <L line={m.detail} className={styles.moveDetail} /> : null}
              </div>
              {m.retires ? (
                <>
                  <div className={styles.arrow} aria-hidden>→</div>
                  <div className={styles.moveCard}>
                    <L line={m.retires.meta} className={styles.moveMeta} />
                    {m.retires.items.map((it, k) => (
                      <L key={k} line={it} className={styles.moveTitle} />
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      {/* 5. Total debt and liquidity */}
      <section className={`${styles.section} ${styles.split}`}>
        {[{ head: "Total debt, at face", d: v.totalDebt }, { head: "Liquidity", d: v.liquidity }].map(({ head, d }) => (
          <div key={head}>
            <h3 className={styles.sectionHead}>{head}</h3>
            <div className={styles.bigFigure}>{d.figure ? <Seg s={d.figure} /> : "—"}</div>
            <StackedBar segments={d.segments} />
            <ul className={styles.legendList}>
              {d.legend.map((l, i) => (
                <li key={i}>
                  <Swatch color={l.color} />
                  <span className={styles.legendLabel}><L line={l.label} /></span>
                  <span className={styles.legendAmount}><Seg s={l.amount} /></span>
                </li>
              ))}
            </ul>
            {d.notes.map((l, i) => (
              <L key={i} line={l} className={styles.note} />
            ))}
          </div>
        ))}
      </section>
      {/* 6. Maturity ladder: chart, then table */}
      <section className={styles.section}>
        <h3 className={styles.sectionHead}>Maturity ladder, $MM face</h3>
        <Chart chart={v.chart} />
        <Table table={v.table} />
      </section>
      {/* 7. Facilities, and what was not shown */}
      <section className={`${styles.section} ${styles.split} ${styles.small}`}>
        <div>
          <h3 className={styles.sectionHead}>Facilities</h3>
          {v.facilities.length === 0 ? <div className={styles.muted}>No facility stated.</div> : null}
          {v.facilities.map((f, i) => (
            <div key={i} className={styles.facility}>
              <L line={f.bold} className={styles.facBold} />
              {f.sub ? <L line={f.sub} className={styles.facSub} /> : null}
            </div>
          ))}
        </div>
        <div>
          <h3 className={styles.sectionHead}>Not shown, and why</h3>
          {v.notShown.map((l, i) => (
            <L key={i} line={l} className={styles.facSub} />
          ))}
        </div>
      </section>
      {/* 8. Footnote */}
      <footer className={styles.footnote}>
        <L line={v.footnote} />
      </footer>
    </article>
  );
}
