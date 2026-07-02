// AI job queue helpers for the Ad Approval workflow.

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { REVIEW_STAGE, JOB_TIMEOUT_SECONDS } from "./constants";

type Client = typeof prisma | Prisma.TransactionClient;

export type AiStage =
  | typeof REVIEW_STAGE.PRE_REVIEW
  | typeof REVIEW_STAGE.BRAND_REVIEW
  | typeof REVIEW_STAGE.TECHNICAL_REVIEW;

/** Enqueue an AI review job. The worker (jobs/process-ad-reviews) drains these. */
export async function enqueueAiJob(approvalId: string, stage: AiStage, client: Client = prisma): Promise<void> {
  const timeoutSeconds =
    stage === REVIEW_STAGE.TECHNICAL_REVIEW
      ? JOB_TIMEOUT_SECONDS.TECHNICAL_REVIEW
      : JOB_TIMEOUT_SECONDS.PRE_REVIEW;
  await client.adAIJobQueue.create({
    data: { approvalId, stage, status: "QUEUED", attemptNumber: 1, timeoutSeconds },
  });
}
