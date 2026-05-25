import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { createApp } from "../app.js";
import { signAccessToken } from "../lib/jwt.js";

const prisma = vi.hoisted(() => ({
  auditLog: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  appSettings: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  llmProvider: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  user: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  movie: {
    count: vi.fn(),
  },
  userCollection: {
    count: vi.fn(),
  },
}));

vi.mock("../lib/prisma.js", () => ({
  prisma,
}));

vi.mock("../services/auditLog.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { writeAuditLog } from "../services/auditLog.js";

describe("/api/admin", () => {
  let app: Express;
  const adminId = randomUUID();
  const groqProvId = randomUUID();
  const groqModelId = randomUUID();

  beforeEach(() => {
    app = createApp();
    prisma.auditLog.count.mockReset();
    prisma.auditLog.findMany.mockReset();
    prisma.appSettings.findUnique.mockReset();
    prisma.appSettings.update.mockReset();
    prisma.llmProvider.findMany.mockReset();
    prisma.llmProvider.findUnique.mockReset();
    prisma.user.count.mockReset();
    prisma.user.findMany.mockReset();
    prisma.user.findUnique.mockReset().mockResolvedValue({
      id: adminId,
      email: "boss@test.dev",
      role: "ADMIN",
    });
    prisma.movie.count.mockReset();
    prisma.userCollection.count.mockReset();

    prisma.llmProvider.findMany.mockResolvedValue([
      {
        providerKey: "groq",
        displayName: "Groq",
        isEnabled: true,
        models: [
          {
            modelKey: "llama-mini",
            id: groqModelId,
            isEnabled: true,
            inputCostPer1mTokens: 0.05,
            outputCostPer1mTokens: 0.4,
          },
        ],
      },
    ]);

    prisma.appSettings.findUnique.mockResolvedValue({
      id: "default",
      activeProvider: { providerKey: "groq" },
      activeModel: { modelKey: "llama-mini", id: groqModelId },
    });

    prisma.auditLog.count.mockResolvedValue(1);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: randomUUID(),
        actionType: "AUTH_LOGIN",
        resourceType: "auth",
        resourceId: null,
        resourceLabel: null,
        metadata: {},
        createdAtUtc: new Date(),
        user: { id: adminId, email: "boss@test.dev", displayName: "Boss" },
      },
    ]);

    prisma.user.count.mockResolvedValue(7);
    prisma.user.findMany.mockResolvedValue([
      {
        id: adminId,
        email: "boss@test.dev",
        displayName: "Boss",
        role: "ADMIN",
        createdAt: new Date(),
        _count: { ratings: 0, collections: 1 },
      },
    ]);

    prisma.movie.count.mockResolvedValue(133);
    prisma.userCollection.count.mockResolvedValue(12);
    prisma.appSettings.update.mockResolvedValue({});
    prisma.llmProvider.findUnique.mockResolvedValue({
      id: groqProvId,
      providerKey: "groq",
      isEnabled: true,
      models: [
        {
          modelKey: "llama-mini",
          id: groqModelId,
          isEnabled: true,
        },
      ],
    });

    vi.mocked(writeAuditLog).mockClear();
  });

  const adminHeaders = () => ({
    Authorization: `Bearer ${signAccessToken({
      sub: adminId,
      email: "boss@test.dev",
      role: "ADMIN",
    })}`,
  });

  it("summarizes platform engagement", async () => {
    const res = await request(app).get("/api/admin/activity?page=2").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("scopes activity feeds to explicit patrons when userId supplied", async () => {
    const patron = randomUUID();
    prisma.auditLog.count.mockResolvedValueOnce(3);
    prisma.auditLog.findMany.mockResolvedValueOnce([]);
    await request(app).get(`/api/admin/activity`).query({ userId: patron }).set(adminHeaders()).expect(200);
    expect(prisma.auditLog.count).toHaveBeenCalledWith({ where: { userId: patron } });
  });

  it("rejects invalid paging windows on activity timelines", async () => {
    const res = await request(app).get("/api/admin/activity?page=0").set(adminHeaders());
    expect(res.status).toBe(400);
  });

  it("surfaces prisma failures while listing audits", async () => {
    prisma.auditLog.count.mockRejectedValueOnce(new Error("db"));
    await request(app).get("/api/admin/activity").set(adminHeaders()).expect(500);
  });

  it("lists LLM catalogs with active pairing", async () => {
    const res = await request(app).get("/api/admin/llm/providers").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.active?.providerKey).toBe("groq");
  });

  it("shows a null pairing when canonical settings rows never seeded", async () => {
    prisma.appSettings.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).get("/api/admin/llm/providers").set(adminHeaders());
    expect(res.body.active).toBeNull();
  });

  it("refuses unknown provider/model PATCH pairs", async () => {
    prisma.llmProvider.findUnique.mockResolvedValueOnce(null);
    await request(app)
      .patch("/api/admin/llm/active")
      .set(adminHeaders())
      .send({ providerKey: "missing", modelKey: "x" })
      .expect(400);
  });

  it("refuses PATCH requests for disabled inference vendors", async () => {
    prisma.llmProvider.findUnique.mockResolvedValueOnce({
      id: groqProvId,
      providerKey: "groq",
      isEnabled: false,
      models: [{ modelKey: "llama-mini", id: groqModelId, isEnabled: true }],
    });
    await request(app).patch("/api/admin/llm/active").set(adminHeaders()).send({ providerKey: "groq", modelKey: "llama-mini" }).expect(400);
  });

  it("blocks disabled models even when vendors look healthy", async () => {
    prisma.llmProvider.findUnique.mockResolvedValueOnce({
      id: groqProvId,
      providerKey: "groq",
      isEnabled: true,
      models: [{ modelKey: "legacy-never", id: groqModelId, isEnabled: false }],
    });
    await request(app).patch("/api/admin/llm/active").set(adminHeaders()).send({ providerKey: "groq", modelKey: "legacy-never" }).expect(400);
  });

  it("audits server-side switches between canonical LLM vendors", async () => {
    prisma.appSettings.findUnique.mockResolvedValueOnce({
      id: "default",
      activeProvider: { providerKey: "openai" },
      activeModel: { modelKey: "gpt-mini" },
    });

    prisma.llmProvider.findUnique.mockResolvedValueOnce({
      id: groqProvId,
      providerKey: "groq",
      isEnabled: true,
      models: [{ modelKey: "llama-mini", id: groqModelId, isEnabled: true }],
    });

    await request(app).patch("/api/admin/llm/active").set(adminHeaders()).send({ providerKey: "groq", modelKey: "llama-mini" }).expect(200);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "ADMIN_LLM_PROVIDER_CHANGED",
        metadata: expect.objectContaining({ from: "openai", to: "groq" }),
      }),
    );
  });

  it("promotes curated LLM pairings once validated", async () => {
    await request(app)
      .patch("/api/admin/llm/active")
      .set(adminHeaders())
      .send({ providerKey: "groq", modelKey: "llama-mini" })
      .expect(200);
    expect(prisma.appSettings.update).toHaveBeenCalled();
  });

  it("broadcasts KPI counters", async () => {
    const res = await request(app).get("/api/admin/stats").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.movies).toBe(133);
  });

  it("surfaces stats aggregation failures politely", async () => {
    prisma.user.count.mockRejectedValueOnce(new Error("timeout"));
    await request(app).get("/api/admin/stats").set(adminHeaders()).expect(500);
  });

  it("supports admin user lookups", async () => {
    const res = await request(app).get("/api/admin/users?q=boss").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("lists patrons without narrowing filters when no search query arrives", async () => {
    await request(app).get("/api/admin/users").set(adminHeaders()).expect(200);
    expect(prisma.user.count).toHaveBeenCalledWith({ where: {} });
  });

  it("treats blank search queries as unconstrained lookups", async () => {
    await request(app).get("/api/admin/users").query({ q: "   " }).set(adminHeaders()).expect(200);
    expect(prisma.user.count).toHaveBeenCalledWith({ where: {} });
  });

  it("rejects malformed user directory pagination envelopes", async () => {
    const res = await request(app).get("/api/admin/users?page=0").set(adminHeaders());
    expect(res.status).toBe(400);
  });

  it("responds 403 for non-admin callers", async () => {
    const plebId = randomUUID();
    prisma.user.findUnique.mockResolvedValueOnce({
      id: plebId,
      email: "user@test.dev",
      role: "USER",
    });
    const userHeaders = {
      Authorization: `Bearer ${signAccessToken({
        sub: plebId,
        email: "user@test.dev",
        role: "USER",
      })}`,
    };
    await request(app).get("/api/admin/stats").set(userHeaders).expect(403);
  });

  it("responds 401 for anonymous visitors", async () => {
    await request(app).get("/api/admin/stats").expect(401);
  });
});
