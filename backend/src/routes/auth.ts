import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { writeAuditLog } from "../services/auditLog.js";

export const authRouter = Router();

authRouter.post("/register", async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      displayName: z.string().min(1),
    });
    const body = schema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        displayName: body.displayName,
      },
    });

    await prisma.userCollection.create({
      data: {
        userId: user.id,
        slug: body.email.split("@")[0]?.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 48) ?? `user-${user.id.slice(0, 8)}`,
        title: `${body.displayName}'s Collection`,
        isPublic: false,
      },
    });

    const token = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    await writeAuditLog({
      userId: user.id,
      actionType: "AUTH_LOGIN",
      resourceType: "auth",
      metadata: { via: "register" },
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string(),
    });
    const body = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    await writeAuditLog({
      userId: user.id,
      actionType: "AUTH_LOGIN",
      resourceType: "auth",
      metadata: { via: "login" },
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      try {
        const { verifyAccessToken } = await import("../lib/jwt.js");
        const token = header.slice("Bearer ".length);
        const payload = verifyAccessToken(token);
        await writeAuditLog({
          userId: payload.sub,
          actionType: "AUTH_LOGOUT",
          resourceType: "auth",
          metadata: {},
        });
      } catch {
        /* ignore token errors on logout */
      }
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
