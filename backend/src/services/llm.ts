import Groq from "groq-sdk";

import { prisma } from "../lib/prisma.js";

export type ActiveLlmConfig = {
  providerKey: string;
  modelKey: string;
};

export type ActiveLlmReadiness = ActiveLlmConfig & {
  ready: boolean;
  reason?: string;
};

export async function getActiveLlmConfig(): Promise<ActiveLlmConfig> {
  const settings = await prisma.appSettings.findUniqueOrThrow({
    where: { id: "default" },
    include: {
      activeProvider: true,
      activeModel: true,
    },
  });
  return {
    providerKey: settings.activeProvider.providerKey,
    modelKey: settings.activeModel.modelKey,
  };
}

function providerKeyEnvName(providerKey: string): string | null {
  if (providerKey === "openai") return "OPENAI_API_KEY";
  if (providerKey === "groq") return "GROQ_API_KEY";
  return null;
}

export async function getActiveLlmReadiness(): Promise<ActiveLlmReadiness> {
  const config = await getActiveLlmConfig();
  const envName = providerKeyEnvName(config.providerKey);
  if (!envName) {
    return {
      ...config,
      ready: false,
      reason: `Provider "${config.providerKey}" has no live chat adapter configured`,
    };
  }
  const key = process.env[envName]?.trim();
  if (!key) {
    return {
      ...config,
      ready: false,
      reason: `Missing ${envName}`,
    };
  }
  return { ...config, ready: true };
}

function canUseMockFallback(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_LLM_MOCK_FALLBACK === "true";
}

function buildLiveLlmRequiredError(config: ActiveLlmConfig, reason: string, cause?: unknown): Error & { status: number } {
  const err = new Error(
    `Live LLM is required in production. Active provider=${config.providerKey}, model=${config.modelKey}. ${reason}`,
  ) as Error & { status: number; cause?: unknown };
  err.status = 503;
  if (cause) err.cause = cause;
  return err;
}

/** Parse JSON from model output; tolerate markdown fences */
export function parseJsonFromLlmText(text: string): unknown {
  let t = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im.exec(t);
  if (fence) t = fence[1].trim();
  return JSON.parse(t) as unknown;
}

export type NlSearchMatch = {
  title: string;
  year?: number;
  reason: string;
  tmdbId?: number | null;
  posterUrl?: string | null;
  voteAverage?: number | null;
};

export type NlSearchResult = {
  matches: NlSearchMatch[];
  notes?: string;
};

export type RecommendationRow = {
  title: string;
  year?: number;
  movieId?: string;
  tmdbId?: number | null;
  posterUrl?: string | null;
  why: string;
};

export type RecommendationsResult = {
  recommendations: RecommendationRow[];
  disclaimer?: string;
};

/** Stable title normalization for fuzzy catalog joins */
export function normalizeTitleForMatch(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/^the\s+/i, "")
    .replace(/\s+/g, " ");
}

/**
 * Map a model suggestion to a catalog movie when plausible; otherwise leave unmatched.
 */
export function findCatalogMatch(
  suggestionTitle: string,
  suggestionYear: number | undefined,
  catalog: Array<{ id: string; title: string; year: number }>,
): { id: string; title: string; year: number } | null {
  const sn = normalizeTitleForMatch(suggestionTitle);
  if (!sn) return null;

  type Ranked = { m: { id: string; title: string; year: number }; score: number };

  const ranked: Ranked[] = catalog.map((m) => {
    const mn = normalizeTitleForMatch(m.title);
    let score = 0;
    if (mn === sn) score = 100;
    else if (sn.length >= 6 && mn.includes(sn)) score = 75;
    else if (mn.length >= 6 && sn.includes(mn)) score = 70;

    const yearMismatch =
      suggestionYear != null &&
      suggestionYear >= 1888 &&
      m.year !== suggestionYear &&
      score > 0 &&
      score < 100;
    if (yearMismatch) score -= 20;

    return { m, score };
  });

  const best =
    ranked
      .filter((x) => x.score >= 70)
      .sort((a, b) => b.score - a.score || a.m.title.length - b.m.title.length)[0] ?? null;
  return best ? { id: best.m.id, title: best.m.title, year: best.m.year } : null;
}

