import jwtLib from "jsonwebtoken";
import { describe, expect, beforeEach, it, vi } from "vitest";

const TEST_SECRET = "unittest-jwt-access-secret-xx";

describe("jwt helpers", () => {
  async function loadJwtModule() {
    vi.resetModules();
    process.env.JWT_ACCESS_SECRET = TEST_SECRET;
    return import("./jwt.js");
  }

  beforeEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    vi.restoreAllMocks();
  });

  it("roundtrips a valid access payload", async () => {
    const { signAccessToken, verifyAccessToken } = await loadJwtModule();

    const token = signAccessToken({ sub: "user-1", email: "a@b.co", role: "USER" });
    expect(typeof token).toBe("string");
    expect(verifyAccessToken(token)).toEqual({
      sub: "user-1",
      email: "a@b.co",
      role: "USER",
    });
  });

  it("accepts ADMIN role tokens", async () => {
    const { signAccessToken, verifyAccessToken } = await loadJwtModule();

    const token = signAccessToken({ sub: "adm", email: "admin@demo.com", role: "ADMIN" }, "2h");
    expect(verifyAccessToken(token)).toEqual({
      sub: "adm",
      email: "admin@demo.com",
      role: "ADMIN",
    });
  });

  it("rejects wrong audience shape", async () => {
    const { verifyAccessToken } = await loadJwtModule();

    const bad = jwtLib.sign({ sub: "1", email: "x", role: "BOT" }, TEST_SECRET);
    expect(() => verifyAccessToken(bad)).toThrow("Invalid token payload");
  });

  it("rejects non-object payloads", async () => {
    const { verifyAccessToken } = await loadJwtModule();

    const bad = jwtLib.sign("oops-payload-string", TEST_SECRET);
    expect(() => verifyAccessToken(bad)).toThrow("Invalid token");
  });

  it("rejects mismatched signatures", async () => {
    const { verifyAccessToken } = await loadJwtModule();

    const bad = jwtLib.sign({ sub: "1", email: "x", role: "USER" }, "another-secret-xxxx");
    expect(() => verifyAccessToken(bad)).toThrow();
  });
});
