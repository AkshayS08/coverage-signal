/**
 * SESSION 27 (Akshay, Nov 16): NO PENDING MOVE IS RENDERED AS DONE. A move the card facts record as pending (the filer
 * says it intends, expects or will, or announced it) is shown "… announced, awaiting confirmation" on its move card;
 * never with a completed word ("Issued", "Redeemed", "Repurchased", …, "confirmed by 8-K"). Read from the facts, not
 * from anything the card marks, so the check does not depend on the code it checks (pendingMoves.test N5).
 */
import type { CardFacts } from "./types";

const DONE = /\b(?:Issued|Redeemed|Repurchased|Repaid|Amended|Entered|Terminated|Drew|Exchanged|Tendered|Refinanced|Consents received)\b|confirmed by/;
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");
const squash = (s: string) => s.replace(/[\s ]+/g, " ").trim().toLowerCase();

/** The pending moves a card shows with a completed word: "<date>: <what the card says>". */
export function pendingShownAsDone(card: any, facts: CardFacts | null | undefined): string[] {
  const out: string[] = [];
  const moves: any[] = card?.v3?.moves ?? [];
  for (const f of facts?.moves ?? []) {
    if (f.status !== "pending") continue;
    const day = squash(f.date.value);
    for (const mv of moves) {
      const dated = (mv.meta ?? []).some((s: any) => (s.k === "label" && squash(String(s.stated ?? "")) === day) || (s.k === "date" && squash(String(s.stated ?? "")) === day));
      if (!dated) continue;
      const said = `${txt(mv.meta)} | ${(mv.title ?? []).map(txt).join(" ")}`;
      if (DONE.test(said)) out.push(`${f.date.value} (${f.type}, pending in the facts): "${said}"`);
    }
  }
  return out;
}
