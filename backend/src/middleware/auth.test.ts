import type { NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jwtMocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
}));

vi.mock("../lib/jwt.js", () => ({
  verifyAccessToken: jwtMocks.verifyAccessToken,
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: prismaMocks.userFindUnique,
    },
  },
}));

import type { JwtPayload } from "../lib/jwt.js";
import { requireAdmin, requireAuth } from "./auth.js";

beforeEach(() => {
  jwtMocks.verifyAccessToken.mockReset();
  prismaMocks.userFindUnique.mockReset();
});

describe("requireAuth", () => {
  it("responds 401 when Authorization is missing", async () => {
    const req = { headers: {} } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    await requireAuth(req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("responds 401 when header is not Bearer", async () => {
    const req = { headers: { authorization: "Basic x" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    await requireAuth(req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("responds 401 when token verification fails", async () => {
    jwtMocks.verifyAccessToken.mockImplementation(() => {
      throw new Error("bad");
    });
    const req = { headers: { authorization: "Bearer dead.beef" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    await requireAuth(req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("responds 401 when JWT user row no longer exists (e.g. after DB reset)", async () => {
    jwtMocks.verifyAccessToken.mockReturnValue({
      sub: "gone-id",
      email: "u@x.co",
      role: "USER",
    } satisfies JwtPayload);
    prismaMocks.userFindUnique.mockResolvedValueOnce(null);

    const req = { headers: { authorization: "Bearer ok.token" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    await requireAuth(req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches DB user and calls next on success", async () => {
    jwtMocks.verifyAccessToken.mockReturnValue({
      sub: "id-1",
      email: "stale-from-jwt",
      role: "USER",
    } satisfies JwtPayload);

    prismaMocks.userFindUnique.mockResolvedValueOnce({
      id: "id-1",
      email: "u@x.co",
      role: "USER",
    });

    const req = { headers: { authorization: "Bearer ok.token" } } as {
      headers: { authorization: string };
      user?: unknown;
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    await requireAuth(req as never, res as never, next);

    expect(req.user).toEqual({ id: "id-1", email: "u@x.co", role: "USER" });
    expect(next).toHaveBeenCalled();
  });

  it("forwards Prisma errors via next()", async () => {
    jwtMocks.verifyAccessToken.mockReturnValue({
      sub: "id-1",
      email: "u@x.co",
      role: "USER",
    } satisfies JwtPayload);
    const err = new Error("db unavailable");
    prismaMocks.userFindUnique.mockRejectedValueOnce(err);

    const req = { headers: { authorization: "Bearer tok" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    await requireAuth(req, res as never, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalledWith(401);
  });
});

describe("requireAdmin", () => {
  it("401 when user missing", () => {
    const req = {} as { user?: unknown };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    requireAdmin(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 for non-admin", () => {
    const req = { user: { id: "1", email: "u@x", role: "USER" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    requireAdmin(req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows admin", () => {
    const req = { user: { id: "1", email: "a@x", role: "ADMIN" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    requireAdmin(req, res as never, next);

    expect(next).toHaveBeenCalled();
  });
});
