import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import type { SignOptions } from "jsonwebtoken";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me";

export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
};

export function signAccessToken(payload: JwtPayload, expiresIn = "7d"): string {
  const options: SignOptions = { expiresIn: expiresIn as SignOptions["expiresIn"] };
  return jwt.sign(payload, ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, ACCESS_SECRET);
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token");
  }
  const { sub, email, role } = decoded as Record<string, unknown>;
  if (typeof sub !== "string" || typeof email !== "string" || (role !== "USER" && role !== "ADMIN")) {
    throw new Error("Invalid token payload");
  }
  return { sub, email, role };
}
