import { prisma } from "./db";

const LOCK_TTL_MS = 10 * 60 * 1000;

export async function acquireJobLock(
  jobName: string,
  options: { ttlMs?: number; ownerToken?: string } = {},
): Promise<boolean> {
  const expiresAt = new Date(Date.now() + (options.ttlMs ?? LOCK_TTL_MS));
  try {
    await prisma.$transaction(async (tx) => {
      await tx.jobLock.deleteMany({
        where: { jobName, expiresAt: { lt: new Date() } },
      });
      await tx.jobLock.create({ data: { jobName, expiresAt, ownerToken: options.ownerToken } });
    });
    return true;
  } catch (e: unknown) {
    if (isPrismaUniqueViolation(e)) return false;
    throw e;
  }
}

export async function releaseJobLock(jobName: string, ownerToken?: string): Promise<void> {
  await prisma.jobLock.deleteMany({ where: ownerToken ? { jobName, ownerToken } : { jobName } });
}

function isPrismaUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: string }).code === "P2002"
  );
}
