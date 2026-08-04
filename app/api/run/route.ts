import { runAgentLoop, type RunStreamEvent } from "@/lib/agent";
import { buildEvents } from "@/lib/events";
import { draftEventBriefing } from "@/lib/events/sonnetEventBriefing";
import { checkRateLimit } from "./rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Guardrail from the metrics doc: cap the book so a public link can't run up spend.
const MAX_COMPANIES = 12;

function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  let body: { companies?: unknown; passphrase?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // Spend safety, checked before any model call: a shared passphrase gate.
  const expectedPasscode = process.env.APP_PASSCODE;
  if (!expectedPasscode) {
    return new Response("Server not configured: APP_PASSCODE is not set", { status: 500 });
  }
  if (typeof body.passphrase !== "string" || body.passphrase !== expectedPasscode) {
    return new Response("Incorrect passphrase", { status: 401 });
  }

  // Backstop rate limit so even a valid passphrase can't loop expensively.
  const rate = checkRateLimit(getClientKey(request));
  if (!rate.allowed) {
    const minutes = Math.max(1, Math.ceil((rate.retryAfterMs ?? 0) / 60000));
    return new Response(
      `Rate limit reached: max 10 runs per hour on this link. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      { status: 429 }
    );
  }

  const companies = body.companies;
  if (!Array.isArray(companies)) {
    return new Response("Missing companies list", { status: 400 });
  }

  const names = companies
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim())
    .slice(0, MAX_COMPANIES);

  if (names.length === 0) {
    return new Response("No valid company names", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RunStreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      for (const company of names) {
        try {
          const result = await runAgentLoop(company, (text) => send({ type: "trace", company, text }));

          // Card eligibility is per-event, not per-company — a company can
          // produce zero, one, or several card-eligible events. Only those
          // get a Sonnet call; table-only events never do. The portfolio
          // table's per-company summary is fully deterministic (see
          // lib/events/companySummary.ts) and computed client-side, so
          // there's nothing else to draft here.
          const { flashCardCandidates } = buildEvents([result]);
          const eventBriefings: { eventId: string; briefing: Awaited<ReturnType<typeof draftEventBriefing>> }[] = [];
          for (const card of flashCardCandidates) {
            // Freshness-gate audit trail: why this card qualified, so the
            // gate's decision is visible in the trace, not a black box.
            send({ type: "trace", company, text: `card qualified: ${card.freshnessReason}` });

            const drafted = await draftEventBriefing(card);
            const label = drafted.source === "sonnet" ? "Sonnet-drafted" : "template (Sonnet unavailable)";
            console.log(`[eventBriefing] ${result.company} (${card.bucket}): ${drafted.source}`);
            send({ type: "trace", company, text: `card briefing (${card.bucket}): ${label}` });
            eventBriefings.push({ eventId: card.id, briefing: drafted });
          }

          send({ type: "result", result, eventBriefings });
        } catch (err) {
          send({ type: "error", company, message: err instanceof Error ? err.message : String(err) });
        }
      }

      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
