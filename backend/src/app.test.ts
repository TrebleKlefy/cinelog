import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("createApp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET /api/health returns ok", async () => {
    const { createApp } = await import("./app.js");
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
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
