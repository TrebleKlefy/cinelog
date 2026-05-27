import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaHoisted = vi.hoisted(() => ({
  appSettingsFind: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    appSettings: {
      findUniqueOrThrow: prismaHoisted.appSettingsFind,
    },
  },
}));

const groqCreate = vi.hoisted(() => vi.fn());

vi.mock("groq-sdk", () => ({
  default: class MockGroq {
    chat = {
      completions: {
        create: groqCreate,
      },
    };
  },
}));

const runLiveReco = vi.hoisted(() => vi.fn());

vi.mock("./recommendationResolve.js", () => ({
  runLiveRecommendationsWithTmdbRetry: (...args: unknown[]) => runLiveReco(...args),
}));

import {
  chatCompletionActiveModel,
  findCatalogMatch,
  getActiveLlmConfig,
  getActiveLlmReadiness,
  normalizeRecommendationsFromParse,
  normalizeTitleForMatch,
  parseJsonFromLlmText,
  runNlSearchWithActiveLlm,
  runRecommendationsWithActiveLlm,
} from "./llm.js";

describe("parseJsonFromLlmText", () => {
  it("parses raw JSON objects", () => {
    expect(parseJsonFromLlmText(`  {"x": 1}  `)).toEqual({ x: 1 });
  });

  it("strips fenced markdown payloads", () => {
    expect(
      parseJsonFromLlmText("```json\n{\n\"a\": \"b\"\n}\n```"),
    ).toEqual({ a: "b" });
  });
});

describe("normalizeTitleForMatch", () => {
  it("normalizes typography", () => {
    expect(normalizeTitleForMatch("  The Ångström & Co. ")).toBe("angstrom and co.");
  });
});

describe("findCatalogMatch", () => {
  const cat = [
    { id: "m1", title: "Les Misérables", year: 2012 },
    { id: "m3", title: "The Matrix", year: 1999 },
  ];

  it("scores exact catalogue matches", () => {
    expect(findCatalogMatch("The Matrix", 1999, cat)?.id).toBe("m3");
  });

  it("drops partial matches when year disagrees below threshold", () => {
    expect(findCatalogMatch("Matri", 2099, cat)).toBeNull();
  });

  it("returns null for whitespace-only suggestions", () => {
    expect(findCatalogMatch("   ", undefined, cat)).toBeNull();
  });
});

describe("normalizeRecommendationsFromParse", () => {
  it("filters junk rows & caps entries", () => {
    expect(
      normalizeRecommendationsFromParse({
        recommendations: [{ title: "Ok", why: "w", year: NaN }],
      }),
    ).toHaveLength(1);

    expect(
      normalizeRecommendationsFromParse({
        recommendations: Array.from({ length: 50 }, (_, i) => ({
          title: `T${i}`,
          why: `W${i}`,
        })),
      }),
    ).toHaveLength(12);
  });
});

describe("getActiveLlmConfig", () => {
  beforeEach(() => {
    prismaHoisted.appSettingsFind.mockResolvedValue({
      activeProvider: { providerKey: "groq" },
      activeModel: { modelKey: "llama" },
    });
  });

  it("returns active IDs", async () => {
    await expect(getActiveLlmConfig()).resolves.toEqual({
      providerKey: "groq",
      modelKey: "llama",
    });
  });
});

