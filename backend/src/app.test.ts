import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getActiveLlmReadiness = vi.hoisted(() => vi.fn());

vi.mock("./services/llm.js", () => ({
  getActiveLlmReadiness: (...args: unknown[]) => getActiveLlmReadiness(...args),
}));

describe("createApp", () => {
  beforeEach(() => {
    getActiveLlmReadiness.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET /api/health returns ok", async () => {
    const { createApp } = await import("./app.js");
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /api/health/db returns db-healthy", async () => {
    const { createApp } = await import("./app.js");
    const res = await request(createApp()).get("/api/health/db");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: "db-healthy" });
  });

  it("GET /api/health/llm returns ok when provider is ready", async () => {
    getActiveLlmReadiness.mockResolvedValueOnce({
      ready: true,
      providerKey: "groq",
      modelKey: "llama",
    });
    const { createApp } = await import("./app.js");
    const res = await request(createApp()).get("/api/health/llm");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "llm-healthy", provider: "groq" });
  });

  it("GET /api/health/llm returns 503 when provider is not ready", async () => {
    getActiveLlmReadiness.mockResolvedValueOnce({
      ready: false,
      providerKey: "groq",
      modelKey: "llama",
      reason: "Missing GROQ_API_KEY",
    });
    const { createApp } = await import("./app.js");
    const res = await request(createApp()).get("/api/health/llm");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, status: "llm-not-ready", reason: "Missing GROQ_API_KEY" });
  });

  it("GET /api/health/llm returns 503 when readiness lookup throws", async () => {
    getActiveLlmReadiness.mockRejectedValueOnce(new Error("settings unavailable"));
    const { createApp } = await import("./app.js");
    const res = await request(createApp()).get("/api/health/llm");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, status: "llm-health-error", reason: "settings unavailable" });
  });

  it("GET /api/health/llm handles non-Error rejections", async () => {
    getActiveLlmReadiness.mockRejectedValueOnce("broken");
    const { createApp } = await import("./app.js");
    const res = await request(createApp()).get("/api/health/llm");
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe("Unknown LLM health error");
  });

  it("uses default CORS origin when CORS_ORIGINS is unset", async () => {
    vi.unstubAllEnvs();
    delete process.env.CORS_ORIGINS;
    vi.resetModules();
    const { createApp } = await import("./app.js");
    const res = await request(createApp()).get("/api/health").set("Origin", "http://localhost:5173");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("allows origins listed in CORS_ORIGINS", async () => {
    vi.stubEnv("CORS_ORIGINS", "https://app.example.com, https://staging.example.com");
    vi.resetModules();
    const { createApp } = await import("./app.js");
    const res = await request(createApp()).get("/api/health").set("Origin", "https://staging.example.com");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://staging.example.com");
  });
});
