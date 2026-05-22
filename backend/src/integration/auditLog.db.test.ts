import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AuditActionType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";
import { writeAuditLog } from "../services/auditLog.js";

const runIntegration = process.env.RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("audit log database integrity", () => {
  let userId: string | undefined;

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { resourceLabel: "integration-probe" } });
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it("writes rows with server-side timestamps and FK integrity", async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `audit-${userId.slice(0, 8)}@integration.local`,
        passwordHash: await hashPassword("Audit123!audit"),
        displayName: "Audit Bot",
        role: "USER",
      },
    });

    const before = Date.now();
    await writeAuditLog({
      userId,
      actionType: AuditActionType.SEARCH_STRUCTURED,
      resourceType: "integration",
      resourceLabel: "integration-probe",
      resourceId: randomUUID(),
      metadata: { probe: true },
    });

    const row = await prisma.auditLog.findFirst({
      where: { userId, resourceLabel: "integration-probe" },
      orderBy: { createdAtUtc: "desc" },
    });

    expect(row).toBeTruthy();
    expect(row!.actionType).toBe(AuditActionType.SEARCH_STRUCTURED);
    expect(row!.resourceType).toBe("integration");
    expect(row!.userId).toBe(userId);
    expect(row!.createdAtUtc.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(row!.createdAtUtc.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });
});
