import { buildFor, type BuildEvent } from "@/lib/pipeline/buildFor";
import type { CompanyMatch } from "@/lib/pipeline/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Stage 2: build a card, streamed as it goes — one JSON object per line: { type: "event", ... } for each stage, then
 * { type: "outcome", ... }. A cached build is $0. A cold build stops at its price (the estimate, and the allowance or
 * the approval screen). Billing is off until BUILD_BILLING=on is set and Akshay has approved a billed build; a
 * confirmed cold build says so rather than bill.
 */
export async function POST(request: Request) {
  let body: { match?: CompanyMatch; confirm?: boolean };
  try { body = await request.json(); } catch { return new Response("Invalid JSON body", { status: 400 }); }
  const match = body.match;
  if (!match?.cik || !match.title) return new Response("Pick a company first", { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      if (body.confirm && process.env.BUILD_BILLING !== "on") {
        send({ type: "outcome", kind: "could-not-build", stage: "Price it", reason: "Billed builds are not switched on yet: this build was priced, and nothing was charged." });
        controller.close();
        return;
      }
      try {
        const outcome = await buildFor(match, { emit: (e: BuildEvent) => send({ type: "event", ...e }) });
        send({ type: "outcome", ...outcome });
      } catch (e) {
        send({ type: "outcome", kind: "could-not-build", stage: "Render", reason: e instanceof Error ? e.message : String(e) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
