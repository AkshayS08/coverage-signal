export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Which commit is this deployment serving? Answered in one request, with no
// passphrase, no cache and no model call. Vercel sets these on git-built
// deployments; a null SHA means the deployment was not built from git (a CLI
// upload or a local server), which is itself the answer, never a default.
export async function GET() {
  return Response.json(
    {
      sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      env: process.env.VERCEL_ENV ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
