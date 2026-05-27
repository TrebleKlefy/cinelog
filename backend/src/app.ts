import express from "express";
import cors from "cors";
import "dotenv/config";

import { authRouter } from "./routes/auth.js";
import { moviesRouter } from "./routes/movies.js";
import { aiRouter } from "./routes/ai.js";
import { adminRouter } from "./routes/admin.js";
import { collectionsRouter, meRouter } from "./routes/me.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { getActiveLlmReadiness } from "./services/llm.js";

export function createApp() {
  const app = express();

  const origins =
    process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? ["http://localhost:5173"];

  app.use(
    cors({
      origin: origins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/health/db", (_req, res) => {
    res.json({ ok: true, status: "db-healthy" });
  });
  app.get("/api/health/llm", async (_req, res) => {
    try {
      const readiness = await getActiveLlmReadiness();
      if (!readiness.ready) {
        res.status(503).json({
          ok: false,
          status: "llm-not-ready",
          provider: readiness.providerKey,
          model: readiness.modelKey,
          reason: readiness.reason,
        });
        return;
      }
      res.json({
        ok: true,
        status: "llm-healthy",
        provider: readiness.providerKey,
        model: readiness.modelKey,
      });
    } catch (e) {
      res.status(503).json({
        ok: false,
        status: "llm-health-error",
        reason: e instanceof Error ? e.message : "Unknown LLM health error",
      });
    }
  });
  
  app.use("/api/auth", authRouter);
  app.use("/api/movies", moviesRouter);
  app.use("/api/collections", collectionsRouter);
  app.use("/api/me", meRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/admin", adminRouter);

  app.use(errorHandler);

  return app;
}
