export type JobStatus = "success" | "partial" | "failed" | "skipped" | "running" | "queued";

export interface JobResult<TSummary = Record<string, unknown>> {
  jobName: string;
  runId: string;
  status: JobStatus;
  summary: TSummary;
  errors: string[];
}

export function isJobSuccessful(status: JobStatus): boolean {
  return status === "success" || status === "partial";
}

export function jobHttpStatus(status: JobStatus): number {
  if (status === "success") return 200;
  if (status === "partial") return 207;
  if (status === "skipped") return 409;
  if (status === "running" || status === "queued") return 202;
  return 500;
}

export function jobOk(status: JobStatus): boolean {
  return status === "success";
}
