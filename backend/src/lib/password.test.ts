import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password helpers", () => {
  it("hashes then verifies plain text", async () => {
    const hash = await hashPassword("SupeR_S3cret!");
    expect(hash).not.toContain("SupeR_S3cret!");

    await expect(verifyPassword("SupeR_S3cret!", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });
});
