import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditActionType } from "@prisma/client";
import { AuditActionType as Action } from "@prisma/client";

const prismaMocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    auditLog: {
      create: prismaMocks.auditCreate,
    },
  },
}));

import { writeAuditLog } from "./auditLog.js";

describe("writeAuditLog", () => {
  beforeEach(() => {
    prismaMocks.auditCreate.mockResolvedValue(undefined);
  });

  it("persists normalized fields", async () => {
    await writeAuditLog({
      userId: "u1",
      actionType: Action.MOVIE_IMPORT_TMDB satisfies AuditActionType,
      resourceType: "Movie",
      resourceId: "m1",
      resourceLabel: "Test",
      metadata: { k: "v" },
    });

    expect(prismaMocks.auditCreate).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        actionType: Action.MOVIE_IMPORT_TMDB,
        resourceType: "Movie",
        resourceId: "m1",
        resourceLabel: "Test",
        metadata: { k: "v" },
      },
    });
  });

  it("stores null-ish optional fields cleanly", async () => {
    await writeAuditLog({
      userId: "u2",
      actionType: Action.AUTH_LOGIN,
      resourceType: "Session",
      resourceId: undefined,
      resourceLabel: undefined,
      metadata: undefined,
    });

    expect(prismaMocks.auditCreate).toHaveBeenCalledWith({
      data: {
        userId: "u2",
        actionType: Action.AUTH_LOGIN,
        resourceType: "Session",
        resourceId: null,
        resourceLabel: null,
        metadata: undefined,
      },
    });
  });
});
