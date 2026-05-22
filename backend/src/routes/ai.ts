import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { writeAuditLog } from "../services/auditLog.js";
import {
  getActiveLlmConfig,
  runNlSearchWithActiveLlm,
  runRecommendationsWithActiveLlm,
  type RecommendationRow,
} from "../services/llm.js";
import { buildMovieAgentBootstrap } from "../services/movieAgentBootstrap.js";
import { movieVisibilityWhere } from "../services/movieCatalogScope.js";
import { streamMovieAgentChat } from "../services/movieAgentChat.js";

export const aiRouter = Router();

aiRouter.use(requireAuth);

aiRouter.post("/nl-search", async (req, res, next) => {
  try {
    const schema = z.object({
      query: z.string().min(2),
    });
    const body = schema.parse(req.body);
    const userId = req.user!.id;

    const visibility = await movieVisibilityWhere(req.user!.role, userId);

    const catalogRows = await prisma.movie.findMany({
      take: 80,
      orderBy: { title: "asc" },
      select: { id: true, title: true, releaseYear: true },
      ...(visibility ? { where: visibility } : {}),
    });

    const catalogContext = catalogRows.map((m) => `- ${m.title} (${m.releaseYear}) [${m.id}]`).join("\n");

    const out = await runNlSearchWithActiveLlm({
      query: body.query,
      catalogContext,
      catalog: catalogRows.map((m) => ({ id: m.id, title: m.title, year: m.releaseYear })),
    });

    await writeAuditLog({
      userId,
      actionType: "SEARCH_AI_NATURAL_LANGUAGE",
      resourceType: "movie",
      resourceLabel: body.query.slice(0, 500),
      metadata: {
        llmProvider: out.config.providerKey,
        llmModel: out.config.modelKey,
        usedLiveLlm: out.usedLiveLlm,
      },
    });

    res.json(out.result);
  } catch (e) {
    next(e);
  }
});

aiRouter.post("/recommendations", async (req, res, next) => {
  try {
    const userId = req.user!.id;

    const coll = await prisma.userCollection.findFirst({
      where: { userId },
      include: {
        movies: {
          include: {
            movie: {
              include: {
                genres: { include: { genre: true } },
              },
            },
          },
        },
      },
    });

    const ratings = await prisma.userMovieRating.findMany({
      where: { userId },
      include: { movie: true },
    });

    const historyLines = [
      ...(coll?.movies ?? []).map(
        (cm) =>
          `- Watched: ${cm.movie.title} (${cm.movie.releaseYear}) genres=${cm.movie.genres.map((g) => g.genre.name).join(",")}`,
      ),
      ...ratings.map((r) => `- Rated ${r.rating}/10: ${r.movie.title} (${r.movie.releaseYear})`),
    ].join("\n");

    const visibility = await movieVisibilityWhere(req.user!.role, userId);

    const catalogRows = await prisma.movie.findMany({
      take: 120,
      orderBy: { title: "asc" },
      select: { id: true, title: true, releaseYear: true },
      ...(visibility ? { where: visibility } : {}),
    });

    const out = await runRecommendationsWithActiveLlm({
      historyContext: historyLines || "(no history yet)",
      catalog: catalogRows.map((m) => ({ id: m.id, title: m.title, year: m.releaseYear })),
    });

    await hydrateRecommendationPosterFields(out.result.recommendations);

    await writeAuditLog({
      userId,
      actionType: "AI_RECOMMENDATION_REQUEST",
      resourceType: "ai",
      metadata: {
        llmProvider: out.config.providerKey,
        llmModel: out.config.modelKey,
        usedLiveLlm: out.usedLiveLlm,
      },
    });

    res.json(out.result);
  } catch (e) {
    next(e);
  }
});

aiRouter.get("/agent/bootstrap", async (_req, res, next) => {
  try {
    const b = await buildMovieAgentBootstrap();
    res.json({
      trendingToday: b.trendingToday,
      topRated: b.topRated,
      nowPlaying: b.nowPlaying,
    });
  } catch (e) {
    next(e);
  }
});

aiRouter.post("/agent/chat", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const schema = z.object({
      messages: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1).max(12000),
          }),
        )
        .min(1)
        .max(40),
    });
    const body = schema.parse(req.body);

    const bootstrap = await buildMovieAgentBootstrap();
    const config = await getActiveLlmConfig();

    await streamMovieAgentChat({
      res,
      digestBlock: bootstrap.contextForLlm,
      messages: body.messages,
      config,
    });

    await writeAuditLog({
      userId,
      actionType: "AI_AGENT_CHAT",
      resourceType: "ai",
      resourceLabel: "Movie agent transcript turn",
      metadata: {
        turns: body.messages.length,
        snippet: body.messages[body.messages.length - 1]?.content?.slice(0, 400) ?? "",
        llmProvider: config.providerKey,
        llmModel: config.modelKey,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** Fill posterUrl for catalog-linked rows when prisma poster wasn't threaded through resolver */
async function hydrateRecommendationPosterFields(rows: RecommendationRow[]): Promise<void> {
  const ids = [...new Set(rows.map((r) => r.movieId).filter(Boolean))] as string[];
  if (!ids.length) return;
  const posters = await prisma.movie.findMany({
    where: { id: { in: ids } },
    select: { id: true, posterUrl: true },
  });
  const map = new Map(posters.map((p) => [p.id, p.posterUrl]));
  for (const r of rows) {
    if (r.movieId && (r.posterUrl === undefined || r.posterUrl === null)) {
      r.posterUrl = map.get(r.movieId) ?? null;
    }
  }
}
