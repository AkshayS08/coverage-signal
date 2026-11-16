import { readFileSync, existsSync } from "node:fs";
import { notFound } from "next/navigation";
import type { Card } from "@/lib/cards/types";
import CardView from "../cards/CardView";
import styles from "../cards/cards.module.css";

export const dynamic = "force-dynamic";

/**
 * A REVIEW RENDER OF A CARD THAT IS NOT PUBLISHED (Session 27, Nov 16): Akshay views a billed build's card before it is
 * cleared. Local only — it renders nothing unless REVIEW_CARD_PATH names the card file, which no deployment sets.
 */
export default function Review() {
  const p = process.env.REVIEW_CARD_PATH;
  if (!p || !existsSync(p)) notFound();
  const card = JSON.parse(readFileSync(p, "utf-8")) as Card;
  return (
    <main className={styles.page}>
      <CardView card={card} />
    </main>
  );
}
