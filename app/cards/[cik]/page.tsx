import Link from "next/link";
import { notFound } from "next/navigation";
import type { Card } from "@/lib/cards/types";
import all from "@/lib/cards/generated/all.json";
import CardView from "../CardView";
import styles from "../cards.module.css";

const cards = all as unknown as Card[];

export function generateStaticParams() {
  return cards.map((c) => ({ cik: c.cik }));
}

export default async function OneCard({ params }: { params: Promise<{ cik: string }> }) {
  const { cik } = await params;
  const card = cards.find((c) => c.cik === cik);
  if (!card) notFound();
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/cards" className={styles.navLink}>← all six</Link>
      </nav>
      <CardView card={card} />
    </main>
  );
}
