import type { Response } from "express";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { errorHandler } from "./errorHandler.js";

function mockRes(): Pick<Response, "status" | "json"> & { statusCode?: number } {
  const chain = {
    status(code: number) {
      chain.statusCode = code;
      return chain;
    },
    json: vi.fn(),
    statusCode: undefined as number | undefined,
  };
  return chain as Pick<Response, "status" | "json"> & { statusCode?: number };
}

describe("errorHandler", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles ZodError with 400 and details", () => {
    const res = mockRes();
    let err: unknown;
    try {
      z.string().parse(1);
    } catch (e) {
      err = e;
    }
    errorHandler(err as never, {} as never, res as Response, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Validation failed",
        details: expect.any(Array),
      }),
    );
  });

  it("defaults to 500 for unknown errors", () => {
    const res = mockRes();
    errorHandler(new Error("boom") as never, {} as never, res as Response, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  it("honors numeric err.status when present", () => {
    const res = mockRes();
    const err = Object.assign(new Error("nope"), { status: 404 });
    errorHandler(err as never, {} as never, res as Response, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(res.json).toHaveBeenCalledWith({ error: "nope" });
  });
});
