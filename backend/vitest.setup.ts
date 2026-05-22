import { afterEach, vi } from "vitest";

process.env.JWT_ACCESS_SECRET ||= "vitest-jwt-secret-min-32-characters";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
