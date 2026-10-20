import Link from "next/link";
import type { Card } from "@/lib/cards/types";
import all from "@/lib/cards/generated/all.json";
import CardView from "./CardView";
import styles from "./cards.module.css";

/**
 * Demo v1: one card per signed name (card_spec.md v1.2). Rendered from the
 * generated JSON and nothing else — viewing bills nothing and reads no cache.
 */
export const dynamic = "force-static";

export default function CardsPage() {
  const cards = all as unknown as Card[];
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <span className={styles.navTitle}>Coverage Signal · weekly brief</span>
        {cards.map((c) => (
          <Link key={c.cik} href={`/cards/${c.cik}`} className={styles.navLink}>
            {c.company.toUpperCase()}
          </Link>
        ))}
      </nav>
      {cards.map((c) => (
        <CardView key={c.cik} card={c} />
      ))}
    </main>
  );
}
