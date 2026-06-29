// Next.js instrumentation hook — runs once when the server process starts.
// Use this for work that must happen before requests are served, specifically
// cleaning up DB state that a previous process may have left inconsistent.
export async function register() {
  // Only run in the Node.js runtime (not edge), and skip during next build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "test") return;

  const { prisma } = await import("@/lib/db");

  // Recover rows left in a transitional state by a process that was killed
  // mid-operation (deploy restart, OOM, timeout). These states are never
  // terminal — they should resolve to "failed" or "ready" — but without
  // this sweep they stay stuck until a manual action triggers recovery.
  //
  // Thresholds are set to exceed the relevant maxDuration on each route:
  //   generate-draft: maxDuration=300s → 6 min threshold
  //   publish:        maxDuration=30s  → 2 min threshold
  const now = new Date();
  const GENERATING_STALE_MS = 6 * 60 * 1000;
  const PUBLISHING_STALE_MS = 2 * 60 * 1000;

  try {
    const [stuckGenerating, stuckPublishing] = await Promise.all([
      prisma.contentProposal.updateMany({
        where: {
          draftStatus: "generating",
          draftGeneratedAt: { lt: new Date(now.getTime() - GENERATING_STALE_MS) },
        },
        data: { draftStatus: "failed" },
      }),
      prisma.contentProposal.updateMany({
        where: {
          draftStatus: "publishing",
          updatedAt: { lt: new Date(now.getTime() - PUBLISHING_STALE_MS) },
        },
        data: { draftStatus: "ready" },
      }),
    ]);

    if (stuckGenerating.count > 0) {
      console.log(`[startup] recovered ${stuckGenerating.count} stuck generating draft(s) → failed`);
    }
    if (stuckPublishing.count > 0) {
      console.log(`[startup] recovered ${stuckPublishing.count} stuck publishing draft(s) → ready`);
    }
  } catch (err) {
    // Non-fatal — log and continue. A DB hiccup at startup shouldn't prevent
    // the server from serving requests.
    console.error("[startup] stale-state sweep failed:", err);
  }
}
