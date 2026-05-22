import type { NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jwtMocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock("../lib/jwt.js", () => ({
  verifyAccessToken: jwtMocks.verifyAccessToken,
}));

import type { JwtPayload } from "../lib/jwt.js";
import { requireAdmin, requireAuth } from "./auth.js";

beforeEach(() => {
  jwtMocks.verifyAccessToken.mockReset();
});

describe("requireAuth", () => {
  it("responds 401 when Authorization is missing", () => {
    const req = { headers: {} } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    requireAuth(req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("responds 401 when header is not Bearer", () => {
    const req = { headers: { authorization: "Basic x" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    requireAuth(req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("responds 401 when token verification fails", () => {
    jwtMocks.verifyAccessToken.mockImplementation(() => {
      throw new Error("bad");
    });
    const req = { headers: { authorization: "Bearer dead.beef" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    requireAuth(req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches user and calls next on success", () => {
    jwtMocks.verifyAccessToken.mockReturnValue({
      sub: "id-1",
      email: "u@x.co",
      role: "USER",
    } satisfies JwtPayload);

    const req = { headers: { authorization: "Bearer ok.token" } } as {
      headers: { authorization: string };
      user?: unknown;
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn() satisfies NextFunction;
    requireAuth(req as never, res as never, next);

    expect(req.user).toEqual({ id: "id-1", email: "u@x.co", role: "USER" });
    expect(next).toHaveBeenCalled();
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
