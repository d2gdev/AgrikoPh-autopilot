// Minimal in-app notification framework for the Ad Approval workflow. This is
// the "existing notification framework" the spec assumes; email + preferences
// are deferred (spec v1 scope decision). Admin/critical events additionally
// fan out to the ops webhook via lib/alerts.ts.

import { prisma } from "@/lib/db";
import { sendOpsWebhook } from "@/lib/alerts";

export const ADMIN_RECIPIENT = "ADMIN";

export interface NotificationInput {
  recipientId: string; // Shopify user id, or ADMIN_RECIPIENT
  type: string;
  title: string;
  body: string;
  approvalId?: string | null;
  severity?: "info" | "critical";
}

/**
 * Create an in-app notification. Best-effort: failures are logged, never thrown,
 * so a notification problem can't roll back a workflow transition. Critical or
 * admin-targeted notifications also POST to the ops webhook (if configured).
 */
export async function createNotification(input: NotificationInput): Promise<void> {
  const severity = input.severity ?? "info";
  try {
    await prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        approvalId: input.approvalId ?? null,
        severity,
      },
    });
  } catch (err) {
    console.error("[notifications] failed to create notification:", err);
  }

  if (severity === "critical" || input.recipientId === ADMIN_RECIPIENT) {
    await sendOpsWebhook({
      type: "ad_approval_notification",
      notificationType: input.type,
      recipientId: input.recipientId,
      severity,
      title: input.title,
      body: input.body,
      approvalId: input.approvalId ?? null,
      appUrl: process.env.SHOPIFY_APP_URL ?? null,
      timestamp: new Date().toISOString(),
    }).catch((err) => console.warn("[notifications] webhook failed:", err));
  }
}

/** Fan out one notification to several recipients (deduped). */
export async function notifyMany(
  recipientIds: Array<string | null | undefined>,
  input: Omit<NotificationInput, "recipientId">,
): Promise<void> {
  const unique = Array.from(new Set(recipientIds.filter((id): id is string => Boolean(id))));
  await Promise.all(unique.map((recipientId) => createNotification({ ...input, recipientId })));
}
