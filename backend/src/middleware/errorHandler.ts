import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    });
    return;
  }
  const status = typeof err.status === "number" ? err.status : 500;
  const message = status === 500 ? "Internal server error" : String(err.message ?? "Error");
  res.status(status).json({ error: message });
};