describe("getActiveLlmReadiness", () => {
  beforeEach(() => {
    prismaHoisted.appSettingsFind.mockResolvedValue({
      activeProvider: { providerKey: "groq" },
      activeModel: { modelKey: "llama" },
    });
    vi.unstubAllEnvs();
  });

  it("marks groq ready when GROQ_API_KEY is set", async () => {
    vi.stubEnv("GROQ_API_KEY", "gq-test");
    await expect(getActiveLlmReadiness()).resolves.toEqual({
      providerKey: "groq",
      modelKey: "llama",
      ready: true,
    });
  });

  it("marks groq not ready when the API key is missing", async () => {
    await expect(getActiveLlmReadiness()).resolves.toMatchObject({
      ready: false,
      reason: "Missing GROQ_API_KEY",
    });
  });

  it("marks unsupported providers as not ready", async () => {
    prismaHoisted.appSettingsFind.mockResolvedValueOnce({
      activeProvider: { providerKey: "anthropic" },
      activeModel: { modelKey: "claude" },
    });
    await expect(getActiveLlmReadiness()).resolves.toMatchObject({
      ready: false,
      reason: expect.stringContaining("no live chat adapter"),
    });
  });

  it("marks openai ready when OPENAI_API_KEY is set", async () => {
    prismaHoisted.appSettingsFind.mockResolvedValueOnce({
      activeProvider: { providerKey: "openai" },
      activeModel: { modelKey: "gpt-4o-mini" },
    });
    vi.stubEnv("OPENAI_API_KEY", "oa-test");
    await expect(getActiveLlmReadiness()).resolves.toMatchObject({
      providerKey: "openai",
      ready: true,
    });
  });
});

describe("chatCompletionActiveModel", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "oa-test");
    vi.stubEnv("GROQ_API_KEY", "gq-test");
    groqCreate.mockResolvedValue({
      choices: [{ message: { content: `{"live":true}` } }],
    });
  });

  it("hits OpenAI JSON chat completions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "{\"x\":true}" } }],
        }),
      }),
    );

    await expect(
      chatCompletionActiveModel({ providerKey: "openai", modelKey: "gpt-4o-mini" }, "s", "u"),
    ).resolves.toContain("x");

    expect(fetch).toHaveBeenCalled();
  });

  it("hits Groq when configured", async () => {
    const text = await chatCompletionActiveModel({ providerKey: "groq", modelKey: "m" }, "s", "u");
    expect(JSON.parse(text).live).toBe(true);
  });

  it("errors when OpenAI key missing", async () => {
    vi.unstubAllEnvs();
    await expect(chatCompletionActiveModel({ providerKey: "openai", modelKey: "m" }, "s", "u")).rejects.toThrow(
      "OPENAI_API_KEY",
    );
  });

  it("handles OpenAI bad HTTP payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        text: async () => "nope",
      }),
    );

    await expect(chatCompletionActiveModel({ providerKey: "openai", modelKey: "m" }, "s", "u")).rejects.toThrow(
      "OpenAI error",
    );
  });

  it("handles empty OpenAI content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: {} }],
        }),
      }),
    );

    await expect(chatCompletionActiveModel({ providerKey: "openai", modelKey: "m" }, "s", "u")).rejects.toThrow(
      "Empty OpenAI response",
    );
  });

  it("reject unknown providers outright", async () => {
    await expect(
      chatCompletionActiveModel({ providerKey: "acme-unknown", modelKey: "m" }, "s", "u"),
    ).rejects.toThrow("no wired chat");
  });
});

describe("runNlSearchWithActiveLlm", () => {
  beforeEach(() => {
    prismaHoisted.appSettingsFind.mockResolvedValue({
      activeProvider: { providerKey: "groq" },
      activeModel: { modelKey: "m" },
    });
    vi.stubEnv("GROQ_API_KEY", "gq");
    groqCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              matches: [{ title: "Z", reason: "reason" }],
            }),
          },
        },
      ],
    });
  });

  it("parses NL search payloads from Groq", async () => {
    const out = await runNlSearchWithActiveLlm({
      query: "hello",
    });
    expect(out.usedLiveLlm).toBe(true);
    expect(out.result.matches[0]?.title).toBe("Z");
  });

  it("parses NL search payloads from OpenAI chat completions", async () => {
    prismaHoisted.appSettingsFind.mockResolvedValueOnce({
      activeProvider: { providerKey: "openai" },
      activeModel: { modelKey: "gpt-mini" },
    });
    vi.stubEnv("OPENAI_API_KEY", "sk-test-openai");

    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                matches: [{ title: "Zodiac", reason: "match" }],
              }),
            },
          },
        ],
      }),
    } as Response);

    try {
      const out = await runNlSearchWithActiveLlm({
        query: "crime",
      });
      expect(out.usedLiveLlm).toBe(true);
      expect(out.result.matches[0]?.title).toBe("Zodiac");
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to empty mock results on provider errors", async () => {
    groqCreate.mockRejectedValueOnce(new Error("rate limit"));
    const out = await runNlSearchWithActiveLlm({
      query: "tigers",
    });

    expect(out.usedLiveLlm).toBe(false);
    expect(out.result.matches).toHaveLength(0);
  });

  it("uses empty mock NL search when provider lacks HTTP adapter", async () => {
    prismaHoisted.appSettingsFind.mockResolvedValue({
      activeProvider: { providerKey: "anthropic" },
      activeModel: { modelKey: "claude-3-haiku" },
    });

    const out = await runNlSearchWithActiveLlm({
      query: "space",
    });
    expect(out.usedLiveLlm).toBe(false);
    expect(out.result.matches).toHaveLength(0);
  });
});

