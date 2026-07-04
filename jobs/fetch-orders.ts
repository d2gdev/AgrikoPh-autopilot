import { prisma } from "@/lib/db";
import { fetchOrdersWindow } from "@/lib/connectors/shopify-orders";
import type { JobResult } from "@/lib/jobs/types";

type FetchOrdersSummary = {
  daysWritten: number;
  ordersSeen: number;
  revenueTotal: number;
  backfilled: boolean;
};

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function ordersPayload(
  orders: Array<{ id: string; financialStatus: string | null; total: number; cancelled: boolean; productIds: string[] }>,
) {
  return {
    orders: orders.map((o) => ({
      id: o.id,
      financialStatus: o.financialStatus,
      total: o.total,
      cancelled: o.cancelled,
      productIds: o.productIds,
    })),
  } as object;
}

export async function fetchOrdersHandler(): Promise<JobResult<FetchOrdersSummary>> {
  const jobRun = await prisma.jobRun.create({
    data: { jobName: "fetch-orders", triggeredBy: "scheduler", status: "running" },
  });
  const errors: string[] = [];

  try {
    const existing = await prisma.dailySales.count();
    const backfilled = existing === 0;
    const today = utcMidnight(new Date());
    const dayCount = backfilled ? 28 : 1;

    let daysWritten = 0;
    let ordersSeen = 0;
    let revenueTotal = 0;

    for (let i = dayCount; i >= 1; i--) {
      const dayStart = new Date(today.getTime() - i * 24 * 3_600_000);
      const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
      const { orders, currency } = await fetchOrdersWindow({ start: dayStart, end: dayEnd });
      const live = orders.filter((o) => !o.cancelled);
      const revenue = live.reduce((sum, o) => sum + o.total, 0);
      const aov = live.length > 0 ? revenue / live.length : 0;

      await prisma.dailySales.upsert({
        where: { date: dayStart },
        update: { orders: live.length, revenue, aov, currency: currency ?? "PHP" },
        create: { date: dayStart, orders: live.length, revenue, aov, currency: currency ?? "PHP" },
      });
      await prisma.rawSnapshot.upsert({
        where: {
          source_dateRangeStart_dateRangeEnd: {
            source: "shopify_orders",
            dateRangeStart: dayStart,
            dateRangeEnd: dayEnd,
          },
        },
        update: { payload: ordersPayload(orders), fetchedAt: new Date() },
        create: {
          source: "shopify_orders",
          dateRangeStart: dayStart,
          dateRangeEnd: dayEnd,
          payload: ordersPayload(orders),
        },
      });

      daysWritten++;
      ordersSeen += orders.length;
      revenueTotal += revenue;
    }

    const summary: FetchOrdersSummary = { daysWritten, ordersSeen, revenueTotal, backfilled };

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: "success", completedAt: new Date(), summary },
    });
    return { jobName: "fetch-orders", runId: jobRun.id, status: "success", summary, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    await prisma.jobRun
      .update({
        where: { id: jobRun.id },
        data: { status: "failed", completedAt: new Date(), errorLog: errors.join("\n") },
      })
      .catch(() => {});
    return {
      jobName: "fetch-orders",
      runId: jobRun.id,
      status: "failed",
      summary: { daysWritten: 0, ordersSeen: 0, revenueTotal: 0, backfilled: false },
      errors,
    };
  }
}
