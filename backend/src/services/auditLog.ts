import type { AuditActionType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export async function writeAuditLog(input: {
  userId: string;
  actionType: AuditActionType;
  resourceType: string;
  resourceId?: string | null;
  resourceLabel?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      actionType: input.actionType,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      resourceLabel: input.resourceLabel ?? null,
      metadata: input.metadata ?? undefined,
    },
  });
}