describe("runRecommendationsWithActiveLlm", () => {
  beforeEach(() => {
    prismaHoisted.appSettingsFind.mockResolvedValue({
      activeProvider: { providerKey: "groq" },
      activeModel: { modelKey: "mini" },
    });
    vi.stubEnv("GROQ_API_KEY", "gq-key");
    runLiveReco.mockReset();
    runLiveReco.mockResolvedValue({
      recommendations: [{ title: "Rec", why: "w", posterUrl: null, tmdbId: null }],
      disclaimer: "test",
    });
  });

  it("streams through live resolver for Groq", async () => {
    const out = await runRecommendationsWithActiveLlm({
      historyContext: "(none)",
    });
    expect(runLiveReco).toHaveBeenCalled();
    expect(out.usedLiveLlm).toBe(true);
    expect(out.result.recommendations[0]?.title).toBe("Rec");
  });

  it("handles OpenAI like Groq (live resolver path)", async () => {
    prismaHoisted.appSettingsFind.mockResolvedValueOnce({
      activeProvider: { providerKey: "openai" },
      activeModel: { modelKey: "gpt-mini" },
    });
    await runRecommendationsWithActiveLlm({
      historyContext: "ctx",
    });
    expect(runLiveReco).toHaveBeenCalledTimes(1);
  });

  it("returns empty mock recommendations when provider is offline-only", async () => {
    prismaHoisted.appSettingsFind.mockResolvedValueOnce({
      activeProvider: { providerKey: "anthropic" },
      activeModel: { modelKey: "claude" },
    });

    const out = await runRecommendationsWithActiveLlm({
      historyContext: "ctx",
    });
    expect(out.usedLiveLlm).toBe(false);
    expect(out.result.recommendations).toHaveLength(0);
    expect(out.result.disclaimer).toContain("Mock");
  });

  it("falls back to mock recommendations when resolver throws", async () => {
    runLiveReco.mockRejectedValueOnce(new Error("LLM outage"));
    const out = await runRecommendationsWithActiveLlm({
      historyContext: "",
    });
    expect(out.usedLiveLlm).toBe(false);
    expect(out.result.recommendations).toHaveLength(0);
  });
});

describe("production LLM guardrails", () => {
  it("rejects NL fallback paths in production when provider is not wired", async () => {
    prismaHoisted.appSettingsFind.mockResolvedValueOnce({
      activeProvider: { providerKey: "anthropic" },
      activeModel: { modelKey: "claude" },
    });
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      runNlSearchWithActiveLlm({
        query: "space movies",
      }),
    ).rejects.toThrow("Live LLM is required in production");
  });

  it("rejects recommendation fallback in production when resolver fails", async () => {
    prismaHoisted.appSettingsFind.mockResolvedValueOnce({
      activeProvider: { providerKey: "groq" },
      activeModel: { modelKey: "mini" },
    });
    vi.stubEnv("NODE_ENV", "production");
    runLiveReco.mockRejectedValueOnce(new Error("provider down"));

    await expect(
      runRecommendationsWithActiveLlm({
        historyContext: "",
      }),
    ).rejects.toThrow("Live LLM is required in production");
  });
});
