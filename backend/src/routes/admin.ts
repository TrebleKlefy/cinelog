import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { writeAuditLog } from "../services/auditLog.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/activity", async (req, res, next) => {
  try {
    const schema = z.object({
      page: z.coerce.number().min(1).optional().default(1),
      pageSize: z.coerce.number().min(1).max(100).optional().default(30),
      userId: z.string().uuid().optional(),
    });
    const q = schema.parse(req.query);

    const where = q.userId ? { userId: q.userId } : {};
    const skip = (q.page - 1) * q.pageSize;

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAtUtc: "desc" },
        skip,
        take: q.pageSize,
        include: {
          user: { select: { id: true, email: true, displayName: true } },
        },
      }),
    ]);

    res.json({
      page: q.page,
      pageSize: q.pageSize,
      total,
      items: rows.map((r) => ({
        id: r.id,
        actionType: r.actionType,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        resourceLabel: r.resourceLabel,
        metadata: r.metadata,
        createdAtUtc: r.createdAtUtc,
        user: r.user,
      })),
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/llm/providers", async (_req, res, next) => {
  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: "default" },
      include: {
        activeProvider: true,
        activeModel: true,
      },
    });

    const providers = await prisma.llmProvider.findMany({
      include: { models: true },
      orderBy: { providerKey: "asc" },
    });

    res.json({
      active: settings
        ? {
            providerKey: settings.activeProvider.providerKey,
            modelKey: settings.activeModel.modelKey,
          }
        : null,
      providers: providers.map((p) => ({
        providerKey: p.providerKey,
        displayName: p.displayName,
        isEnabled: p.isEnabled,
        models: p.models.map((m) => ({
          modelKey: m.modelKey,
          id: m.id,
          isEnabled: m.isEnabled,
          inputCostPer1mTokens: m.inputCostPer1mTokens,
          outputCostPer1mTokens: m.outputCostPer1mTokens,
        })),
      })),
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch("/llm/active", async (req, res, next) => {
  try {
    const schema = z.object({
      providerKey: z.string(),
      modelKey: z.string(),
    });
    const body = schema.parse(req.body);
    const adminId = req.user!.id;

    const provider = await prisma.llmProvider.findUnique({
      where: { providerKey: body.providerKey },
      include: { models: true },
    });
    if (!provider || !provider.isEnabled) {
      res.status(400).json({ error: "Unknown or disabled provider" });
      return;
    }

    const model = provider.models.find((m) => m.modelKey === body.modelKey && m.isEnabled);
    if (!model) {
      res.status(400).json({ error: "Unknown or disabled model for provider" });
      return;
    }

    const current = await prisma.appSettings.findUnique({
      where: { id: "default" },
      include: { activeProvider: true, activeModel: true },
    });

    await prisma.appSettings.update({
      where: { id: "default" },
      data: {
        activeLlmProviderId: provider.id,
        activeLlmModelId: model.id,
        updatedByUserId: adminId,
      },
    });

    if (current && current.activeProvider.providerKey !== provider.providerKey) {
      await writeAuditLog({
        userId: adminId,
        actionType: "ADMIN_LLM_PROVIDER_CHANGED",
        resourceType: "settings",
        metadata: {
          from: current.activeProvider.providerKey,
          to: provider.providerKey,
        },
      });
    }

    if (current && current.activeModel.modelKey !== model.modelKey) {
      await writeAuditLog({
        userId: adminId,
        actionType: "ADMIN_LLM_MODEL_CHANGED",
        resourceType: "settings",
        metadata: {
          provider: provider.providerKey,
          from: current.activeModel.modelKey,
          to: model.modelKey,
        },
      });
    }

    res.json({
      ok: true,
      active: {
        providerKey: provider.providerKey,
        modelKey: model.modelKey,
      },
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/stats", async (_req, res, next) => {
  try {
    const [userCount, movieCount, auditCount, collectionCount] = await Promise.all([
      prisma.user.count(),
      prisma.movie.count(),
      prisma.auditLog.count(),
      prisma.userCollection.count(),
    ]);
    res.json({
      users: userCount,
      movies: movieCount,
      auditLogs: auditCount,
      collections: collectionCount,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/users", async (req, res, next) => {
  try {
    const schema = z.object({
      page: z.coerce.number().min(1).optional().default(1),
      pageSize: z.coerce.number().min(1).max(100).optional().default(25),
      q: z.string().optional(),
    });
    const q = schema.parse(req.query);
    const skip = (q.page - 1) * q.pageSize;
    const where =
      q.q && q.q.trim().length > 0
        ? {
            OR: [
              { email: { contains: q.q.trim(), mode: "insensitive" as const } },
              { displayName: { contains: q.q.trim(), mode: "insensitive" as const } },
            ],
          }
        : {};

    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: q.pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          createdAt: true,
          _count: {
            select: {
              ratings: true,
              collections: true,
            },
          },
        },
      }),
    ]);

    res.json({
      page: q.page,
      pageSize: q.pageSize,
      total,
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        createdAt: u.createdAt,
        ratingsCount: u._count.ratings,
        collectionsCount: u._count.collections,
      })),
    });
  } catch (e) {
    next(e);
  }
});
