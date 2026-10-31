/**
 * SESSION 27 (Akshay, Oct 30, 2026) — WHAT A SECTION SAYS WHEN IT HAS NOTHING
 * TO LIST. One function, used by the page and by the checks, so the page can
 * never assert an absence the checks did not see.
 *
 * Where the stage that reads a section has not run on the card's anchor, the
 * section says "not yet read from [filing]". Only a stage that ran and found
 * nothing may say there is nothing.
 */
import type { CardV3, Line } from "./types";

const text = (l: Line) => l.map((s: any) => s.t ?? s.printed ?? "").join("");

/** The moves section's own line: "not yet read from …" when the facts stage has not run, the empty state when it ran and found none, else "". */
export function movesSectionText(v: Pick<CardV3, "moves"> & { movesUnread?: Line | null; possibleMoves?: Line[] }): string {
  if (v.movesUnread) return text(v.movesUnread);
  // Oct 31: a located move sentence no confirmed move covers forbids "none" — the section lists it as possible instead.
  if ((v.possibleMoves ?? []).length) return "";
  return v.moves.length === 0 ? "No debt moves stated this year." : "";
}
