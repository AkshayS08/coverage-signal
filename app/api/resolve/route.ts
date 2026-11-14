import { resolveCompany } from "@/lib/pipeline/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stage 2, step 1: a name, ticker or CIK → one match, every match to choose from, or a plain reason. $0. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return Response.json(await resolveCompany(q));
  } catch (e) {
    return Response.json({ kind: "none", reason: `SEC's company list could not be read (${e instanceof Error ? e.message : String(e)})` }, { status: 502 });
  }
}
