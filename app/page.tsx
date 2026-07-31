"use client";

import { useState } from "react";
import styles from "./page.module.css";

const DEFAULT_BOOK = [
  "HCA Healthcare",
  "Tenet Healthcare",
  "Universal Health Services",
  "DaVita",
  "Encompass Health",
  "Acadia Healthcare",
  "Select Medical Holdings",
  "Surgery Partners",
].join("\n");

export default function Home() {
  const [book, setBook] = useState(DEFAULT_BOOK);

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
        <button className={styles.runButton} type="button">
          Run agent
        </button>
      </section>

      <section className={styles.panels}>
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Agent trace</h2>
          <div className={styles.panelBody} />
        </div>
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Call sheet</h2>
          <div className={styles.panelBody} />
        </div>
      </section>
    </main>
  );
}
