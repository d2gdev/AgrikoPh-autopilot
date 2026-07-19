const DAY_MS = 24 * 60 * 60 * 1000;

export type GscReportingWindow = {
  start: Date;
  end: Date;
};

function wholeDays(value: number, minimum: number): number {
  return Math.max(minimum, Math.floor(Number.isFinite(value) ? value : minimum));
}

function shiftUtcDate(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function buildGscReportingWindows(input: {
  capturedAt: Date;
  lagDays: number;
  windowDays: number;
}): { current: GscReportingWindow; previous: GscReportingWindow } {
  if (!Number.isFinite(input.capturedAt.getTime())) {
    throw new Error("GSC reporting window requires a valid capture date.");
  }

  const lagDays = wholeDays(input.lagDays, 0);
  const windowDays = wholeDays(input.windowDays, 1);
  const captureDate = new Date(Date.UTC(
    input.capturedAt.getUTCFullYear(),
    input.capturedAt.getUTCMonth(),
    input.capturedAt.getUTCDate(),
  ));

  const currentEnd = shiftUtcDate(captureDate, -lagDays);
  const currentStart = shiftUtcDate(currentEnd, -(windowDays - 1));
  const previousEnd = shiftUtcDate(currentStart, -1);
  const previousStart = shiftUtcDate(previousEnd, -(windowDays - 1));

  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd },
  };
}