/** Extract model-produced rows (catalog not used in prompt for this phase). */
export function normalizeRecommendationsFromParse(parsed: unknown): Array<{ title: string; year?: number; why: string }> {
  if (!parsed || typeof parsed !== "object") return [];
  const rec = (parsed as RecommendationsResult).recommendations;
  if (!Array.isArray(rec)) return [];

  const out: Array<{ title: string; year?: number; why: string }> = [];
  for (const item of rec) {
    if (!item || typeof item !== "object") continue;
    const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title.trim() : "";
    const why = typeof (item as { why?: unknown }).why === "string" ? (item as { why: string }).why.trim() : "";
    const yearRaw = (item as { year?: unknown }).year;
    const year = typeof yearRaw === "number" && Number.isFinite(yearRaw) ? yearRaw : undefined;
    if (!title || !why) continue;
    out.push({ title, year, why });
    if (out.length >= 12) break;
  }
  return out;
}

async function callOpenAiChat(model: string, system: string, user: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${err}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty OpenAI response");
  return content;
}

async function callGroqChat(model: string, system: string, user: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const groq = new Groq({ apiKey });
  /** Non-streaming: AI routes parse full JSON body (streaming fits a future chat/SSE endpoint). */
  const completion = await groq.chat.completions.create({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    model,
    temperature: 0.3,
    max_completion_tokens: 2048,
    top_p: 1,
    stream: false,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty Groq response");
  return content;
}

/** Dispatch synchronous JSON chat completion for whichever provider/model is globally active */
export async function chatCompletionActiveModel(
  config: ActiveLlmConfig,
  system: string,
  user: string,
): Promise<string> {
  if (config.providerKey === "openai") {
    return callOpenAiChat(config.modelKey, system, user);
  }
  if (config.providerKey === "groq") {
    return callGroqChat(config.modelKey, system, user);
  }
  throw new Error(`Active LLM provider "${config.providerKey}" has no wired chat-completion adapter`);
}

function mockNlSearch(userQuery: string): NlSearchResult {
  return { matches: [], notes: "Using mock LLM (no provider key or provider error)." };
}

function mockRecommendations(): RecommendationsResult {
  return {
    recommendations: [],
    disclaimer: "Mock mode",
  };
}

export async function runNlSearchWithActiveLlm(params: {
  query: string;
}): Promise<{ result: NlSearchResult; config: ActiveLlmConfig; usedLiveLlm: boolean }> {
  const config = await getActiveLlmConfig();
  const system = `You are a movie assistant. Return ONLY valid JSON matching this shape:
{"matches":[{"title":"string","year":number optional,"reason":"string"}],"notes":"string optional"}
Suggest well-known films from general cinema knowledge that match the user's natural language query.
Use canonical TMDB-friendly title spelling. Do not include internal database ids.`;
  const userMsg = `User query: ${params.query}`;

  try {
    if (config.providerKey === "openai") {
      const text = await callOpenAiChat(config.modelKey, system, userMsg);
      const parsed = parseJsonFromLlmText(text) as NlSearchResult;
      return { result: parsed, config, usedLiveLlm: true };
    }
    if (config.providerKey === "groq") {
      const text = await callGroqChat(config.modelKey, system, userMsg);
      const parsed = parseJsonFromLlmText(text) as NlSearchResult;
      return { result: parsed, config, usedLiveLlm: true };
    }
    if (!canUseMockFallback()) {
      throw buildLiveLlmRequiredError(config, "Selected provider is not wired for live chat completions.");
    }
    // Anthropic / Together: extend similarly; fall back to mock outside production.
    return {
      result: mockNlSearch(params.query),
      config,
      usedLiveLlm: false,
    };
  } catch (cause) {
    if (!canUseMockFallback()) {
      throw buildLiveLlmRequiredError(config, "Provider call failed.", cause);
    }
    return {
      result: mockNlSearch(params.query),
      config,
      usedLiveLlm: false,
    };
  }
}

export async function runRecommendationsWithActiveLlm(params: {
  historyContext: string;
}): Promise<{ result: RecommendationsResult; config: ActiveLlmConfig; usedLiveLlm: boolean }> {
  const config = await getActiveLlmConfig();

  try {
    if (config.providerKey === "openai" || config.providerKey === "groq") {
      const { runLiveRecommendationsWithTmdbRetry } = await import("./recommendationResolve.js");
      const merged = await runLiveRecommendationsWithTmdbRetry(params, config);
      return { result: merged, config, usedLiveLlm: true };
    }
    if (!canUseMockFallback()) {
      throw buildLiveLlmRequiredError(config, "Selected provider is not wired for live recommendation calls.");
    }
    return {
      result: mockRecommendations(),
      config,
      usedLiveLlm: false,
    };
  } catch (cause) {
    if (!canUseMockFallback()) {
      throw buildLiveLlmRequiredError(config, "Recommendation provider call failed.", cause);
    }
    return {
      result: mockRecommendations(),
      config,
      usedLiveLlm: false,
    };
  }
}
