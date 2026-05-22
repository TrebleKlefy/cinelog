import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import * as pwd from "../lib/password.js";
import { signAccessToken } from "../lib/jwt.js";

const userFindUnique = vi.hoisted(() => vi.fn());
const userCreate = vi.hoisted(() => vi.fn());
const collCreate = vi.hoisted(() => vi.fn());
const auditWrite = vi.hoisted(() => vi.fn());

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: userFindUnique,
      create: userCreate,
    },
    userCollection: {
      create: collCreate,
    },
  },
}));

vi.mock("../services/auditLog.js", () => ({
  writeAuditLog: (...args: unknown[]) => auditWrite(...args),
}));

describe("/api/auth", () => {
  const app = createApp();

  beforeEach(() => {
    userFindUnique.mockReset();
    userCreate.mockReset();
    collCreate.mockReset();
    auditWrite.mockReset().mockResolvedValue(undefined);
    vi.spyOn(pwd, "hashPassword").mockResolvedValue("$2a$stub");
    vi.spyOn(pwd, "verifyPassword").mockResolvedValue(true);
  });

  it("registers accounts and returns bearer token payloads", async () => {
    const id = randomUUID();
    userFindUnique.mockResolvedValueOnce(null);
    userCreate.mockResolvedValueOnce({
      id,
      email: "alice@cinema.dev",
      displayName: "Alice",
      role: "USER",
    });
    collCreate.mockResolvedValueOnce({});
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@cinema.dev", password: "Password1!", displayName: "Alice" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("alice@cinema.dev");
    expect(typeof res.body.token).toBe("string");
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "AUTH_LOGIN",
        metadata: expect.objectContaining({ via: "register" }),
      }),
    );
  });

  it("rejects conflicting emails", async () => {
    userFindUnique.mockResolvedValueOnce({ id: randomUUID() });
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "dup@cinema.dev", password: "Password1!", displayName: "Dup" });
    expect(res.status).toBe(409);
  });

  it("rejects malformed registration bodies", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "not-email", password: "short" });
    expect(res.status).toBe(400);
  });

  it("logs returning users on success", async () => {
    const id = randomUUID();
    userFindUnique.mockResolvedValueOnce({
      id,
      email: "bob@cinema.dev",
      passwordHash: "hash-here",
      displayName: "Bob",
      role: "ADMIN",
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "bob@cinema.dev", password: "Password1!" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ via: "login" }),
      }),
    );
  });

  it("rejects bogus credentials without leaking details", async () => {
    userFindUnique.mockResolvedValueOnce(null);
    pwd.verifyPassword.mockResolvedValueOnce(false);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@cinema.dev", password: "nope-nope-nope" });
    expect(res.status).toBe(401);
  });

  it("accepts stray tokens on logout (best-effort audit)", async () => {
    const token = signAccessToken({
      sub: randomUUID(),
      email: "ghost@cinema.dev",
      role: "USER",
    });
    await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "AUTH_LOGOUT",
      }),
    );
  });

  it("skips auditing anonymous logout calls", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(200);
    expect(auditWrite).not.toHaveBeenCalled();
  });

  it("still succeeds when bearer headers cannot be deciphered during logout", async () => {
    const res = await request(app).post("/api/auth/logout").set("Authorization", "Bearer totally-invalid");
    expect(res.status).toBe(200);
    expect(auditWrite).not.toHaveBeenCalled();
  });

  it("delegates login database outages downstream", async () => {
    userFindUnique.mockRejectedValueOnce(new Error("pg down"));
    const res = await request(app).post("/api/auth/login").send({ email: "bob@cinema.dev", password: "Password1!" });
    expect(res.status).toBe(500);
  });

  it("propagates registration persistence failures cleanly", async () => {
    const id = randomUUID();
    userFindUnique.mockResolvedValueOnce(null);
    userCreate.mockRejectedValueOnce(new Error("lost connection"));
    const res = await request(app).post("/api/auth/register").send({
      email: "crisis@cinema.dev",
      password: "Password1!",
      displayName: "Cris",
    });
    expect(res.status).toBe(500);
  });
});
