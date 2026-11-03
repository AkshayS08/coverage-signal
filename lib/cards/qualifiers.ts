/**
 * SESSION 27 (Akshay, Nov 3, 2026) — QUALIFIERS COME FROM THE LINE'S OWN SENTENCE, BY CODE.
 *
 * A meaning-bearing qualifier (committed/uncommitted, secured/unsecured,
 * available/outstanding) printed in a facility or capacity line's cited
 * sentence, in the stated span's own clause just before it, is on the line,
 * never the model's wording of it. Molina: "… as well as uncommitted capacity
 * to incur incremental term loans …" reads "up to $800MM of uncommitted
 * incremental term loans …". "Undrawn" already says "available", and "drawn"
 * says "outstanding".
 */
import type { Line, Segment } from "./types";

const QUALIFIER = /\b(uncommitted|committed|unsecured|secured|available|outstanding)\b/gi;
const norm = (x: string) => x.replace(/[\s ]+/g, " ").replace(/ %/g, "%").trim();

/** The qualifiers printed in the stated span's own clause, at most six words before it. */
export function qualifiersBefore(stated: string, sentence: string): string[] {
  const s = norm(sentence), w = norm(stated);
  const at = s.toLowerCase().indexOf(w.toLowerCase());
  if (at < 0) return [];
  const before = s.slice(0, at).split(/[,;:()]/).pop()!.trim().split(" ").slice(-6).join(" ");
  return [...new Set([...before.matchAll(QUALIFIER)].map((m) => m[1].toLowerCase()))];
}

/** Whether the line's text already states the qualifier (or its equivalent: "undrawn" is available, "drawn" outstanding). */
export function lineStates(lineText: string, q: string): boolean {
  const l = lineText.toLowerCase();
  if (q === "available") return /\b(?:available|undrawn|availability)\b/.test(l);
  if (q === "outstanding") return /\b(?:outstanding|drawn)\b/.test(l);
  return new RegExp(`\\b${q}\\b`).test(l);
}

const txt = (l: Line) => l.map((s: any) => s.t ?? s.printed ?? "").join("");
const NAMES_THE_THING = /revolv|facilit|credit|term loan|loans|capacity|notes|commercial paper|letters? of credit/i;

/** The line with every qualifier its labels' sentences print and it does not state, on the label naming the thing. */
export function withQualifiers(line: Line): Line {
  const missing: string[] = [];
  for (const s of line) if (s.k === "label" && typeof s.stated === "string" && s.src?.sentence) for (const q of qualifiersBefore(s.stated, s.src.sentence)) if (!lineStates(txt(line), q) && !missing.includes(q)) missing.push(q);
  if (!missing.length) return line;
  const at = line.findIndex((s) => s.k === "label" && NAMES_THE_THING.test(s.t));
  if (at < 0) return line;
  const seg = line[at] as Extract<Segment, { k: "label" }>;
  return [...line.slice(0, at), { ...seg, t: `${missing.join(" ")} ${seg.t}` }, ...line.slice(at + 1)];
}
