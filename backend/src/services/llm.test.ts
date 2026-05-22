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
              matches: [{ title: "Z", movieId: "mid", reason: "reason" }],
            }),
          },
        },
      ],
    });
  });

  it("parses NL search payloads from Groq", async () => {
    const out = await runNlSearchWithActiveLlm({
      query: "hello",
      catalogContext: "ctx",
      catalog: [{ id: "mid", title: "Z", year: 2001 }],
    });
    expect(out.usedLiveLlm).toBe(true);
    expect(out.result.matches[0]?.movieId).toBe("mid");
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
                matches: [{ title: "Zodiac", movieId: "uu1", reason: "match" }],
              }),
            },
          },
        ],
      }),
    } as Response);

    try {
      const out = await runNlSearchWithActiveLlm({
        query: "crime",
        catalogContext: "ctx",
        catalog: [{ id: "uu1", title: "Zodiac", year: 2007 }],
      });
      expect(out.usedLiveLlm).toBe(true);
      expect(out.result.matches[0]?.movieId).toBe("uu1");
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to keyword mock pipeline on provider errors", async () => {
    groqCreate.mockRejectedValueOnce(new Error("rate limit"));
    const catalog = [
      { id: "a", title: "Tiger Highway", year: 2019 },
      { id: "b", title: "Tiger Stripes", year: 2020 },
    ];
    const out = await runNlSearchWithActiveLlm({
      query: "tigers",
      catalogContext: "",
      catalog,
    });

    expect(out.usedLiveLlm).toBe(false);
    expect(out.result.matches.every((row) => row.reason.includes("Keyword match"))).toBe(true);
  });

  it("uses heuristic mock NL search when provider lacks HTTP adapter", async () => {
    prismaHoisted.appSettingsFind.mockResolvedValue({
      activeProvider: { providerKey: "anthropic" },
      activeModel: { modelKey: "claude-3-haiku" },
    });

    const out = await runNlSearchWithActiveLlm({
      query: "space",
      catalogContext: "",
      catalog: [{ id: "s", title: "Space Odyssey", year: 2001 }],
    });
    expect(out.usedLiveLlm).toBe(false);
    expect(out.result.matches[0]?.title).toContain("Odyssey");
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
      catalog: [{ id: "movie-uuid", title: "Sample", year: 2009 }],
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
      catalog: [{ id: "a", title: "A", year: 2001 }],
    });
    expect(runLiveReco).toHaveBeenCalledTimes(1);
  });

  it("returns seeded mock catalog when provider is offline-only", async () => {
    prismaHoisted.appSettingsFind.mockResolvedValueOnce({
      activeProvider: { providerKey: "anthropic" },
      activeModel: { modelKey: "claude" },
    });

    const out = await runRecommendationsWithActiveLlm({
      historyContext: "ctx",
      catalog: [{ id: "only", title: "Only Film", year: 1999 }],
    });
    expect(out.usedLiveLlm).toBe(false);
    expect(out.result.disclaimer).toContain("Mock");
  });

  it("falls back to mock recommendations when resolver throws", async () => {
    runLiveReco.mockRejectedValueOnce(new Error("LLM outage"));
    const catalog = [{ id: "movie-uuid", title: "Backup", year: 2010 }];
    const out = await runRecommendationsWithActiveLlm({
      historyContext: "",
      catalog,
    });
    expect(out.usedLiveLlm).toBe(false);
    expect(out.result.recommendations[0]?.title).toBe("Backup");
  });
});
